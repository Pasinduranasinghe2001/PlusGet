const statusBadge = document.getElementById('statusBadge');
const toggleIntercept = document.getElementById('toggleIntercept');
const grabTabBtn = document.getElementById('grabTabBtn');

chrome.storage.local.get(['interceptEnabled'], (res) => {
  toggleIntercept.checked = res.interceptEnabled !== false;
});

toggleIntercept.addEventListener('change', () => {
  chrome.storage.local.set({ interceptEnabled: toggleIntercept.checked });
});

fetch('http://127.0.0.1:45789/status')
  .then((r) => r.json())
  .then((data) => {
    if (data && data.running) {
      statusBadge.textContent = 'Connected';
      statusBadge.className = 'status online';
    }
  })
  .catch(() => {
    statusBadge.textContent = 'Open PlusGet App';
    statusBadge.className = 'status offline';
  });

grabTabBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (activeTab && activeTab.url) {
      chrome.runtime.sendMessage(
        {
          action: 'sendToPlusGet',
          payload: {
            url: activeTab.url,
            isPageVideo: true
          }
        },
        () => {
          grabTabBtn.textContent = '✅ Sent to PlusGet!';
          setTimeout(() => window.close(), 900);
        }
      );
    }
  });
});
