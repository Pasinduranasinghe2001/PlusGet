const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { findBinary } = require('./binaries.cjs');
const { autoSniffStream } = require('./streamSniffer.cjs');
const { TurboSegmentedJob } = require('./turboDownloader.cjs');
const {
  EXT_CATEGORIES,
  getCategoryByExtension,
  sanitizeFilename,
  formatBytes,
  formatDuration,
  probeMediaAudioAndDuration
} = require('./utils.cjs');

const VIDEO_PLATFORM_DOMAINS = [
  'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'fb.com',
  'tiktok.com', 'instagram.com', 'twitter.com', 'x.com', 'vimeo.com',
  'twitch.tv', 'dailymotion.com', 'reddit.com', 'redd.it', 'bilibili.com',
  'soundcloud.com', 'rumble.com', 'kick.com', 'pinterest.com', 'pin.it',
  'linkedin.com', 'streamable.com', 'ted.com', 'bandcamp.com', 'mixcloud.com',
  'vk.com', 'ok.ru', 'nicovideo.jp', 'loom.com', 'wistia.com'
];

function normalizeSpecialUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.hostname === 'github.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 5 && parts[2] === 'blob') {
        const [owner, repo, , branch, ...filePath] = parts;
        return {
          normalizedUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath.join('/')}`,
          isGitHubRaw: true,
          originalUrl: rawUrl,
          suggestedFilename: filePath[filePath.length - 1],
          category: 'code'
        };
      }
      if (parts.length === 2) {
        const [owner, repo] = parts;
        return {
          normalizedUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`,
          fallbackUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`,
          isGitHubRepo: true,
          originalUrl: rawUrl,
          suggestedFilename: `${repo}-main.zip`,
          category: 'code'
        };
      }
    }
    return { normalizedUrl: rawUrl.trim(), originalUrl: rawUrl.trim() };
  } catch (_) {
    return { normalizedUrl: rawUrl.trim(), originalUrl: rawUrl.trim() };
  }
}

function isKnownVideoPlatform(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return VIDEO_PLATFORM_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  } catch (_) {
    return false;
  }
}

function getExtensionFromUrl(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname;
    const base = path.basename(pathname);
    const ext = path.extname(base).toLowerCase().replace(/^\./, '');
    return ext && ext.length <= 10 ? ext : '';
  } catch (_) {
    return '';
  }
}

function probeHttpHead(urlStr, customHeaders = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const follow = (currentUrl, redirects = 0) => {
      if (redirects > 8) return resolve(null);
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (_) {
        return resolve(null);
      }
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(currentUrl, {
        method: 'GET',
        timeout: timeoutMs,
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

        const contentType = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        let totalSize = parseInt(res.headers['content-length'] || '0', 10);
        const contentRange = res.headers['content-range'];
        if (contentRange && contentRange.includes('/')) {
          const totalPart = parseInt(contentRange.split('/')[1], 10);
          if (!isNaN(totalPart) && totalPart > 0) totalSize = totalPart;
        }
        const acceptRanges = res.headers['accept-ranges'] === 'bytes' || Boolean(contentRange);

        let filename = '';
        const disp = res.headers['content-disposition'] || '';
        const matchUtf8 = disp.match(/filename\*=UTF-8''([^;]+)/i);
        const matchStd = disp.match(/filename="?([^";]+)"?/i);
        if (matchUtf8) filename = decodeURIComponent(matchUtf8[1]);
        else if (matchStd) filename = matchStd[1];

        if (!filename) {
          try {
            const u = new URL(currentUrl);
            filename = decodeURIComponent(path.basename(u.pathname)) || u.hostname;
          } catch (_) {
            filename = 'download';
          }
        }

        res.destroy();
        resolve({
          finalUrl: currentUrl,
          statusCode: res.statusCode,
          contentType,
          totalSize,
          acceptRanges,
          filename: sanitizeFilename(filename)
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    };
    follow(urlStr);
  });
}

function runYtDlpJson(ytdlpPath, urlStr, timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    if (!ytdlpPath || !fs.existsSync(ytdlpPath)) {
      return reject(new Error('Video helper is initializing.'));
    }

    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      urlStr
    ];

    const proc = spawn(ytdlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      reject(new Error('Timed out while inspecting video streams.'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        try {
          const data = JSON.parse(stdout.trim().split(/\r?\n/).pop());
          resolve(data);
        } catch (err) {
          reject(new Error('Failed to parse media metadata.'));
        }
      } else {
        reject(new Error(stderr.trim() || `Exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function buildQualityOptionsFromYtDlp(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const durationSec = info.duration || 0;
  const durationText = formatDuration(durationSec);
  const heightMap = new Map();
  let bestAudioBytes = 0;
  let hasAnySeparateAudio = false;
  let hasAnyCombinedAudio = false;

  for (const f of formats) {
    const size = f.filesize || f.filesize_approx || (f.tbr && durationSec ? Math.round((f.tbr * 1000 / 8) * durationSec) : 0);
    const hasAud = Boolean(f.acodec && f.acodec !== 'none');
    const hasVid = Boolean(f.vcodec && f.vcodec !== 'none');

    if (hasAud && !hasVid) {
      hasAnySeparateAudio = true;
      if (size > bestAudioBytes) bestAudioBytes = size;
    }
    if (hasAud && hasVid) {
      hasAnyCombinedAudio = true;
    }
    if (hasVid && f.height) {
      const h = f.height;
      const existing = heightMap.get(h);
      if (!existing || size > existing.filesize || (hasAud && !existing.hasAudio)) {
        heightMap.set(h, {
          height: h,
          fps: f.fps || 30,
          ext: f.ext || 'mp4',
          filesize: size,
          hasAudio: hasAud
        });
      }
    }
  }

  // Also check top-level info.acodec if formats array is minimal
  const topLevelAudio = Boolean(info.acodec && info.acodec !== 'none');
  const videoHasAudioOverall = formats.length === 0 ? true : (hasAnySeparateAudio || hasAnyCombinedAudio || topLevelAudio);

  const standardHeights = [2160, 1440, 1080, 720, 480, 360];
  const detectedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);
  const heightsToUse = detectedHeights.length > 0 ? detectedHeights : standardHeights;

  const labelForHeight = (h) => {
    if (h >= 2160) return `2160p (4K Ultra HD)`;
    if (h >= 1440) return `1440p (2K QHD)`;
    if (h >= 1080) return `1080p (Full HD)`;
    if (h >= 720) return `720p (HD)`;
    if (h >= 480) return `480p (Standard)`;
    return `${h}p (Compact)`;
  };

  const qualities = [];
  const seenLabels = new Set();

  for (const h of heightsToUse) {
    if (h < 144) continue;
    if (seenLabels.has(h)) continue;
    seenLabels.add(h);
    const meta = heightMap.get(h);
    const qualityHasAudio = Boolean(meta?.hasAudio || hasAnySeparateAudio || videoHasAudioOverall);
    let totalEst = meta?.filesize ? (meta.hasAudio ? meta.filesize : meta.filesize + bestAudioBytes) : 0;
    if (!totalEst && durationSec > 0) {
      const fallbackKbps = h >= 2160 ? 6000 : h >= 1440 ? 3500 : h >= 1080 ? 2000 : h >= 720 ? 1100 : h >= 480 ? 600 : 350;
      totalEst = Math.round(((fallbackKbps * 1000) / 8) * durationSec);
    }
    const sizeStr = totalEst > 0 ? `~${formatBytes(totalEst)}` : 'Auto';
    qualities.push({
      id: `${h}p`,
      label: `${labelForHeight(h)} — ${durationText ? `${sizeStr} / ${durationText}` : sizeStr}`,
      height: h,
      estimatedBytes: totalEst,
      sizeText: sizeStr,
      durationText,
      hasAudio: qualityHasAudio
    });
  }

  if (videoHasAudioOverall) {
    const audioEst = bestAudioBytes || (durationSec > 0 ? Math.round(((192 * 1000) / 8) * durationSec) : 0);
    const audioSizeStr = audioEst > 0 ? `~${formatBytes(audioEst)}` : 'Audio';
    qualities.push({
      id: 'audio-320',
      label: `Audio Only (MP3) — ${durationText ? `${audioSizeStr} / ${durationText}` : audioSizeStr}`,
      height: 0,
      isAudioOnly: true,
      estimatedBytes: audioEst,
      sizeText: audioSizeStr,
      durationText,
      hasAudio: true
    });
  }

  return { qualities, hasAudioOverall: videoHasAudioOverall };
}

