const { contextBridge, ipcRenderer } = require('electron');

const apiBridge = {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Engine & Settings
  getEngineStatus: () => ipcRenderer.invoke('engine:status'),
  repairEngine: () => ipcRenderer.invoke('engine:repair'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  selectDownloadFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  openExtensionFolder: () => ipcRenderer.invoke('extension:open-folder'),

  // URL Analysis, Interactive Episode/Server Picker & Webpage Scanner
  analyzeUrl: (url, strategy) => ipcRenderer.invoke('download:analyze', { url, strategy }),
  openStreamPicker: (url) => ipcRenderer.invoke('download:open-stream-picker', { url }),
  scanWebpage: (url) => ipcRenderer.invoke('download:scan-webpage', { url }),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  // Queue & Download Actions
  getQueue: () => ipcRenderer.invoke('queue:get'),
  addDownload: (item) => ipcRenderer.invoke('queue:add', item),
  addBatchDownloads: (items) => ipcRenderer.invoke('queue:add-batch', items),
  pauseDownload: (id) => ipcRenderer.invoke('queue:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('queue:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('queue:cancel', id),
  removeDownload: (id) => ipcRenderer.invoke('queue:remove', id),
  clearCompleted: () => ipcRenderer.invoke('queue:clear-completed'),
  openFile: (filePath) => ipcRenderer.invoke('shell:open-file', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('shell:show-in-folder', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Subscriptions
  onQueueUpdated: (callback) => {
    const handler = (_event, queue) => callback(queue);
    ipcRenderer.on('queue:updated', handler);
    return () => ipcRenderer.removeListener('queue:updated', handler);
  },
  onClipboardDetected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('clipboard:url-detected', handler);
    return () => ipcRenderer.removeListener('clipboard:url-detected', handler);
  },
  onStreamCaptured: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('stream:captured', handler);
    return () => ipcRenderer.removeListener('stream:captured', handler);
  },
  onEngineStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('engine:status-updated', handler);
    return () => ipcRenderer.removeListener('engine:status-updated', handler);
  }
};

contextBridge.exposeInMainWorld('plusget', apiBridge);
contextBridge.exposeInMainWorld('pulseget', apiBridge);

