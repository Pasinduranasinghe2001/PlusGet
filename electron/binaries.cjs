const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');

function getBinDirectories(app) {
  const dirs = [];
  if (app && app.isPackaged) {
    dirs.push(path.join(process.resourcesPath, 'bin'));
  }
  dirs.push(path.join(__dirname, '..', 'bin'));
  if (app) {
    dirs.push(path.join(app.getPath('userData'), 'bin'));
  }
  return dirs;
}

function findBinary(name, app) {
  const exeName = process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name;
  const dirs = getBinDirectories(app);

  for (const dir of dirs) {
    const candidate = path.join(dir, exeName);
    if (fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.size > 100000) {
          return candidate;
        }
      } catch (_) {}
    }
  }

  if (name === 'ffmpeg') {
    try {
      const ffmpegStatic = require('ffmpeg-static');
      if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        return ffmpegStatic;
      }
    } catch (_) {}
  }

  return null;
}

function downloadFileWithRedirects(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${destPath}.tmp`;

    const request = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 10) {
        return reject(new Error('Too many redirects while downloading binary'));
      }

      const mod = currentUrl.startsWith('https') ? https : require('http');
      mod.get(currentUrl, {
        headers: {
          'User-Agent': 'PlusGet-Desktop/1.0'
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          res.resume();
          return request(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(tempPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes > 0) {
            onProgress(Math.round((downloadedBytes / totalBytes) * 100), downloadedBytes, totalBytes);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tempPath, destPath);
              resolve(destPath);
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
          reject(err);
        });
      }).on('error', (err) => {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        reject(err);
      });
    };

    request(url);
  });
}

async function ensureBinaries(app, onStatus) {
  let ytdlpPath = findBinary('yt-dlp', app);
  let ffmpegPath = findBinary('ffmpeg', app);

  const writableBinDir = (app && app.isPackaged)
    ? path.join(app.getPath('userData'), 'bin')
    : path.join(__dirname, '..', 'bin');

  fs.mkdirSync(writableBinDir, { recursive: true });

  // Copy ffmpeg-static into writableBinDir if not already in bin/
  if (!ffmpegPath) {
    try {
      const ffmpegStatic = require('ffmpeg-static');
      if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        ffmpegPath = ffmpegStatic;
      }
    } catch (_) {}
  }

  if (!ytdlpPath) {
    const targetYtdlp = path.join(writableBinDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (onStatus) onStatus({ status: 'downloading', binary: 'yt-dlp', progress: 0 });
    try {
      const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
      await downloadFileWithRedirects(downloadUrl, targetYtdlp, (progress) => {
        if (onStatus) onStatus({ status: 'downloading', binary: 'yt-dlp', progress });
      });
      ytdlpPath = targetYtdlp;
    } catch (err) {
      console.error('Failed to auto-download yt-dlp:', err.message);
    }
  }

  return {
    ytdlpPath,
    ffmpegPath
  };
}

function getBinaryVersion(binPath, args = ['--version']) {
  return new Promise((resolve) => {
    if (!binPath || !fs.existsSync(binPath)) return resolve(null);
    execFile(binPath, args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve('Installed');
      const out = (stdout || stderr || '').trim().split(/\r?\n/)[0];
      resolve(out || 'Ready');
    });
  });
}

async function getEngineStatus(app) {
  const ytdlpPath = findBinary('yt-dlp', app);
  const ffmpegPath = findBinary('ffmpeg', app);

  const [ytdlpVersion, ffmpegVersion] = await Promise.all([
    getBinaryVersion(ytdlpPath, ['--version']),
    getBinaryVersion(ffmpegPath, ['-version'])
  ]);

  return {
    ytdlpReady: Boolean(ytdlpPath),
    ffmpegReady: Boolean(ffmpegPath),
    ytdlpPath: ytdlpPath || 'Not Found',
    ffmpegPath: ffmpegPath || 'Not Found',
    ytdlpVersion: ytdlpVersion || 'Not Installed',
    ffmpegVersion: ffmpegVersion ? ffmpegVersion.replace(/^ffmpeg version\s+/i, '').split(' ')[0] : 'Not Installed'
  };
}

module.exports = {
  findBinary,
  ensureBinaries,
  getEngineStatus
};