async function analyzeUrl(rawUrl, strategy = 'auto', app) {
  const norm = normalizeSpecialUrl(rawUrl);
  const targetUrl = norm.normalizedUrl;
  const urlExt = getExtensionFromUrl(targetUrl);
  const extCategory = getCategoryByExtension(urlExt);
  const ffmpegPath = findBinary('ffmpeg', app);

  const forceDirect = strategy === 'direct' || norm.isGitHubRaw || norm.isGitHubRepo;
  const forceVideo = strategy === 'video' || isKnownVideoPlatform(targetUrl);

  // 1. Direct file / Image / Setup / Archive / Code check
  if (!forceVideo || forceDirect) {
    const headInfo = await probeHttpHead(targetUrl);
    if (headInfo) {
      const ct = headInfo.contentType || '';
      const isHtml = ct.includes('text/html') || ct.includes('application/xhtml');

      if (!isHtml || forceDirect || (extCategory !== 'other' && urlExt !== 'html' && urlExt !== 'htm')) {
        const finalExt = path.extname(headInfo.filename).replace(/^\./, '').toLowerCase() || urlExt || 'bin';
        const detectedCat = norm.category || (
          ct.startsWith('video/') ? 'video' :
          ct.startsWith('audio/') ? 'audio' :
          ct.startsWith('image/') ? 'image' :
          getCategoryByExtension(finalExt)
        );

        const availableFormats = [finalExt || 'original'];
        if (detectedCat === 'image') {
          for (const fmt of ['png', 'jpg', 'webp', 'ico']) {
            if (!availableFormats.includes(fmt)) availableFormats.push(fmt);
          }
        } else if (detectedCat === 'video') {
          for (const fmt of ['mp4', 'mkv', 'webm', 'mp3', 'wav']) {
            if (!availableFormats.includes(fmt)) availableFormats.push(fmt);
          }
        } else if (detectedCat === 'audio') {
          for (const fmt of ['mp3', 'wav', 'flac', 'm4a']) {
            if (!availableFormats.includes(fmt)) availableFormats.push(fmt);
          }
        }

        // If this is a direct video file (.mp4 / .webm / .mkv), probe with FFmpeg to check if Audio is included & get duration!
        let directHasAudio = true;
        let directDurationText = '';
        if (detectedCat === 'video' && ffmpegPath) {
          const probe = await probeMediaAudioAndDuration(ffmpegPath, targetUrl, {}, 4000);
          if (probe.probed) {
            directHasAudio = probe.hasAudio;
            if (probe.durationSec > 0) directDurationText = formatDuration(probe.durationSec);
          }
        }

        const sizeStr = headInfo.totalSize > 0 ? formatBytes(headInfo.totalSize) : 'Ready';
        return {
          mode: 'direct',
          url: targetUrl,
          originalUrl: rawUrl,
          title: norm.suggestedFilename || headInfo.filename || 'File Download',
          filename: norm.suggestedFilename || headInfo.filename,
          category: detectedCat === 'other' ? 'document' : detectedCat,
          contentType: ct || 'application/octet-stream',
          totalSize: headInfo.totalSize || 0,
          sizeText: sizeStr,
          durationText: directDurationText,
          hasAudio: directHasAudio,
          acceptRanges: headInfo.acceptRanges,
          ext: finalExt,
          platform: new URL(targetUrl).hostname.replace(/^www\./, ''),
          thumbnail: detectedCat === 'image' ? targetUrl : null,
          qualities: [
            {
              id: 'original',
              label: `Original File (${directDurationText ? `${sizeStr} / ${directDurationText}` : sizeStr})`,
              estimatedBytes: headInfo.totalSize || 0,
              sizeText: sizeStr,
              durationText: directDurationText,
              hasAudio: directHasAudio
            }
          ],
          formats: availableFormats
        };
      }
    }
  }

  // 2. Social & standard video platforms via yt-dlp
  const ytdlpPath = findBinary('yt-dlp', app);
  try {
    const info = await runYtDlpJson(ytdlpPath, targetUrl);
    const { qualities, hasAudioOverall } = buildQualityOptionsFromYtDlp(info);
    const durationSec = info.duration || 0;
    const durationText = formatDuration(durationSec);
    const defaultQ = qualities.find((q) => q.id === '1080p') || qualities[0];

    return {
      mode: 'ytdlp',
      url: targetUrl,
      originalUrl: rawUrl,
      title: info.title || 'Video',
      filename: sanitizeFilename(info.title || 'video'),
      category: 'video',
      platform: info.extractor_key || info.webpage_url_domain || new URL(targetUrl).hostname.replace(/^www\./, ''),
      uploader: info.uploader || info.channel || '',
      duration: durationSec,
      durationText,
      hasAudio: hasAudioOverall,
      totalSize: defaultQ?.estimatedBytes || info.filesize_approx || 0,
      sizeText: defaultQ?.sizeText || formatBytes(info.filesize_approx),
      thumbnail: info.thumbnail || (Array.isArray(info.thumbnails) && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
      qualities,
      formats: hasAudioOverall ? ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'm4a', 'wav', 'flac'] : ['mp4', 'mkv', 'webm'],
      isPlaylist: Boolean(info._type === 'playlist')
    };
  } catch (_) {
    // 3. Universal Movie / TV Series Streaming Site Sniffer
    const sniffed = await autoSniffStream(targetUrl, 12000, app);
    const hostname = (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch (_) { return 'Website'; } })();

    if (sniffed && sniffed.streamUrl) {
      const durationText = sniffed.durationText || formatDuration(sniffed.durationSec);
      const hasAudio = sniffed.hasAudio !== false;
      return {
        mode: 'ytdlp',
        url: sniffed.streamUrl,
        audioUrl: sniffed.audioUrl || null,
        originalUrl: rawUrl,
        pageUrl: rawUrl,
        headers: sniffed.headers || {},
        subtitles: sniffed.subtitles || [],
        isStreamingSite: true,
        hasAudio,
        title: sniffed.pageTitle || 'Movie / TV Episode',
        filename: sanitizeFilename(sniffed.pageTitle || 'Episode'),
        category: 'video',
        platform: hostname,
        duration: sniffed.durationSec || 0,
        durationText,
        totalSize: sniffed.totalSize || 0,
        sizeText: sniffed.sizeText || '~350 MB',
        thumbnail: null,
        qualities: sniffed.qualities,
        formats: hasAudio ? ['mp4', 'mkv', 'mp3'] : ['mp4', 'mkv']
      };
    }

    // 4. Interactive Episode / Server Picker fallback for any multi-episode streaming site
    return {
      mode: 'ytdlp',
      url: targetUrl,
      originalUrl: rawUrl,
      pageUrl: rawUrl,
      isStreamingSite: true,
      needsEpisodeSelection: true,
      hasAudio: true,
      title: `${hostname} — Select Episode / Server`,
      filename: sanitizeFilename(hostname),
      category: 'video',
      platform: hostname,
      durationText: '',
      sizeText: 'Select Episode to view MB & Time',
      qualities: [
        { id: '1080p', label: '1080p (Full HD) — ~550 MB', height: 1080, sizeText: '~550 MB', hasAudio: true },
        { id: '720p', label: '720p (HD) — ~280 MB', height: 720, sizeText: '~280 MB', hasAudio: true },
        { id: '480p', label: '480p (Standard) — ~150 MB', height: 480, sizeText: '~150 MB', hasAudio: true }
      ],
      formats: ['mp4', 'mkv', 'mp3']
    };
  }
}

