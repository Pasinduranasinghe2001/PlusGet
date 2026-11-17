const PLUSGET_ENDPOINT = 'http://127.0.0.1:45789';

let interceptEnabled = true;

chrome.storage.local.get(['interceptEnabled'], (res) => {
  if (typeof res.interceptEnabled === 'boolean') {
    interceptEnabled = res.interceptEnabled;
  } else {
    chrome.storage.local.set({ interceptEnabled: true });
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.interceptEnabled) {
    interceptEnabled = Boolean(changes.interceptEnabled.newValue);
  }
});

async function isPlusGetRunning() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900);
    const res = await fetch(`${PLUSGET_ENDPOINT}/status`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function sendToPlusGet(payload) {
  try {
    const res = await fetch(`${PLUSGET_ENDPOINT}/intercept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// 1. Intercept ANY browser download button click (like IDM!)
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (!interceptEnabled) return;
  if (!downloadItem || !downloadItem.url) return;

  const url = downloadItem.finalUrl || downloadItem.url;
  if (!/^https?:\/\//i.test(url)) return;

  if (downloadItem.state && downloadItem.state !== 'in_progress') return;

  const running = await isPlusGetRunning();
  if (!running) return;

  try {
    chrome.downloads.cancel(downloadItem.id, () => {
      chrome.downloads.erase({ id: downloadItem.id });
    });
  } catch (_) {}

  await sendToPlusGet({
    url,
    filename: downloadItem.filename || '',
    fileSize: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : 0,
    mimeType: downloadItem.mime || '',
    referrer: downloadItem.referrer || ''
  });
});

// 2. Context Menu for Images, Videos & Links
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'plusget-image',
      title: '🖼 Download Image with PlusGet',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: 'plusget-link',
      title: '⚡ Download Link with PlusGet Turbo',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: 'plusget-page-video',
      title: '🎬 Download Video on This Page with PlusGet',
      contexts: ['page', 'video', 'frame']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'plusget-image' && info.srcUrl) {
    await sendToPlusGet({
      url: info.srcUrl,
      referrer: info.pageUrl || tab?.url || '',
      mediaType: 'image'
    });
  } else if (info.menuItemId === 'plusget-link' && info.linkUrl) {
    await sendToPlusGet({
      url: info.linkUrl,
      referrer: info.pageUrl || tab?.url || ''
    });
  } else if (info.menuItemId === 'plusget-page-video') {
    const targetUrl = tab?.url || info.pageUrl || info.frameUrl;
    if (targetUrl) {
      await sendToPlusGet({
        url: targetUrl,
        referrer: targetUrl,
        isPageVideo: true
      });
    }
  }
});

// 3. Listen for messages from floating "Download Video" button on web pages or popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === 'sendToPlusGet' || msg?.action === 'sendToPulseGet') {
    sendToPlusGet({
      ...msg.payload,
      referrer: msg.payload?.referrer || sender?.tab?.url || ''
    }).then((ok) => sendResponse({ ok }));
    return true;
  }
});
