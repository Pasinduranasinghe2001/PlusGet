const { BrowserWindow, session, Menu, MenuItem } = require('electron');
const https = require('https');
const http = require('http');
const {
  formatBytes,
  formatDuration,
  sanitizeFilename,
  getCategoryByExtension,
  probeMediaAudioAndDuration
} = require('./utils.cjs');
const { findBinary } = require('./binaries.cjs');

const AD_BLOCK_PATTERNS = [
  'doubleclick.net',
  'googlesyndication.com',
  'adservice.google.',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'adsterra.com',
  'exoclick.com',
  'juicyads.com',
  'clickadu.com',
  'hilltopads.net',
  'trafficjunky.net',
  'tsyndicate.com',
  'acscdn.com',
  'onclkds.com',
  'histats.com'
];

function isBlockedAdUrl(urlStr) {
  const lower = (urlStr || '').toLowerCase();
  return AD_BLOCK_PATTERNS.some((pat) => lower.includes(pat));
}

function isMediaStreamCandidate(urlStr, contentType = '', contentLength = 0) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  const lower = urlStr.toLowerCase();

  if (
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.includes('.js') ||
    lower.includes('.css') ||
    lower.includes('.png') ||
    lower.includes('.jpg') ||
    lower.includes('.jpeg') ||
    lower.includes('.webp') ||
    lower.includes('.gif') ||
    lower.includes('.svg') ||
    lower.includes('.woff') ||
    lower.includes('.ico') ||
    lower.includes('google-analytics') ||
    lower.includes('doubleclick')
  ) {
    return null;
  }

  if (/\.ts(\?|$)/i.test(lower) || /\.m4s(\?|$)/i.test(lower)) {
    return null;
  }

  const ct = (contentType || '').toLowerCase();

  if (
    /\.m3u8(\?|$|#)/i.test(lower) ||
    lower.includes('.m3u8') ||
    ct.includes('mpegurl') ||
    ct.includes('apple.mpegurl')
  ) {
    let decoded = lower;
    try { decoded = decodeURIComponent(lower); } catch (_) {}

    const isLikelyAudioOnly = /(?:^|[\/_-])(?:audio|a0|a1|a2|eng|sound)(?:\.m3u8|[\/_.-]|$)/i.test(decoded);
    const isVariantVideoOnly = /(?:^|[\/_-])(?:v0|v1|v2|video)(?:\.m3u8|[\/_.-]|$)/i.test(decoded);
    const isMasterHint = decoded.includes('master') || decoded.includes('index.m3u8') || decoded.includes('playlist') || decoded.includes('manifest');
    return {
      type: 'hls',
      ext: 'mp4',
      isLikelyAudioOnly,
      isVariantVideoOnly,
      priority: isMasterHint ? 15 : isLikelyAudioOnly ? 3 : isVariantVideoOnly ? 6 : 9
    };
  }

  if (/\.mpd(\?|$|#)/i.test(lower) || ct.includes('dash+xml')) {
    return { type: 'dash', ext: 'mp4', priority: 10 };
  }

  if (/\.vtt(\?|$)/i.test(lower) || /\.srt(\?|$)/i.test(lower) || ct.includes('text/vtt')) {
    return { type: 'subtitle', ext: 'vtt', priority: 1 };
  }

  if (
    /\.(mp4|webm|mkv)(\?|$)/i.test(lower) ||
    ct.startsWith('video/mp4') ||
    ct.startsWith('video/webm') ||
    ct.startsWith('video/x-matroska')
  ) {
    if (contentLength > 0 && contentLength < 1_000_000) return null;
    return { type: 'direct-video', ext: 'mp4', priority: 7 };
  }

  return null;
}

function fetchTextWithHeaders(urlStr, headers = {}, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(urlStr, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          ...(headers.Referer ? { Referer: headers.Referer } : {}),
          ...(headers.Origin ? { Origin: headers.Origin } : {}),
          ...(headers.Cookie ? { Cookie: headers.Cookie } : {})
        }
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          if (data.length < 400_000) data += c;
        });
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => {
        req.destroy();
        resolve('');
      });
    } catch (_) {
      resolve('');
    }
  });
}