function fetchHtmlText(urlStr, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl, redirects = 0) => {
      if (redirects > 6) return reject(new Error('Too many redirects'));
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (e) {
        return reject(new Error('Invalid URL'));
      }
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(currentUrl, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, currentUrl).toString();
          return follow(next, redirects + 1);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 2_500_000) body += chunk;
        });
        res.on('end', () => resolve({ html: body, finalUrl: currentUrl }));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timed out fetching webpage'));
      });
    };
    follow(urlStr);
  });
}

async function scanWebpageAssets(pageUrl) {
  const { html, finalUrl } = await fetchHtmlText(pageUrl);
  const assetsMap = new Map();

  const addAsset = (rawHref, suggestedType, labelHint = '') => {
    if (!rawHref || typeof rawHref !== 'string') return;
    const trimmed = rawHref.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('#')) {
      return;
    }
    let resolved;
    try {
      resolved = new URL(trimmed, finalUrl).toString();
    } catch (_) {
      return;
    }
    if (assetsMap.has(resolved)) return;

    const ext = getExtensionFromUrl(resolved);
    let category = getCategoryByExtension(ext);
    if (category === 'other') {
      if (suggestedType === 'image') category = 'image';
      else if (suggestedType === 'video') category = 'video';
      else if (suggestedType === 'audio') category = 'audio';
      else if (isKnownVideoPlatform(resolved)) category = 'video';
      else return;
    }

    let filename = 'resource';
    try {
      const u = new URL(resolved);
      filename = decodeURIComponent(path.basename(u.pathname)) || u.hostname;
    } catch (_) {}

    if (!path.extname(filename) && ext) {
      filename = `${filename}.${ext}`;
    }

    assetsMap.set(resolved, {
      id: `asset-${assetsMap.size + 1}`,
      url: resolved,
      filename: sanitizeFilename(filename),
      label: labelHint ? sanitizeFilename(labelHint) : sanitizeFilename(filename),
      ext: ext || category,
      category,
      isSocialEmbed: isKnownVideoPlatform(resolved)
    });
  };

  const imgRegex = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch = tag.match(/\b(?:src|data-src|data-original)=["']([^"']+)["']/i);
    const altMatch = tag.match(/\balt=["']([^"']+)["']/i);
    if (srcMatch) addAsset(srcMatch[1], 'image', altMatch ? altMatch[1] : '');
    const srcsetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',');
      const last = parts[parts.length - 1].trim().split(/\s+/)[0];
      if (last) addAsset(last, 'image');
    }
  }

  const ogRegex = /<meta\b[^>]+property=["']og:(image|video|audio)["'][^>]+content=["']([^"']+)["']/gi;
  while ((m = ogRegex.exec(html)) !== null) {
    addAsset(m[2], m[1].toLowerCase(), `OpenGraph ${m[1]}`);
  }

  const mediaSrcRegex = /<(?:video|audio|source)\b[^>]+src=["']([^"']+)["']/gi;
  while ((m = mediaSrcRegex.exec(html)) !== null) {
    addAsset(m[1], 'video');
  }

  const iframeRegex = /<iframe\b[^>]+src=["']([^"']+)["']/gi;
  while ((m = iframeRegex.exec(html)) !== null) {
    const src = m[1];
    if (isKnownVideoPlatform(src) || src.includes('embed') || src.includes('player')) {
      addAsset(src, 'video', 'Embedded Video Player');
    }
  }

  const linkRegex = /<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = linkRegex.exec(html)) !== null) {
    const href = m[1];
    const innerText = m[2].replace(/<[^>]+>/g, '').trim();
    addAsset(href, 'link', innerText);
  }

  const rawMediaRegex = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|m3u8|webm|mkv|mp3|wav|exe|msi|zip|rar|7z|iso|apk|pdf|png|jpg|jpeg|webp)/gi;
  while ((m = rawMediaRegex.exec(html)) !== null) {
    addAsset(m[0], 'raw');
  }

  const pageTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = pageTitleMatch ? pageTitleMatch[1].replace(/\s+/g, ' ').trim() : finalUrl;

  return {
    pageUrl: finalUrl,
    pageTitle,
    assets: Array.from(assetsMap.values())
  };
}

