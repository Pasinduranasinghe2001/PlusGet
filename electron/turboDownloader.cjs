const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { formatBytes } = require('./utils.cjs');

/**
 * IDM-Style Multi-Connection Parallel Segmented Downloader
 * Splits a file into N byte ranges (e.g. 8 or 16 parallel connections)
 * and writes each segment concurrently to its exact byte offset on disk.
 */
class TurboSegmentedJob {
  constructor(job, numConnections = 8, onUpdate) {
    this.job = job;
    this.numConnections = numConnections;
    this.onUpdate = onUpdate;
    this.aborted = false;
    this.paused = false;
    this.activeRequests = [];
    this.fd = null;
    this.segments = [];
  }

  async resolveFinalUrlAndInfo(initialUrl, customHeaders = {}) {
    return new Promise((resolve, reject) => {
      const follow = (currentUrl, redirects = 0) => {
        if (redirects > 10) return reject(new Error('Too many redirects'));
        let parsed;
        try {
          parsed = new URL(currentUrl);
        } catch (e) {
          return reject(new Error('Invalid URL'));
        }

        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request(currentUrl, {
          method: 'GET',
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            ...(customHeaders || {}),
            'Range': 'bytes=0-0'
          }
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.destroy();
            const next = new URL(res.headers.location, currentUrl).toString();
            return follow(next, redirects + 1);
          }

          if (res.statusCode === 404 && currentUrl.endsWith('/main.zip')) {
            res.destroy();
            return follow(currentUrl.replace(/\/main\.zip$/, '/master.zip'), redirects + 1);
          }

          let totalSize = parseInt(res.headers['content-length'] || '0', 10);
          const contentRange = res.headers['content-range'];
          if (contentRange && contentRange.includes('/')) {
            const totalPart = parseInt(contentRange.split('/')[1], 10);
            if (!isNaN(totalPart) && totalPart > 0) totalSize = totalPart;
          }
          const supportsRanges = res.statusCode === 206 || res.headers['accept-ranges'] === 'bytes' || Boolean(contentRange);

          res.destroy();
          resolve({
            finalUrl: currentUrl,
            totalSize,
            supportsRanges: Boolean(supportsRanges && totalSize > 512 * 1024) // Use multi-chunk for files > 512 KB
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Connection timed out'));
        });
        req.end();
      };
      follow(initialUrl);
    });
  }

  async start(tempFilePath, finalDestPath, onComplete) {
    try {
      const info = await this.resolveFinalUrlAndInfo(this.job.url, this.job.headers);
      const totalSize = info.totalSize || this.job.totalSize || 0;
      const finalUrl = info.finalUrl;

      // Use 8 parallel connections if server supports byte ranges & file > 512KB
      const connections = info.supportsRanges ? Math.min(this.numConnections, 16) : 1;

      this.onUpdate({
        status: 'downloading',
        totalSize,
        connections,
        sizeText: totalSize > 0 ? formatBytes(totalSize) : 'Downloading...'
      });

      if (!info.supportsRanges || totalSize <= 0) {
        return this._downloadSingleStream(finalUrl, totalSize, tempFilePath, finalDestPath, onComplete);
      }

      // Prepare pre-allocated file descriptor for random-access parallel writes
      this.fd = fs.openSync(tempFilePath, 'w+');

      const chunkSize = Math.ceil(totalSize / connections);
      this.segments = [];
      for (let i = 0; i < connections; i++) {
        const start = i * chunkSize;
        const end = Math.min(totalSize - 1, (i + 1) * chunkSize - 1);
        if (start <= end) {
          this.segments.push({
            index: i,
            start,
            end,
            downloaded: 0,
            total: end - start + 1,
            done: false
          });
        }
      }

      let lastTickTime = Date.now();
      let lastTickBytes = 0;

      const progressTimer = setInterval(() => {
        if (this.aborted || this.paused) {
          clearInterval(progressTimer);
          return;
        }
        const totalDownloaded = this.segments.reduce((acc, s) => acc + s.downloaded, 0);
        const now = Date.now();
        const elapsed = (now - lastTickTime) / 1000;
        if (elapsed >= 0.3) {
          const speed = Math.max(0, (totalDownloaded - lastTickBytes) / elapsed);
          lastTickTime = now;
          lastTickBytes = totalDownloaded;

          const pct = totalSize > 0 ? Math.min(99.9, (totalDownloaded / totalSize) * 100) : 50;
          const remaining = Math.max(0, totalSize - totalDownloaded);
          const etaSec = speed > 0 ? Math.ceil(remaining / speed) : 0;
          const mins = Math.floor(etaSec / 60);
          const secs = etaSec % 60;

          const segmentPcts = this.segments.map((s) => Math.min(100, Math.round((s.downloaded / s.total) * 100)));

          this.onUpdate({
            status: 'downloading',
            progress: Number(pct.toFixed(1)),
            downloadedBytes: totalDownloaded,
            totalSize,
            connections: this.segments.length,
            segmentProgress: segmentPcts,
            sizeText: `${formatBytes(totalDownloaded)} / ${formatBytes(totalSize)}`,
            speedText: `${formatBytes(speed)}/s`,
            etaText: etaSec > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : '0:01'
          });
        }
      }, 320);

      await Promise.all(
        this.segments.map((seg) => this._downloadSegment(finalUrl, seg))
      );

      clearInterval(progressTimer);
      this._closeFd();

      if (this.aborted || this.paused) return;

      if (fs.existsSync(finalDestPath)) fs.unlinkSync(finalDestPath);
      fs.renameSync(tempFilePath, finalDestPath);
      onComplete(null, finalDestPath, totalSize);
    } catch (err) {
      this._closeFd();
      if (this.aborted || this.paused) return;
      onComplete(err);
    }
  }

