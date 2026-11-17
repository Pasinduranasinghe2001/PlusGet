const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { ensureBinaries, getEngineStatus } = require('./binaries.cjs');
const { analyzeUrl, probeHttpHead, scanWebpageAssets, ActiveDownloadManager, sanitizeFilename, formatBytes } = require('./downloadEngine.cjs');
const { openInteractiveStreamPicker } = require('./streamSniffer.cjs');
const { startLocalInterceptServer } = require('./localServer.cjs');

let mainWindow = null;
let downloadManager = null;
let clipboardInterval = null;
let lastClipboardText = '';

function getUserDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function loadSettings() {
  const defaultDir = path.join(app.getPath('downloads'), 'PlusGet');
  const defaults = {
    downloadDir: defaultDir,
    maxConcurrent: 3,
    clipboardMonitor: true,
    organizeByCategory: false,
    defaultVideoQuality: '1080p',
    defaultVideoFormat: 'mp4',
    defaultAudioFormat: 'mp3',
    autoStartQueue: true
  };
  try {
    const file = getUserDataFile('settings.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...defaults, ...parsed };
    }
  } catch (_) {}
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaults;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getUserDataFile('settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function loadQueue() {
  try {
    const file = getUserDataFile('queue.json');
    if (fs.existsSync(file)) {
      const items = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(items)) {
        return items.map((item) => {
          if (item.status === 'downloading' || item.status === 'processing' || item.status === 'queued') {
            return { ...item, status: 'paused', speedText: 'Paused', etaText: '-' };
          }
          return item;
        });
      }
    }
  } catch (_) {}
  return [];
}

let settings = null;
let queue = [];
let saveQueueTimeout = null;

function persistQueueDebounced() {
  if (saveQueueTimeout) clearTimeout(saveQueueTimeout);
  saveQueueTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(getUserDataFile('queue.json'), JSON.stringify(queue, null, 2), 'utf8');
    } catch (_) {}
  }, 400);
}

function broadcastQueue() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('queue:updated', queue);
  }
  persistQueueDebounced();
}

function processQueue() {
  if (!downloadManager) return;
  const activeCount = queue.filter((j) => j.status === 'downloading' || j.status === 'processing').length;
  const max = settings?.maxConcurrent || 3;
  if (activeCount >= max) return;

  const availableSlots = max - activeCount;
  const queuedJobs = queue.filter((j) => j.status === 'queued').slice(0, availableSlots);

  for (const job of queuedJobs) {
    job.status = 'downloading';
    job.speedText = 'Starting...';
    broadcastQueue();

    downloadManager.startJob(job, (patch) => {
      const idx = queue.findIndex((q) => q.id === job.id);
      if (idx === -1) return;

      // CRITICAL PAUSE FIX: If user paused or cancelled this job, ignore any late 'downloading' or 'processing' progress ticks
      if (
        (queue[idx].status === 'paused' || queue[idx].status === 'cancelled') &&
        (patch.status === 'downloading' || patch.status === 'processing')
      ) {
        return;
      }

      queue[idx] = { ...queue[idx], ...patch };
      broadcastQueue();

      if (['completed', 'error', 'paused', 'cancelled'].includes(patch.status)) {
        processQueue();
      }
    });
  }
}

function startClipboardWatcher() {
  if (clipboardInterval) clearInterval(clipboardInterval);
  try {
    lastClipboardText = (clipboard.readText() || '').trim();
  } catch (_) {
    lastClipboardText = '';
  }

  clipboardInterval = setInterval(() => {
    if (!settings?.clipboardMonitor) return;
    try {
      const text = (clipboard.readText() || '').trim();
      if (!text || text === lastClipboardText) return;
      lastClipboardText = text;

      if (/^https?:\/\/[^\s]+$/i.test(text)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('clipboard:url-detected', {
            url: text,
            detectedAt: Date.now()
          });
        }
      }
    } catch (_) {}
  }, 1200);
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    frame: false,
    backgroundColor: '#090d16',
    icon: fs.existsSync(iconPath) ? iconPath : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  if (!app.isPackaged && !fs.existsSync(distIndex)) {
    mainWindow.loadURL(devServerUrl);
  } else if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL(devServerUrl);
  }
}