async function getVideoDurationAcrossFrames(webContents) {
  if (!webContents || webContents.isDestroyed()) return 0;
  try {
    const frames = webContents.mainFrame?.framesInSubtree || [webContents.mainFrame];
    for (const frame of frames) {
      if (!frame || frame.isDestroyed?.()) continue;
      try {
        const dur = await frame.executeJavaScript(`
          (function() {
            const videos = document.querySelectorAll('video');
            for (const v of videos) {
              if (v.duration && isFinite(v.duration) && v.duration > 5) {
                return Math.round(v.duration);
              }
            }
            return 0;
          })();
        `);
        if (dur && dur > 5) return dur;
      } catch (_) {}
    }
  } catch (_) {}
  return 0;
}

function estimateBytesForHeight(height, durationSec, bandwidthBps = 0) {
  const dur = durationSec > 60 ? durationSec : 2700;
  if (bandwidthBps > 50_000) {
    return Math.round((bandwidthBps / 8) * dur);
  }
  const kbpsMap = {
    2160: 6500,
    1440: 3800,
    1080: 2200,
    720: 1150,
    480: 620,
    360: 360
  };
  const kbps = kbpsMap[height] || 1200;
  return Math.round(((kbps * 1000) / 8) * dur);
}

async function parseM3u8Qualities(m3u8Url, headers, hintDurationSec = 0, ffmpegPath = null) {
  let effectiveUrl = m3u8Url;
  let text = await fetchTextWithHeaders(effectiveUrl, headers);

  // If the captured URL is a child variant playlist like v0.m3u8, v1.m3u8, v2.m3u8, or index.m3u8,
  // check if sibling master.m3u8 (Master Playlist with Audio + Video!) exists on the same CDN!
  if (text && !text.includes('#EXT-X-STREAM-INF') && /(%2F|\/)(?:v\d+|a\d+|index|playlist|video)\.m3u8/i.test(effectiveUrl)) {
    for (const masterName of ['master.m3u8', 'index.m3u8', 'playlist.m3u8']) {
      const candidateMasterUrl = effectiveUrl.replace(
        /(%2F|\/)(?:v\d+|a\d+|index|playlist|video)\.m3u8/i,
        (_match, sep) => `${sep}${masterName}`
      );
      if (candidateMasterUrl === effectiveUrl) continue;
      const masterText = await fetchTextWithHeaders(candidateMasterUrl, headers, 4500);
      if (masterText && masterText.includes('#EXT-X-STREAM-INF')) {
        effectiveUrl = candidateMasterUrl;
        text = masterText;
        break;
      }
    }
  }

  let durationSec = hintDurationSec || 0;
  const isMaster = Boolean(text && text.includes('#EXT-X-STREAM-INF'));

  // Check if master playlist explicitly declares audio tracks or audio codecs
  let manifestHasAudio = true;
  let separateAudioUrl = null;

  if (text && text.includes('#EXTM3U')) {
    const audioMediaMatch = text.match(/#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO[^\r\n]*URI="([^"]+)"/i);
    if (audioMediaMatch && audioMediaMatch[1]) {
      try {
        separateAudioUrl = new URL(audioMediaMatch[1], m3u8Url).toString();
        manifestHasAudio = true;
      } catch (_) {}
    }

    if (isMaster) {
      // Check CODECS attribute if present
      const codecsMatches = text.match(/CODECS="([^"]+)"/gi);
      if (codecsMatches && codecsMatches.length > 0 && !audioMediaMatch) {
        const anyHasAudioCodec = codecsMatches.some((c) => /mp4a|aac|ac-3|ec-3|opus|vorbis|mp3/i.test(c));
        manifestHasAudio = anyHasAudioCodec;
      }
    }
  }

  if (text && text.includes('#EXTINF:')) {
    let sum = 0;
    const infRegex = /#EXTINF:(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = infRegex.exec(text)) !== null) {
      sum += parseFloat(m[1]);
    }
    if (sum > 10) durationSec = Math.round(sum);
  }

  const streamMap = new Map();
  let firstVariantUrl = null;

  if (isMaster) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
        const bwMatch = line.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);
        const nextLine = (lines[i + 1] || '').trim();
        if (nextLine && !nextLine.startsWith('#') && !firstVariantUrl) {
          try {
            firstVariantUrl = new URL(nextLine, m3u8Url).toString();
          } catch (_) {}
        }
        if (resMatch) {
          const h = parseInt(resMatch[2], 10);
          const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
          if (h >= 144 && h <= 4320) {
            if (!streamMap.has(h) || bw > streamMap.get(h).bandwidth) {
              streamMap.set(h, { height: h, bandwidth: bw });
            }
          }
        }
      }
    }
  }

  if (durationSec <= 0 && firstVariantUrl) {
    const varText = await fetchTextWithHeaders(firstVariantUrl, headers, 4500);
    if (varText && varText.includes('#EXTINF:')) {
      let sum = 0;
      const infRegex = /#EXTINF:(\d+(?:\.\d+)?)/g;
      let m;
      while ((m = infRegex.exec(varText)) !== null) {
        sum += parseFloat(m[1]);
      }
      if (sum > 10) durationSec = Math.round(sum);
    }
  }

  // Also probe with FFmpeg if it's a single variant playlist or if we want to verify audio track presence
  if (ffmpegPath && (!isMaster || durationSec <= 0)) {
    const probe = await probeMediaAudioAndDuration(ffmpegPath, m3u8Url, headers, 4000);
    if (probe.probed) {
      if (!separateAudioUrl) manifestHasAudio = probe.hasAudio;
      if (durationSec <= 0 && probe.durationSec > 0) durationSec = probe.durationSec;
    }
  }

  const durationText = formatDuration(durationSec);
  const heights = streamMap.size > 0
    ? Array.from(streamMap.keys()).sort((a, b) => b - a)
    : [1080, 720, 480, 360];

  const qualities = [];
  for (const h of heights) {
    const meta = streamMap.get(h);
    const estBytes = estimateBytesForHeight(h, durationSec, meta?.bandwidth || 0);
    const rawSize = `~${formatBytes(estBytes)}`;
    const combined = durationText ? `${rawSize} / ${durationText}` : rawSize;
    const tag = h >= 2160 ? '4K Ultra HD' : h >= 1440 ? '2K QHD' : h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : 'Standard';
    qualities.push({
      id: `${h}p`,
      label: `${h}p (${tag}) — ${combined}`,
      height: h,
      estimatedBytes: estBytes,
      sizeText: rawSize,
      durationText,
      hasAudio: manifestHasAudio
    });
  }

  if (manifestHasAudio) {
    const audioBytes = Math.round(((192 * 1000) / 8) * (durationSec > 60 ? durationSec : 2700));
    const audioRawSize = `~${formatBytes(audioBytes)}`;
    qualities.push({
      id: 'audio-320',
      label: `Audio Only (MP3) — ${durationText ? `${audioRawSize} / ${durationText}` : audioRawSize}`,
      height: 0,
      isAudioOnly: true,
      estimatedBytes: audioBytes,
      sizeText: audioRawSize,
      durationText,
      hasAudio: true
    });
  }

  return {
    effectiveUrl,
    qualities,
    durationSec,
    durationText,
    isMaster,
    hasAudio: manifestHasAudio,
    separateAudioUrl
  };
}

