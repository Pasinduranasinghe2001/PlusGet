// Injects an IDM-style floating "Download Video with PlusGet" button over active video players
(function () {
  let badge = null;
  let currentVideo = null;

  function createBadge() {
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'plusget-floating-video-btn';
    badge.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'display: none',
      'align-items: center',
      'gap: 7px',
      'padding: 7px 13px',
      'border-radius: 10px',
      'background: linear-gradient(135deg, #06b6d4, #8b5cf6)',
      'color: #090d16',
      'font-family: system-ui, -apple-system, sans-serif',
      'font-size: 12px',
      'font-weight: 800',
      'cursor: pointer',
      'box-shadow: 0 6px 20px rgba(6, 182, 212, 0.4)',
      'border: 1px solid rgba(255,255,255,0.35)',
      'user-select: none',
      'transition: transform 0.15s ease, opacity 0.15s ease'
    ].join(';');
    badge.innerHTML = '<span>⬇ Download Video with PlusGet</span>';

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const pageUrl = window.top ? window.location.href : document.referrer || window.location.href;
      badge.innerHTML = '<span>✅ Sent to PlusGet!</span>';
      chrome.runtime.sendMessage({
        action: 'sendToPlusGet',
        payload: {
          url: pageUrl,
          isPageVideo: true
        }
      });
      setTimeout(() => {
        if (badge) badge.innerHTML = '<span>⬇ Download Video with PlusGet</span>';
      }, 2500);
    });

    document.documentElement.appendChild(badge);
    return badge;
  }

  function positionBadgeOverVideo(videoEl) {
    const rect = videoEl.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 130) {
      if (badge) badge.style.display = 'none';
      return;
    }
    const b = createBadge();
    b.style.top = `${Math.max(10, rect.top + 12)}px`;
    b.style.left = `${Math.max(10, rect.right - 225)}px`;
    b.style.display = 'flex';
  }

  document.addEventListener('mouseover', (e) => {
    const v = e.target.closest ? e.target.closest('video') : null;
    if (v) {
      currentVideo = v;
      positionBadgeOverVideo(v);
    }
  }, true);

  window.addEventListener('scroll', () => {
    if (currentVideo && badge && badge.style.display === 'flex') {
      positionBadgeOverVideo(currentVideo);
    }
  }, { passive: true });
})();