  _downloadSegment(urlStr, seg, retries = 3) {
    return new Promise((resolve, reject) => {
      const attempt = (left) => {
        if (this.aborted || this.paused) return resolve();

        const currentStart = seg.start + seg.downloaded;
        if (currentStart > seg.end) {
          seg.done = true;
          return resolve();
        }

        const parsed = new URL(urlStr);
        const mod = parsed.protocol === 'https:' ? https : http;
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          ...(this.job.headers || {}),
          'Range': `bytes=${currentStart}-${seg.end}`
        };

        const req = mod.get(urlStr, { headers }, (res) => {
          if (res.statusCode !== 206 && res.statusCode !== 200) {
            res.resume();
            if (left > 0) return setTimeout(() => attempt(left - 1), 600);
            return reject(new Error(`HTTP ${res.statusCode} on segment ${seg.index}`));
          }

          let writePos = currentStart;

          res.on('data', (chunk) => {
            if (this.aborted || this.paused || this.fd === null) {
              req.destroy();
              return;
            }
            try {
              fs.writeSync(this.fd, chunk, 0, chunk.length, writePos);
              writePos += chunk.length;
              seg.downloaded += chunk.length;
            } catch (writeErr) {
              req.destroy(writeErr);
            }
          });

          res.on('end', () => {
            if (this.aborted || this.paused) return resolve();
            if (seg.downloaded >= seg.total) {
              seg.done = true;
              resolve();
            } else if (left > 0) {
              setTimeout(() => attempt(left - 1), 500);
            } else {
              resolve();
            }
          });

          res.on('error', (err) => {
            if (this.aborted || this.paused) return resolve();
            if (left > 0) setTimeout(() => attempt(left - 1), 600);
            else reject(err);
          });
        });

        this.activeRequests.push(req);
        req.on('error', (err) => {
          if (this.aborted || this.paused) return resolve();
          if (left > 0) setTimeout(() => attempt(left - 1), 600);
          else reject(err);
        });
      };

      attempt(retries);
    });
  }

  _downloadSingleStream(urlStr, totalSize, tempFilePath, finalDestPath, onComplete) {
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ...(this.job.headers || {})
    };

    const fileStream = fs.createWriteStream(tempFilePath);
    let downloaded = 0;
    let lastTickTime = Date.now();
    let lastTickBytes = 0;

    const req = mod.get(urlStr, { headers }, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return onComplete(new Error(`Server returned HTTP ${res.statusCode}`));
      }

      const len = parseInt(res.headers['content-length'] || '0', 10) || totalSize;

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastTickTime) / 1000;
        if (elapsed >= 0.35) {
          const speed = (downloaded - lastTickBytes) / elapsed;
          lastTickTime = now;
          lastTickBytes = downloaded;
          const pct = len > 0 ? Math.min(99.9, (downloaded / len) * 100) : 50;
          const etaSec = speed > 0 && len > downloaded ? Math.ceil((len - downloaded) / speed) : 0;
          this.onUpdate({
            status: 'downloading',
            progress: Number(pct.toFixed(1)),
            downloadedBytes: downloaded,
            totalSize: len,
            connections: 1,
            sizeText: len > 0 ? `${formatBytes(downloaded)} / ${formatBytes(len)}` : formatBytes(downloaded),
            speedText: `${formatBytes(speed)}/s`,
            etaText: etaSec > 0 ? `${Math.floor(etaSec / 60)}:${(etaSec % 60).toString().padStart(2, '0')}` : '--:--'
          });
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => {
          if (this.aborted || this.paused) return;
          try {
            if (fs.existsSync(finalDestPath)) fs.unlinkSync(finalDestPath);
            fs.renameSync(tempFilePath, finalDestPath);
            onComplete(null, finalDestPath, downloaded);
          } catch (e) {
            onComplete(e);
          }
        });
      });
    });

    this.activeRequests.push(req);
    req.on('error', (err) => {
      if (this.aborted || this.paused) return;
      onComplete(err);
    });
  }

  pause() {
    this.paused = true;
    for (const r of this.activeRequests) {
      try { r.destroy(); } catch (_) {}
    }
    this._closeFd();
  }

  cancel() {
    this.aborted = true;
    for (const r of this.activeRequests) {
      try { r.destroy(); } catch (_) {}
    }
    this._closeFd();
  }

  _closeFd() {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }
  }
}

module.exports = {
  TurboSegmentedJob
};