function attachSessionSniffer(ses, onStreamFound) {
  const requestHeadersMap = new Map();
  const seenUrls = new Set();

  const beforeSendListener = (details, callback) => {
    if (isBlockedAdUrl(details.url)) {
      return callback({ cancel: true });
    }
    requestHeadersMap.set(details.id, {
      url: details.url,
      headers: details.requestHeaders || {},
      referrer: details.referrer || ''
    });

    const candidate = isMediaStreamCandidate(details.url, '', 0);
    if (candidate && candidate.type !== 'subtitle' && !seenUrls.has(details.url)) {
      seenUrls.add(details.url);
      const reqH = details.requestHeaders || {};
      const capturedHeaders = {
        Referer: reqH.Referer || reqH.referer || details.referrer || '',
        Origin: reqH.Origin || reqH.origin || '',
        'User-Agent': reqH['User-Agent'] || reqH['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        Cookie: reqH.Cookie || reqH.cookie || ''
      };
      onStreamFound({
        streamUrl: details.url,
        streamType: candidate.type,
        isLikelyAudioOnly: Boolean(candidate.isLikelyAudioOnly),
        priority: candidate.priority,
        headers: capturedHeaders
      });
    }

    callback({ cancel: false, requestHeaders: details.requestHeaders });
  };

  const headersReceivedListener = (details, callback) => {
    const respHeaders = details.responseHeaders || {};
    const ctArr = respHeaders['content-type'] || respHeaders['Content-Type'] || [];
    const clArr = respHeaders['content-length'] || respHeaders['Content-Length'] || [];
    const contentType = Array.isArray(ctArr) ? ctArr[0] : ctArr;
    const contentLength = parseInt(Array.isArray(clArr) ? clArr[0] : clArr || '0', 10);

    const candidate = isMediaStreamCandidate(details.url, contentType, contentLength);
    if (candidate && !seenUrls.has(details.url)) {
      seenUrls.add(details.url);
      const savedReq = requestHeadersMap.get(details.id) || {};
      const reqH = savedReq.headers || {};
      const capturedHeaders = {
        Referer: reqH.Referer || reqH.referer || savedReq.referrer || '',
        Origin: reqH.Origin || reqH.origin || '',
        'User-Agent': reqH['User-Agent'] || reqH['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        Cookie: reqH.Cookie || reqH.cookie || ''
      };
      onStreamFound({
        streamUrl: details.url,
        streamType: candidate.type,
        isLikelyAudioOnly: Boolean(candidate.isLikelyAudioOnly),
        priority: candidate.priority,
        contentLength: contentLength || 0,
        headers: capturedHeaders
      });
    }

    callback({ cancel: false, responseHeaders: details.responseHeaders });
  };

  ses.webRequest.onBeforeSendHeaders(beforeSendListener);
  ses.webRequest.onHeadersReceived(headersReceivedListener);

  return () => {
    try {
      ses.webRequest.onBeforeSendHeaders(null);
      ses.webRequest.onHeadersReceived(null);
    } catch (_) {}
  };
}

/**
 * 1. Automatic Background Stream Sniffer
 */
async function autoSniffStream(pageUrl, timeoutMs = 14000, app = null) {
  const ffmpegPath = findBinary('ffmpeg', app);
  return new Promise((resolve) => {
    const partition = `persist:pulseget-sniffer`;
    const ses = session.fromPartition(partition);

    let win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });

    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let bestStream = null;
    let separateAudioStreamUrl = null;
    let subtitles = [];
    let resolved = false;

    const finish = async () => {
      if (resolved) return;
      resolved = true;
      detach();
      let pageTitle = '';
      let domDuration = 0;
      try {
        if (win && !win.isDestroyed()) {
          pageTitle = await win.webContents.executeJavaScript('document.title || ""').catch(() => '');
          domDuration = await getVideoDurationAcrossFrames(win.webContents);
          win.destroy();
        }
      } catch (_) {}
      win = null;

      if (!bestStream) {
        return resolve(null);
      }

      let parsedInfo;
      if (bestStream.streamType === 'hls') {
        parsedInfo = await parseM3u8Qualities(bestStream.streamUrl, bestStream.headers, domDuration, ffmpegPath);
      } else {
        const probe = await probeMediaAudioAndDuration(ffmpegPath, bestStream.streamUrl, bestStream.headers, 4000);
        const durSec = domDuration || probe.durationSec || 0;
        const durTxt = formatDuration(durSec);
        const hasAud = probe.probed ? probe.hasAudio : true;
        parsedInfo = {
          durationSec: durSec,
          durationText: durTxt,
          hasAudio: hasAud,
          qualities: [
            {
              id: '1080p',
              label: `1080p (Full HD) — ${bestStream.contentLength ? formatBytes(bestStream.contentLength) : '~450 MB'}`,
              height: 1080,
              estimatedBytes: bestStream.contentLength || 450 * 1024 * 1024,
              sizeText: bestStream.contentLength ? formatBytes(bestStream.contentLength) : '~450 MB',
              durationText: durTxt,
              hasAudio: hasAud
            },
            {
              id: '720p',
              label: '720p (HD) — ~240 MB',
              height: 720,
              estimatedBytes: 240 * 1024 * 1024,
              sizeText: '~240 MB',
              durationText: durTxt,
              hasAudio: hasAud
            },
            {
              id: '480p',
              label: '480p (Standard) — ~130 MB',
              height: 480,
              estimatedBytes: 130 * 1024 * 1024,
              sizeText: '~130 MB',
              durationText: durTxt,
              hasAudio: hasAud
            }
          ]
        };
      }

      if ( parsedInfo.effectiveUrl ) {
        bestStream.streamUrl = parsedInfo.effectiveUrl;
      }
      const finalAudioUrl = parsedInfo.separateAudioUrl || separateAudioStreamUrl || null;
      const finalHasAudio = Boolean(parsedInfo.hasAudio || finalAudioUrl);

      const cleanTitle = (pageTitle || '')
        .replace(/\s*[-|]\s*(?:BaiscopeWatch|Watch Online|Free).*$/i, '')
        .trim() || 'Movie_Episode';

      resolve({
        ...bestStream,
        audioUrl: finalAudioUrl,
        hasAudio: finalHasAudio,
        pageUrl,
        pageTitle: cleanTitle,
        durationSec: parsedInfo.durationSec,
        durationText: parsedInfo.durationText || formatDuration(parsedInfo.durationSec),
        totalSize: parsedInfo.qualities[0]?.estimatedBytes || bestStream.contentLength || 0,
        sizeText: parsedInfo.qualities[0]?.sizeText || formatBytes(bestStream.contentLength),
        subtitles,
        qualities: parsedInfo.qualities.map((q) => ({ ...q, hasAudio: finalHasAudio }))
      });
    };

    const detach = attachSessionSniffer(ses, (found) => {
      if (found.streamType === 'subtitle') {
        subtitles.push(found.streamUrl);
        return;
      }
      if (found.isLikelyAudioOnly) {
        separateAudioStreamUrl = found.streamUrl;
        return;
      }
      if (!bestStream || found.priority > bestStream.priority) {
        bestStream = found;
        setTimeout(() => finish(), 1500);
      }
    });

    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);

    win.webContents.on('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript(`
          (function() {
            const v = document.querySelector('video');
            if (v) { v.muted = true; v.play().catch(()=>{}); }
            const playBtns = document.querySelectorAll('.jw-icon-display, .plyr__control--overlaid, .vjs-big-play-button, [aria-label*="Play" i], button[class*="play" i]');
            playBtns.forEach(b => { try { b.click(); } catch(e){} });
          })();
        `);
      } catch (_) {}
    });

    win.loadURL(pageUrl).catch(() => {
      clearTimeout(timer);
      finish();
    });
  });
}

/**
 * 2. Interactive Smart Browser / Episode Picker / Download Button Interceptor
 */
let pickerWindow = null;
let willDownloadAttached = false;

function openInteractiveStreamPicker(pageUrl, parentWindow, onStreamDetected, onDirectIntercepted, app = null) {
  const ffmpegPath = findBinary('ffmpeg', app);
  const partition = `persist:pulseget-sniffer`;
  const ses = session.fromPartition(partition);

  if (!willDownloadAttached) {
    willDownloadAttached = true;
    ses.on('will-download', (event, item, webContents) => {
      event.preventDefault();
      const url = item.getURL();
      const filename = sanitizeFilename(item.getFilename() || 'download');
      const totalBytes = item.getTotalBytes() || 0;
      const mimeType = item.getMimeType() || '';
      const ext = (filename.split('.').pop() || '').toLowerCase();
      const category = mimeType.startsWith('image/')
        ? 'image'
        : mimeType.startsWith('video/')
        ? 'video'
        : mimeType.startsWith('audio/')
        ? 'audio'
        : getCategoryByExtension(ext);

      if (onDirectIntercepted) {
        onDirectIntercepted({
          mode: 'direct',
          url,
          pageUrl: webContents ? webContents.getURL() : pageUrl,
          title: filename,
          filename,
          category: category === 'other' ? 'setup' : category,
          totalSize: totalBytes,
          sizeText: totalBytes > 0 ? formatBytes(totalBytes) : 'Ready',
          ext: ext || 'bin',
          formats: [ext || 'original'],
          qualities: [
            { id: 'original', label: `Original File (${totalBytes > 0 ? formatBytes(totalBytes) : 'Turbo Speed'})`, sizeText: formatBytes(totalBytes) }
          ]
        });
      }
      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.show();
        parentWindow.focus();
      }
    });
  }

  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.focus();
    pickerWindow.loadURL(pageUrl);
    return;
  }

  pickerWindow = new BrowserWindow({
    width: 1140,
    height: 760,
    parent: parentWindow || undefined,
    title: 'PlusGet Smart Browser — Click Any Episode, Video, Image or Download Button',
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  pickerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isBlockedAdUrl(url)) return { action: 'deny' };
    if (/\.(mp4|mkv|zip|rar|7z|exe|msi|iso|apk|pdf|srt)(\?|$)/i.test(url)) {
      pickerWindow.loadURL(url);
    }
    return { action: 'deny' };
  });

  pickerWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    if (params.mediaType === 'image' && params.srcURL) {
      menu.append(
        new MenuItem({
          label: '🖼 Download Image with PlusGet Turbo',
          click: () => {
            const rawName = decodeURIComponent((new URL(params.srcURL).pathname.split('/').pop() || 'image.jpg'));
            const filename = sanitizeFilename(rawName.includes('.') ? rawName : `${rawName}.jpg`);
            if (onDirectIntercepted) {
              onDirectIntercepted({
                mode: 'direct',
                url: params.srcURL,
                pageUrl: params.pageURL,
                title: filename,
                filename,
                category: 'image',
                thumbnail: params.srcURL,
                totalSize: 0,
                sizeText: 'High-Res Image',
                ext: filename.split('.').pop() || 'jpg',
                formats: ['jpg', 'png', 'webp', 'ico'],
                qualities: [{ id: 'original', label: 'Original Resolution Image', sizeText: 'Image' }]
              });
            }
            if (parentWindow && !parentWindow.isDestroyed()) parentWindow.focus();
          }
        })
      );
    }

    if (params.linkURL) {
      menu.append(
        new MenuItem({
          label: '⚡ Download Link with PlusGet Turbo',
          click: () => {
            const rawName = decodeURIComponent((new URL(params.linkURL).pathname.split('/').pop() || 'download'));
            const filename = sanitizeFilename(rawName);
            if (onDirectIntercepted) {
              onDirectIntercepted({
                mode: 'direct',
                url: params.linkURL,
                pageUrl: params.pageURL,
                title: filename,
                filename,
                category: getCategoryByExtension(filename.split('.').pop()),
                totalSize: 0,
                sizeText: 'Checking MB...',
                ext: filename.split('.').pop() || 'bin',
                formats: [filename.split('.').pop() || 'original'],
                qualities: [{ id: 'original', label: 'Original File', sizeText: 'Auto' }]
              });
            }
            if (parentWindow && !parentWindow.isDestroyed()) parentWindow.focus();
          }
        })
      );
    }

    if (menu.items.length > 0) {
      menu.popup({ window: pickerWindow });
    }
  });

  // Track master playlist so a child video-only variant .m3u8 NEVER overwrites the master .m3u8!
  let currentMasterStream = null;
  let currentMasterTimestamp = 0;
  let latestAudioStreamUrl = null;
  let subtitles = [];

  const injectHelperBanner = async (streamReady = false, episodeTitle = '', sizeAndTimeBadge = '', hasAudio = true) => {
    if (!pickerWindow || pickerWindow.isDestroyed()) return;
    const audioBadgeText = hasAudio ? '🔊 Audio Included' : '🔇 No Audio (Video Only)';
    try {
      await pickerWindow.webContents.executeJavaScript(`
        (function() {
          let bar = document.getElementById('pulseget-helper-bar');
          if (!bar) {
            bar = document.createElement('div');
            bar.id = 'pulseget-helper-bar';
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;font-family:system-ui,-apple-system,sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.6);transition:all 0.25s ease;';
            document.documentElement.appendChild(bar);
            document.body.style.marginTop = '48px';
          }
          if (${streamReady ? 'true' : 'false'}) {
            bar.style.background = '${hasAudio ? 'linear-gradient(90deg, #065f46, #047857, #0f766e)' : 'linear-gradient(90deg, #78350f, #92400e, #b45309)'}';
            bar.style.borderBottom = '1px solid ${hasAudio ? '#34d399' : '#fbbf24'}';
            bar.innerHTML = \`
              <div style="display:flex;align-items:center;gap:10px;color:#ecfdf5;font-weight:700;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${hasAudio ? '#34d399' : '#fbbf24'};"></span>
                <span>✅ Ready: ${episodeTitle.replace(/'/g, '')} (${sizeAndTimeBadge.replace(/'/g, '')} • ${audioBadgeText})</span>
              </div>
              <div style="color:#ecfdf5;background:rgba(0,0,0,0.28);padding:4px 12px;border-radius:8px;font-size:12px;font-weight:700;">
                Sent to PlusGet! Switch to PlusGet to Download ▶
              </div>
            \`;
          } else {
            bar.style.background = 'linear-gradient(90deg, #0f172a, #1e1b4b, #0f172a)';
            bar.style.borderBottom = '1px solid #38bdf8';
            bar.innerHTML = \`
              <div style="display:flex;align-items:center;gap:10px;color:#e0f2fe;font-weight:600;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#38bdf8;"></span>
                <span>PlusGet Smart Grabber: Click any Episode/Server & Play, click any Download Button, or Right-Click any Image!</span>
              </div>
              <div style="color:#94a3b8;font-size:12px;">
                Ad-Popups Blocked • Waiting for selection...
              </div>
            \`;
          }
        })();
      `);
    } catch (_) {}
  };

  const detach = attachSessionSniffer(ses, async (found) => {
    if (found.streamType === 'subtitle') {
      if (!subtitles.includes(found.streamUrl)) subtitles.push(found.streamUrl);
      return;
    }

    if (found.isLikelyAudioOnly) {
      latestAudioStreamUrl = found.streamUrl;
      return;
    }

    let pageTitle = 'Movie_Episode';
    let domDuration = 0;

    try {
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        const info = await pickerWindow.webContents.executeJavaScript(`
          (function() {
            const title = document.title || '';
            let ep = '';
            const activeEls = document.querySelectorAll('[class*="active" i], [class*="selected" i], [style*="rgb(220, 38, 38)"], .bg-red-600, .bg-red-500');
            activeEls.forEach(el => {
              const t = (el.innerText || '').trim();
              if (/S\\d+.*E\\d+/i.test(t) || /^Episode\\s*\\d+/i.test(t)) ep = t;
            });
            return { title, ep };
          })();
        `);
        domDuration = await getVideoDurationAcrossFrames(pickerWindow.webContents);
        pageTitle = (info?.title || 'Video')
          .replace(/\s*[-|]\s*(?:BaiscopeWatch|Watch Online|Free).*$/i, '')
          .trim();
        if (info?.ep && !pageTitle.includes(info.ep)) {
          pageTitle = `${pageTitle} - ${info.ep.replace(/\s+/g, ' ')}`;
        }
      }
    } catch (_) {}

    let parsedInfo;
    if (found.streamType === 'hls') {
      parsedInfo = await parseM3u8Qualities(found.streamUrl, found.headers, domDuration, ffmpegPath);

      // CRITICAL FIX: If we already captured a Master .m3u8 within the last 12 seconds for this episode,
      // and the new request is a non-master child variant .m3u8 (which is often video-only!),
      // DO NOT overwrite the Master .m3u8!
      if (parsedInfo.isMaster) {
        currentMasterStream = { found, parsedInfo };
        currentMasterTimestamp = Date.now();
      } else if (currentMasterStream && (Date.now() - currentMasterTimestamp < 12000)) {
        return;
      }
    } else {
      const probe = await probeMediaAudioAndDuration(ffmpegPath, found.streamUrl, found.headers, 4000);
      const durSec = domDuration || probe.durationSec || 0;
      const durTxt = formatDuration(durSec);
      const hasAud = probe.probed ? probe.hasAudio : true;
      parsedInfo = {
        durationSec: durSec,
        durationText: durTxt,
        hasAudio: hasAud,
        qualities: [
          {
            id: '1080p',
            label: `1080p (Full HD) — ${found.contentLength ? formatBytes(found.contentLength) : '~450 MB'}`,
            height: 1080,
            estimatedBytes: found.contentLength || 450 * 1024 * 1024,
            sizeText: found.contentLength ? formatBytes(found.contentLength) : '~450 MB',
            durationText: durTxt,
            hasAudio: hasAud
          },
          {
            id: '720p',
            label: '720p (HD) — ~240 MB',
            height: 720,
            estimatedBytes: 240 * 1024 * 1024,
            sizeText: '~240 MB',
            durationText: durTxt,
            hasAudio: hasAud
          },
          {
            id: '480p',
            label: '480p (Standard) — ~130 MB',
            height: 480,
            estimatedBytes: 130 * 1024 * 1024,
            sizeText: '~130 MB',
            durationText: durTxt,
            hasAudio: hasAud
          }
        ]
      };
    }

    if (parsedInfo.effectiveUrl) {
      found.streamUrl = parsedInfo.effectiveUrl;
    }
    const finalAudioUrl = parsedInfo.separateAudioUrl || latestAudioStreamUrl || null;
    const finalHasAudio = Boolean(parsedInfo.hasAudio || finalAudioUrl);

    const topSize = parsedInfo.qualities[0]?.sizeText || '~350 MB';
    const topDur = parsedInfo.durationText || formatDuration(parsedInfo.durationSec);
    const badgeStr = topDur ? `${topSize} / ${topDur}` : topSize;
    injectHelperBanner(true, pageTitle, badgeStr, finalHasAudio);

    if (onStreamDetected) {
      onStreamDetected({
        ...found,
        audioUrl: finalAudioUrl,
        hasAudio: finalHasAudio,
        pageUrl,
        pageTitle,
        durationSec: parsedInfo.durationSec,
        durationText: topDur,
        totalSize: parsedInfo.qualities[0]?.estimatedBytes || found.contentLength || 0,
        sizeText: topSize,
        subtitles,
        qualities: parsedInfo.qualities.map((q) => ({ ...q, hasAudio: finalHasAudio }))
      });
    }
  });

  pickerWindow.webContents.on('did-finish-load', () => {
    injectHelperBanner(Boolean(currentMasterStream), '', '', true);
  });

  pickerWindow.on('closed', () => {
    detach();
    pickerWindow = null;
  });

  pickerWindow.loadURL(pageUrl).catch(() => {});
}

module.exports = {
  autoSniffStream,
  openInteractiveStreamPicker
};