class ActiveDownloadManager {
  constructor(app) {
    this.app = app;
    this.jobs = new Map();
  }

  startJob(job, onUpdate) {
    if (job.mode === 'ytdlp') {
      this._startYtDlpJob(job, onUpdate);
    } else {
      this._startDirectTurboJob(job, onUpdate);
    }
  }

  pauseJob(jobId) {
    const active = this.jobs.get(jobId);
    if (!active) return false;
    active.paused = true;
    if (active.proc) {
      try { active.proc.kill(); } catch (_) {}
    }
    if (active.turbo) {
      active.turbo.pause();
    }
    return true;
  }

  cancelJob(jobId) {
    const active = this.jobs.get(jobId);
    if (active) {
      active.cancelled = true;
      if (active.proc) {
        try { active.proc.kill(); } catch (_) {}
      }
      if (active.turbo) {
        active.turbo.cancel();
      }
      this.jobs.delete(jobId);
    }
    return true;
  }

  _startYtDlpJob(job, onUpdate) {
    const ytdlpPath = findBinary('yt-dlp', this.app);
    const ffmpegPath = findBinary('ffmpeg', this.app);

    if (!ytdlpPath) {
      onUpdate({
        status: 'error',
        error: 'Video engine is still initializing. Please try again in a moment.'
      });
      return;
    }

    fs.mkdirSync(job.saveDir, { recursive: true });

    const isAudioOnly = (job.quality || '').startsWith('audio') || ['mp3', 'm4a', 'wav', 'flac', 'opus'].includes(job.format);
    const targetFormat = (job.format || (isAudioOnly ? 'mp3' : 'mp4')).toLowerCase();
    const safeBase = sanitizeFilename(job.title || 'video');
    const outputTemplate = path.join(job.saveDir, `${safeBase}.%(ext)s`);

    const args = [
      '--newline',
      '--no-playlist',
      '--continue',
      '--no-warnings',
      '--no-check-certificates',
      '--concurrent-fragments', '16',
      '--buffer-size', '64K',
      '-o', outputTemplate
    ];

    if (job.headers && typeof job.headers === 'object') {
      if (job.headers.Referer) args.push('--add-header', `Referer:${job.headers.Referer}`);
      if (job.headers.Origin) args.push('--add-header', `Origin:${job.headers.Origin}`);
      if (job.headers.Cookie) args.push('--add-header', `Cookie:${job.headers.Cookie}`);
      if (job.headers['User-Agent']) args.push('--user-agent', job.headers['User-Agent']);
    }

    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    if (isAudioOnly) {
      const audioFmt = ['mp3', 'm4a', 'wav', 'flac', 'opus'].includes(targetFormat) ? targetFormat : 'mp3';
      const bitrate = job.quality === 'audio-320' ? '320K' : job.quality === 'audio-128' ? '128K' : '192K';
      args.push('-x', '--audio-format', audioFmt, '--audio-quality', bitrate);
    } else {
      const heightMatch = (job.quality || '').match(/^(\d+)p$/);
      if (heightMatch) {
        const h = parseInt(heightMatch[1], 10);
        // Prefer m4a/aac audio first so merging is instant, fallback to any bestaudio and transcode audio to AAC!
        args.push(
          '-f',
          `bestvideo[height<=${h}]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`
        );
      } else {
        args.push('-f', 'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
      }

      if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(targetFormat)) {
        args.push('--merge-output-format', targetFormat);
      }

      // CRITICAL AUDIO FIX: Ensure audio inside .mp4 is always encoded as universal AAC (-c:a aac)
      // so Windows Media Player / Movies & TV never plays a silent video due to Opus-in-MP4!
      if (targetFormat === 'mp4') {
        args.push('--postprocessor-args', 'Merger+ffmpeg:-c:v copy -c:a aac -b:a 192k');
      }
    }

    args.push(job.url);

    const state = { proc: null, paused: false, cancelled: false };
    this.jobs.set(job.id, state);

    onUpdate({
      status: 'downloading',
      connections: 16,
      speedText: '16x Turbo Connecting...',
      etaText: 'Starting...'
    });

    const proc = spawn(ytdlpPath, args, { windowsHide: true });
    state.proc = proc;

    let finalFilePath = path.join(job.saveDir, `${safeBase}.${targetFormat}`);
    let lastErrorLine = '';

    const parseOutput = (text) => {
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;

        const destMatch = line.match(/\[(?:download|Merger|ExtractAudio)\]\s+Destination:\s+(.+)$/i);
        if (destMatch) {
          finalFilePath = destMatch[1].trim().replace(/^"|"$/g, '');
        }
        const mergeMatch = line.match(/\[Merger\]\s+Merging formats into\s+"(.+)"/i);
        if (mergeMatch) {
          finalFilePath = mergeMatch[1].trim();
        }
        const alreadyMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/i);
        if (alreadyMatch) {
          finalFilePath = alreadyMatch[1].trim();
        }

        const progMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?(\S+)(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/i);
        if (progMatch) {
          const pct = Math.min(99.9, parseFloat(progMatch[1]));
          const sizeStr = progMatch[2];
          const speedStr = progMatch[3] && progMatch[3] !== 'Unknown' ? progMatch[3] : 'Turbo Stream';
          const etaStr = progMatch[4] && progMatch[4] !== 'Unknown' ? progMatch[4] : '--:--';

          const segProgress = Array.from({ length: 8 }, (_, idx) => {
            const boost = ((idx * 7) % 15) - 5;
            return Math.min(100, Math.max(0, Math.round(pct + boost)));
          });

          onUpdate({
            status: 'downloading',
            progress: pct,
            connections: 16,
            segmentProgress: segProgress,
            sizeText: sizeStr,
            speedText: speedStr,
            etaText: etaStr
          });
        } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
          onUpdate({
            status: 'processing',
            progress: 99,
            speedText: 'Merging Video + Audio...',
            etaText: 'Almost done'
          });
        }

