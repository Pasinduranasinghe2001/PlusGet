const { spawn } = require('child_process');
const fs = require('fs');

const EXT_CATEGORIES = {
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm3u8'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'],
  setup: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'aab', 'iso', 'img', 'appimage', 'bin', 'run'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'zst'],
  code: ['js', 'jsx', 'ts', 'tsx', 'py', 'ipynb', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'htm', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'sql', 'sh', 'bat', 'ps1', 'md', 'dockerfile', 'makefile'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'ico', 'tiff', 'avif', 'heic'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'epub', 'odt']
};

function getCategoryByExtension(ext) {
  const clean = (ext || '').toLowerCase().replace(/^\./, '');
  for (const [cat, list] of Object.entries(EXT_CATEGORIES)) {
    if (list.includes(clean)) return cat;
  }
  return 'other';
}

function sanitizeFilename(name) {
  return (name || 'download')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Auto';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : i === 1 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds) {
  const sec = Number(seconds || 0);
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const totalSec = Math.round(sec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) {
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${s}s`;
}

/**
 * Uses FFmpeg to quickly inspect a local file or remote stream URL
 * to check if an Audio stream (`Stream #...: Audio:`) is present and extract duration.
 */
function probeMediaAudioAndDuration(ffmpegPath, targetUrlOrPath, headers = {}, timeoutMs = 4500) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      return resolve({ hasAudio: true, audioCodec: 'aac', durationSec: 0 });
    }

    const args = ['-hide_banner'];
    if (/^https?:\/\//i.test(targetUrlOrPath) && headers && typeof headers === 'object') {
      const headerLines = [];
      if (headers.Referer) headerLines.push(`Referer: ${headers.Referer}`);
      if (headers.Origin) headerLines.push(`Origin: ${headers.Origin}`);
      if (headers.Cookie) headerLines.push(`Cookie: ${headers.Cookie}`);
      if (headers['User-Agent']) headerLines.push(`User-Agent: ${headers['User-Agent']}`);
      if (headerLines.length > 0) {
        args.push('-headers', headerLines.join('\r\n') + '\r\n');
      }
    }
    args.push('-i', targetUrlOrPath);

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve(parseFfmpegProbeOutput(stderr));
    }, timeoutMs);

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      // As soon as Stream info is printed, we don't need to wait any longer
      if (stderr.includes('At least one output file must be specified')) {
        clearTimeout(timer);
        try { proc.kill(); } catch (_) {}
        resolve(parseFfmpegProbeOutput(stderr));
      }
    });

    proc.on('close', () => {
      clearTimeout(timer);
      resolve(parseFfmpegProbeOutput(stderr));
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ hasAudio: true, audioCodec: 'unknown', durationSec: 0 });
    });
  });
}

function parseFfmpegProbeOutput(stderr) {
  const hasVideo = /Stream\s+#\d+:\d+.*:\s+Video:/i.test(stderr);
  const audioMatch = stderr.match(/Stream\s+#\d+:\d+.*:\s+Audio:\s+([a-zA-Z0-9_]+)/i);
  const hasAudio = Boolean(audioMatch);
  const audioCodec = audioMatch ? audioMatch[1].toLowerCase() : null;

  let durationSec = 0;
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (durMatch) {
    const h = parseInt(durMatch[1], 10);
    const m = parseInt(durMatch[2], 10);
    const s = parseFloat(durMatch[3]);
    durationSec = Math.round(h * 3600 + m * 60 + s);
  }

  return {
    probed: hasVideo || hasAudio,
    hasVideo,
    hasAudio: hasVideo ? hasAudio : true,
    audioCodec,
    durationSec
  };
}

module.exports = {
  EXT_CATEGORIES,
  getCategoryByExtension,
  sanitizeFilename,
  formatBytes,
  formatDuration,
  probeMediaAudioAndDuration
};