app.whenReady().then(async () => {
  settings = loadSettings();
  queue = loadQueue();
  downloadManager = new ActiveDownloadManager(app);

  createWindow();
  startClipboardWatcher();

  // Start Local IDM-Style Browser Intercept Server on 127.0.0.1:45789
  startLocalInterceptServer(
    app,
    () => mainWindow,
    (interceptedItem) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream:captured', interceptedItem);
      }
    }
  );

  ensureBinaries(app, (statusUpdate) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine:status-updated', statusUpdate);
    }
  }).then(async () => {
    const st = await getEngineStatus(app);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine:status-updated', st);
    }
  });
});

app.on('window-all-closed', () => {
  if (clipboardInterval) clearInterval(clipboardInterval);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Window Controls IPC
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});
ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// Engine & Settings IPC
ipcMain.handle('engine:status', async () => {
  return await getEngineStatus(app);
});

ipcMain.handle('engine:repair', async () => {
  await ensureBinaries(app);
  return await getEngineStatus(app);
});

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:update', (_e, partial) => {
  settings = { ...settings, ...partial };
  if (settings.downloadDir) {
    try { fs.mkdirSync(settings.downloadDir, { recursive: true }); } catch (_) {}
  }
  saveSettings(settings);
  processQueue();
  return settings;
});

ipcMain.handle('dialog:select-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Default Download Folder',
    defaultPath: settings?.downloadDir || app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (!res.canceled && res.filePaths && res.filePaths[0]) {
    settings.downloadDir = res.filePaths[0];
    saveSettings(settings);
    return settings.downloadDir;
  }
  return null;
});

ipcMain.handle('extension:open-folder', async () => {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'browser-extension') : null,
    path.join(__dirname, '..', 'browser-extension')
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return dir;
    }
  }
  return null;
});

// URL Analysis, Interactive Stream Picker & Webpage Scanner IPC
ipcMain.handle('download:analyze', async (_e, { url, strategy }) => {
  if (!url || typeof url !== 'string') {
    throw new Error('Please paste a valid link.');
  }
  return await analyzeUrl(url.trim(), strategy || 'auto', app);
});

ipcMain.handle('download:open-stream-picker', async (_e, { url }) => {
  if (!url || typeof url !== 'string') {
    throw new Error('Please enter a website link first.');
  }
  const hostname = (() => { try { return new URL(url.trim()).hostname.replace(/^www\./, ''); } catch (_) { return 'Website'; } })();

  openInteractiveStreamPicker(
    url.trim(),
    mainWindow,
    // 1. When a streaming video (.m3u8 / .mp4) is detected
    (captured) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream:captured', {
          mode: 'ytdlp',
          url: captured.streamUrl,
          audioUrl: captured.audioUrl || null,
          hasAudio: captured.hasAudio !== false,
          originalUrl: url.trim(),
          pageUrl: url.trim(),
          headers: captured.headers || {},
          subtitles: captured.subtitles || [],
          isStreamingSite: true,
          needsEpisodeSelection: false,
          title: captured.pageTitle || 'Captured Episode',
          filename: sanitizeFilename(captured.pageTitle || 'Episode'),
          category: 'video',
          platform: hostname,
          duration: captured.durationSec || 0,
          durationText: captured.durationText || '',
          totalSize: captured.totalSize || 0,
          sizeText: captured.sizeText || '~350 MB',
          qualities: captured.qualities,
          formats: captured.hasAudio !== false ? ['mp4', 'mkv', 'mp3'] : ['mp4', 'mkv']
        });
      }
    },
    // 2. When a direct "Download" button or Right-Click Image is clicked inside the Smart Browser
    async (directItem) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!directItem.totalSize && directItem.url) {
          const head = await probeHttpHead(directItem.url, {}, 5000);
          if (head && head.totalSize > 0) {
            directItem.totalSize = head.totalSize;
            directItem.sizeText = formatBytes(head.totalSize);
            directItem.qualities = [
              { id: 'original', label: `Original File (${directItem.sizeText})`, estimatedBytes: head.totalSize, sizeText: directItem.sizeText }
            ];
          }
        }
        mainWindow.webContents.send('stream:captured', {
          ...directItem,
          platform: hostname,
          fromBrowserIntercept: true
        });
      }
    },
    app
  );
  return { opened: true };
});

ipcMain.handle('download:scan-webpage', async (_e, { url }) => {
  if (!url || typeof url !== 'string') {
    throw new Error('Please enter a valid website URL.');
  }
  return await scanWebpageAssets(url.trim());
});