        if (line.toLowerCase().includes('error:')) {
          lastErrorLine = line.trim();
        }
      }
    };

    proc.stdout.on('data', (d) => parseOutput(d.toString()));
    proc.stderr.on('data', (d) => parseOutput(d.toString()));

    proc.on('close', async (code) => {
      if (state.cancelled) {
        this.jobs.delete(job.id);
        onUpdate({ status: 'cancelled', speedText: '-', etaText: '-' });
        return;
      }
      if (state.paused) {
        this.jobs.delete(job.id);
        onUpdate({ status: 'paused', speedText: 'Paused', etaText: '-' });
        return;
      }
      if (code === 0) {
        this.jobs.delete(job.id);

        // Verify if downloaded video file has an audio stream, and if a separate audioUrl was captured, merge it!
        let verifiedHasAudio = job.hasAudio !== false;
        if (ffmpegPath && fs.existsSync(finalFilePath) && !isAudioOnly) {
          const fileProbe = await probeMediaAudioAndDuration(ffmpegPath, finalFilePath, {}, 3500);
          if (fileProbe.probed) {
            verifiedHasAudio = fileProbe.hasAudio;
          }
          // If the downloaded file has no audio AND we captured a separate audioUrl from the streaming player, merge them now!
          if (!verifiedHasAudio && job.audioUrl) {
            onUpdate({
              status: 'processing',
              progress: 99,
              speedText: 'Merging Separate Audio Track...',
              etaText: 'Almost done'
            });
            const mergedTemp = `${finalFilePath}.merged.mp4`;
            const headerLines = [];
            if (job.headers) {
              if (job.headers.Referer) headerLines.push(`Referer: ${job.headers.Referer}`);
              if (job.headers.Origin) headerLines.push(`Origin: ${job.headers.Origin}`);
              if (job.headers.Cookie) headerLines.push(`Cookie: ${job.headers.Cookie}`);
              if (job.headers['User-Agent']) headerLines.push(`User-Agent: ${job.headers['User-Agent']}`);
            }
            const ffArgs = ['-y', '-i', finalFilePath];
            if (headerLines.length > 0) {
              ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
            }
            ffArgs.push('-i', job.audioUrl, '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0', '-shortest', mergedTemp);

            await new Promise((resolve) => {
              const mp = spawn(ffmpegPath, ffArgs, { windowsHide: true });
              mp.on('close', (mCode) => {
                if (mCode === 0 && fs.existsSync(mergedTemp)) {
                  try {
                    fs.unlinkSync(finalFilePath);
                    fs.renameSync(mergedTemp, finalFilePath);
                    verifiedHasAudio = true;
                  } catch (_) {}
                } else {
                  try { if (fs.existsSync(mergedTemp)) fs.unlinkSync(mergedTemp); } catch (_) {}
                }
                resolve();
              });
              mp.on('error', () => resolve());
            });
          }
        }

        let sizeBytes = 0;
        try {
          if (fs.existsSync(finalFilePath)) {
            sizeBytes = fs.statSync(finalFilePath).size;
          }
        } catch (_) {}
        onUpdate({
          status: 'completed',
          progress: 100,
          hasAudio: verifiedHasAudio,
          filePath: finalFilePath,
          sizeText: sizeBytes ? formatBytes(sizeBytes) : job.sizeText,
          speedText: 'Done',
          etaText: '00:00',
          completedAt: new Date().toISOString()
        });
      } else if (ffmpegPath && fs.existsSync(ffmpegPath) && (job.url.includes('.m3u8') || job.headers)) {
        this._startFfmpegStreamFallback(job, ffmpegPath, finalFilePath, state, onUpdate);
      } else {
        this.jobs.delete(job.id);
        onUpdate({
          status: 'error',
          error: lastErrorLine || `Could not download video stream (code ${code})`,
          speedText: 'Failed',
          etaText: '-'
        });
      }
    });

    proc.on('error', (err) => {
      this.jobs.delete(job.id);
      onUpdate({
        status: 'error',
        error: err.message,
        speedText: 'Failed',
        etaText: '-'
      });
    });
  }

  _startFfmpegStreamFallback(job, ffmpegPath, finalFilePath, state, onUpdate) {
    const headerLines = [];
    if (job.headers) {
      if (job.headers.Referer) headerLines.push(`Referer: ${job.headers.Referer}`);
      if (job.headers.Origin) headerLines.push(`Origin: ${job.headers.Origin}`);
      if (job.headers.Cookie) headerLines.push(`Cookie: ${job.headers.Cookie}`);
      if (job.headers['User-Agent']) headerLines.push(`User-Agent: ${job.headers['User-Agent']}`);
    }

    const ffArgs = ['-y'];
    if (headerLines.length > 0) {
      ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
    }
    ffArgs.push('-i', job.url);
    if (job.audioUrl) {
      if (headerLines.length > 0) {
        ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
      }
      ffArgs.push('-i', job.audioUrl, '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0');
    } else {
      ffArgs.push('-c:v', 'copy', '-c:a', 'aac');
    }
    ffArgs.push(finalFilePath);

    onUpdate({
      status: 'downloading',
      progress: 25,
      speedText: 'Recording Video + Audio...',
      etaText: 'Streaming'
    });

    const ffProc = spawn(ffmpegPath, ffArgs, { windowsHide: true });
    state.proc = ffProc;

    ffProc.on('close', async (code) => {
      this.jobs.delete(job.id);
      if (state.cancelled) return onUpdate({ status: 'cancelled' });
      if (state.paused) return onUpdate({ status: 'paused' });
      if (code === 0 && fs.existsSync(finalFilePath)) {
        const sz = fs.statSync(finalFilePath).size;
        const probe = await probeMediaAudioAndDuration(ffmpegPath, finalFilePath, {}, 3000);
        onUpdate({
          status: 'completed',
          progress: 100,
          hasAudio: probe.probed ? probe.hasAudio : (job.hasAudio !== false),
          filePath: finalFilePath,
          sizeText: formatBytes(sz),
          speedText: 'Done',
          etaText: '00:00',
          completedAt: new Date().toISOString()
        });
      } else {
        onUpdate({
          status: 'error',
          error: 'Stream capture failed. Try opening Episode/Server Picker and pressing Play.',
          speedText: 'Failed'
        });
      }
    });
  }

  _startDirectTurboJob(job, onUpdate) {
    fs.mkdirSync(job.saveDir, { recursive: true });

    const requestedExt = (job.format || job.ext || '').toLowerCase().replace(/^\./, '');
    let baseName = sanitizeFilename(job.filename || job.title || 'download');
    const currentExt = path.extname(baseName).replace(/^\./, '').toLowerCase();

    if (!currentExt && requestedExt && requestedExt !== 'original') {
      baseName = `${baseName}.${requestedExt}`;
    }

    const tempFilePath = path.join(job.saveDir, `${baseName}.part`);
    const finalDestPath = path.join(job.saveDir, baseName);

    const turbo = new TurboSegmentedJob(job, 8, onUpdate);
    const state = { turbo, paused: false, cancelled: false };
    this.jobs.set(job.id, state);

    turbo.start(tempFilePath, finalDestPath, async (err, completedPath) => {
      this.jobs.delete(job.id);
      if (state.cancelled) {
        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
        return onUpdate({ status: 'cancelled', speedText: '-', etaText: '-' });
      }
      if (state.paused) {
        return onUpdate({ status: 'paused', speedText: 'Paused', etaText: '-' });
      }
      if (err) {
        return onUpdate({ status: 'error', error: err.message, speedText: 'Failed' });
      }

      try {
        let outputPath = completedPath;
        const ffmpegPath = findBinary('ffmpeg', this.app);
        if (requestedExt && requestedExt !== 'original' && currentExt && requestedExt !== currentExt) {
          if (ffmpegPath && fs.existsSync(ffmpegPath)) {
            onUpdate({
              status: 'processing',
              progress: 99,
              speedText: `Converting to .${requestedExt}...`,
              etaText: 'Almost done'
            });
            const convertedPath = path.join(
              job.saveDir,
              `${path.basename(completedPath, path.extname(completedPath))}.${requestedExt}`
            );
            await new Promise((resolve) => {
              const ff = spawn(ffmpegPath, ['-y', '-i', completedPath, convertedPath], { windowsHide: true });
              ff.on('close', (code) => {
                if (code === 0 && fs.existsSync(convertedPath)) {
                  outputPath = convertedPath;
                }
                resolve();
              });
              ff.on('error', () => resolve());
            });
          }
        }

        let verifiedHasAudio = job.hasAudio !== false;
        if (job.category === 'video' && ffmpegPath && fs.existsSync(outputPath)) {
          const probe = await probeMediaAudioAndDuration(ffmpegPath, outputPath, {}, 3000);
          if (probe.probed) verifiedHasAudio = probe.hasAudio;
        }

        const finalStat = fs.statSync(outputPath);
        onUpdate({
          status: 'completed',
          progress: 100,
          hasAudio: verifiedHasAudio,
          segmentProgress: [100, 100, 100, 100, 100, 100, 100, 100],
          filePath: outputPath,
          sizeText: formatBytes(finalStat.size),
          speedText: 'Done',
          etaText: '00:00',
          completedAt: new Date().toISOString()
        });
      } catch (e) {
        onUpdate({ status: 'error', error: e.message, speedText: 'Failed' });
      }
    });
  }
}

module.exports = {
  analyzeUrl,
  probeHttpHead,
  scanWebpageAssets,
  ActiveDownloadManager,
  formatBytes,
  formatDuration,
  sanitizeFilename
};
