const http = require('http');
const path = require('path');
const { probeHttpHead, analyzeUrl } = require('./downloadEngine.cjs');
const { formatBytes, sanitizeFilename, getCategoryByExtension } = require('./utils.cjs');

const LOCAL_PORT = 45789;

function startLocalInterceptServer(app, getMainWindow, onInterceptedItem) {
  const server = http.createServer(async (req, res) => {
    // Enable CORS for browser extension & web pages
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        running: true,
        app: 'PlusGet',
        version: '1.0.0'
      }));
    }

    if (req.method === 'POST' && req.url === '/intercept') {
      let body = '';
      req.on('data', (chunk) => {
        if (body.length < 1_000_000) body += chunk;
      });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const targetUrl = (payload.url || '').trim();
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'Missing url' }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));

          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }

          const customHeaders = {
            ...(payload.referrer ? { Referer: payload.referrer } : {}),
            ...(payload.userAgent ? { 'User-Agent': payload.userAgent } : {}),
            ...(payload.cookies ? { Cookie: payload.cookies } : {})
          };

          // If the extension sent a full webpage/video tab URL, run full analyzeUrl
          if (payload.isPageVideo) {
            const analyzed = await analyzeUrl(targetUrl, 'auto', app);
            onInterceptedItem(analyzed);
            return;
          }

          // Otherwise it's a direct download button click or right-clicked image/file
          let totalSize = Number(payload.fileSize || 0);
          let filename = payload.filename ? sanitizeFilename(path.basename(payload.filename)) : '';
          let contentType = (payload.mimeType || '').toLowerCase();

          if (!totalSize || !filename) {
            const head = await probeHttpHead(targetUrl, customHeaders, 6000);
            if (head) {
              if (!totalSize && head.totalSize) totalSize = head.totalSize;
              if (!filename && head.filename) filename = head.filename;
              if (!contentType && head.contentType) contentType = head.contentType;
            }
          }

          if (!filename) {
            try {
              filename = sanitizeFilename(decodeURIComponent(path.basename(new URL(targetUrl).pathname)) || 'download');
            } catch (_) {
              filename = 'download';
            }
          }

          const ext = path.extname(filename).replace(/^\./, '').toLowerCase() || (
            contentType.includes('image/png') ? 'png' :
            contentType.includes('image/webp') ? 'webp' :
            contentType.includes('image/jpeg') ? 'jpg' :
            contentType.includes('video/mp4') ? 'mp4' : 'bin'
          );

          if (!path.extname(filename) && ext && ext !== 'bin') {
            filename = `${filename}.${ext}`;
          }

          const category = payload.mediaType === 'image' || contentType.startsWith('image/')
            ? 'image'
            : contentType.startsWith('video/')
            ? 'video'
            : contentType.startsWith('audio/')
            ? 'audio'
            : getCategoryByExtension(ext);

          const formats = [ext || 'original'];
          if (category === 'image') {
            for (const f of ['jpg', 'png', 'webp', 'ico']) {
              if (!formats.includes(f)) formats.push(f);
            }
          }

          const sizeStr = totalSize > 0 ? formatBytes(totalSize) : 'Ready';
          onInterceptedItem({
            mode: 'direct',
            url: targetUrl,
            originalUrl: targetUrl,
            pageUrl: payload.referrer || targetUrl,
            headers: customHeaders,
            title: filename,
            filename,
            category: category === 'other' ? 'setup' : category,
            contentType,
            totalSize,
            sizeText: sizeStr,
            ext,
            platform: (() => { try { return new URL(targetUrl).hostname.replace(/^www\./, ''); } catch (_) { return 'Browser'; } })(),
            thumbnail: category === 'image' ? targetUrl : null,
            qualities: [
              { id: 'original', label: `Original File (${sizeStr})`, estimatedBytes: totalSize, sizeText: sizeStr }
            ],
            formats,
            fromBrowserIntercept: true
          });
        } catch (err) {
          console.error('Intercept error:', err);
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    console.warn('PlusGet Local Intercept Server port busy or error:', err.message);
  });

  server.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`PlusGet IDM-Bridge listening on http://127.0.0.1:${LOCAL_PORT}`);
  });

  return server;
}

module.exports = {
  startLocalInterceptServer,
  LOCAL_PORT
};