ipcMain.handle('clipboard:read', () => {
  try {
    return (clipboard.readText() || '').trim();
  } catch (_) {
    return '';
  }
});

// Queue IPC
ipcMain.handle('queue:get', () => queue);

function createJobRecord(item) {
  const baseDir = item.saveDir || settings.downloadDir || path.join(app.getPath('downloads'), 'PlusGet');
  const category = item.category || 'other';
  const saveDir = settings.organizeByCategory
    ? path.join(baseDir, category.charAt(0).toUpperCase() + category.slice(1))
    : baseDir;

  return {
    id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url: item.url,
    audioUrl: item.audioUrl || null,
    needsScale: Boolean(item.needsScale),
    hasAudio: item.hasAudio !== false,
    pageUrl: item.pageUrl || item.originalUrl || item.url,
    headers: item.headers || null,
    subtitles: item.subtitles || [],
    title: item.title || item.filename || 'Download Item',
    filename: item.filename || item.title || 'download',
    mode: item.mode || 'direct',
    strategy: item.strategy || 'auto',
    category,
    quality: item.quality || 'best',
    qualityLabel: item.qualityLabel || item.quality || 'Best',
    format: item.format || item.ext || 'mp4',
    thumbnail: item.thumbnail || null,
    platform: item.platform || 'Web',
    totalSize: item.totalSize || 0,
    sizeText: item.sizeText || 'Auto',
    durationText: item.durationText || '',
    connections: item.mode === 'ytdlp' ? 16 : 8,
    segmentProgress: [0, 0, 0, 0, 0, 0, 0, 0],
    progress: 0,
    speedText: 'Queued',
    etaText: '--:--',
    status: 'queued',
    saveDir,
    filePath: null,
    error: null,
    createdAt: new Date().toISOString()
  };
}

ipcMain.handle('queue:add', (_e, item) => {
  const job = createJobRecord(item);
  queue.unshift(job);
  broadcastQueue();
  processQueue();
  return job;
});

ipcMain.handle('queue:add-batch', (_e, items) => {
  if (!Array.isArray(items)) return [];
  const created = items.map((item) => createJobRecord(item));
  queue.unshift(...created);
  broadcastQueue();
  processQueue();
  return created;
});

ipcMain.handle('queue:pause', (_e, id) => {
  const idx = queue.findIndex((j) => j.id === id);
  if (idx === -1) return false;
  queue[idx].status = 'paused';
  queue[idx].speedText = 'Paused';
  queue[idx].etaText = '-';
  downloadManager.pauseJob(id);
  broadcastQueue();
  processQueue();
  return true;
});

ipcMain.handle('queue:resume', (_e, id) => {
  const idx = queue.findIndex((j) => j.id === id);
  if (idx === -1) return false;
  queue[idx].status = 'queued';
  queue[idx].error = null;
  queue[idx].speedText = 'Queued';
  broadcastQueue();
  processQueue();
  return true;
});

ipcMain.handle('queue:cancel', (_e, id) => {
  const idx = queue.findIndex((j) => j.id === id);
  if (idx === -1) return false;
  downloadManager.cancelJob(id);
  queue[idx].status = 'cancelled';
  queue[idx].speedText = 'Cancelled';
  queue[idx].etaText = '-';
  broadcastQueue();
  processQueue();
  return true;
});

ipcMain.handle('queue:remove', (_e, id) => {
  downloadManager.cancelJob(id);
  queue = queue.filter((j) => j.id !== id);
  broadcastQueue();
  processQueue();
  return true;
});

ipcMain.handle('queue:clear-completed', () => {
  queue = queue.filter((j) => !['completed', 'cancelled', 'error'].includes(j.status));
  broadcastQueue();
  return queue;
});

ipcMain.handle('shell:open-file', async (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    await shell.openPath(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('shell:show-in-folder', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  } else if (filePath && fs.existsSync(path.dirname(filePath))) {
    shell.openPath(path.dirname(filePath));
    return true;
  }
  if (settings?.downloadDir && fs.existsSync(settings.downloadDir)) {
    shell.openPath(settings.downloadDir);
    return true;
  }
  return false;
});

ipcMain.handle('shell:open-external', async (_e, url) => {
  if (url && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});
