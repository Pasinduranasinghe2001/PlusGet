import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Layers,
  Settings,
  Clipboard,
  Search,
  Play,
  Pause,
  Trash2,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Video,
  Music,
  Package,
  Code2,
  Image as ImageIcon,
  FileText,
  Sparkles,
  Minus,
  Square,
  X,
  RefreshCw,
  HardDrive,
  Zap,
  Link2,
  CheckSquare,
  ArrowDownToLine,
  Tv,
  Film,
  Puzzle,
  Gauge,
  Clock,
  Volume2,
  VolumeX
} from 'lucide-react';

const BASE_QUALITY_CARDS = [
  { id: '2160p', title: '4K Ultra HD', sub: '2160p Crystal Clear', badge: '4K', defaultSize: '~1.4 GB', defaultTime: '1h 30m', isAudio: false },
  { id: '1080p', title: '1080p Full HD', sub: 'Best for PC & TV', badge: 'FHD', defaultSize: '~550 MB', defaultTime: '1h 30m', isAudio: false },
  { id: '720p', title: '720p HD', sub: 'Fast & Balanced', badge: 'HD', defaultSize: '~280 MB', defaultTime: '1h 30m', isAudio: false },
  { id: '480p', title: '480p Standard', sub: 'Saves Storage Space', badge: 'SD', defaultSize: '~150 MB', defaultTime: '1h 30m', isAudio: false },
  { id: '360p', title: '360p Compact', sub: 'Quick Mobile Size', badge: '360p', defaultSize: '~90 MB', defaultTime: '1h 30m', isAudio: false },
  { id: 'audio-320', title: 'Audio Only (MP3)', sub: 'High Quality Audio', badge: 'MP3', defaultSize: '~45 MB', defaultTime: '1h 30m', isAudio: true }
];

const CATEGORY_META = {
  video: { label: 'Video', icon: Video, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  audio: { label: 'Audio', icon: Music, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  setup: { label: 'App / Setup', icon: Package, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  archive: { label: 'Archive', icon: Package, color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  code: { label: 'Code / File', icon: Code2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  image: { label: 'Image', icon: ImageIcon, color: 'text-pink-400 bg-pink-500/10 border-pink-500/30' },
  document: { label: 'Document', icon: FileText, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  other: { label: 'File', icon: FileText, color: 'text-slate-300 bg-slate-500/10 border-slate-500/30' }
};

export default function App() {
  const api = window.plusget || window.pulseget;

  // Navigation: 'home' | 'downloads' | 'grabber' | 'browser-ext' | 'batch' | 'settings'
  const [activeTab, setActiveTab] = useState('home');

  // Main Smart Input State
  const [urlInput, setUrlInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzedData, setAnalyzedData] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState('1080p');
  const [selectedFormat, setSelectedFormat] = useState('mp4');
  const [customFilename, setCustomFilename] = useState('');
  const [streamCapturedBanner, setStreamCapturedBanner] = useState(false);

  // Queue State
  const [queue, setQueue] = useState([]);
  const [queueFilter, setQueueFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Webpage Grabber State
  const [scanUrl, setScanUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [scanCategoryFilter, setScanCategoryFilter] = useState('all');
  const [selectedScanIds, setSelectedScanIds] = useState(new Set());

  // Batch Links State
  const [batchText, setBatchText] = useState('');
  const [batchQuality, setBatchQuality] = useState('1080p');
  const [batchFormat, setBatchFormat] = useState('mp4');

  // Settings State
  const [settings, setSettings] = useState({
    downloadDir: 'C:\\Users\\Downloads\\PlusGet',
    maxConcurrent: 3,
    clipboardMonitor: true,
    organizeByCategory: false,
    defaultVideoQuality: '1080p',
    defaultVideoFormat: 'mp4'
  });

  // Notifications
  const [clipboardAlert, setClipboardAlert] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3800);
  };

  useEffect(() => {
    if (!api) return;

    api.getSettings().then((s) => {
      if (s) {
        setSettings(s);
        setSelectedQuality(s.defaultVideoQuality || '1080p');
        setSelectedFormat(s.defaultVideoFormat || 'mp4');
      }
    });

    api.getQueue().then((q) => {
      if (Array.isArray(q)) setQueue(q);
    });

    const unsubQueue = api.onQueueUpdated((updatedQueue) => {
      setQueue([...updatedQueue]);
    });

    const unsubClip = api.onClipboardDetected((data) => {
      if (data?.url) {
        setClipboardAlert(data.url);
      }
    });

    const unsubStream = api.onStreamCaptured((capturedData) => {
      if (capturedData) {
        setAnalyzedData(capturedData);
        setUrlInput(capturedData.pageUrl || capturedData.url || '');
        setCustomFilename(capturedData.title || capturedData.filename || 'Download');
        if (capturedData.mode === 'direct') {
          setSelectedQuality('original');
          setSelectedFormat(capturedData.formats?.[0] || capturedData.ext || 'original');
        } else {
          const nativeQ = (capturedData.qualities || []).find((q) => q.isNative && !q.isAudioOnly);
          setSelectedQuality(nativeQ ? nativeQ.id : '1080p');
          setSelectedFormat('mp4');
        }
        setStreamCapturedBanner(true);
        setActiveTab('home');
        const badge = capturedData.durationText
          ? `${capturedData.sizeText || '~350 MB'} / ${capturedData.durationText}`
          : (capturedData.sizeText || 'Turbo Speed');
        const audioNote = capturedData.hasAudio === false ? ' • 🔇 No Audio' : ' • 🔊 Audio Included';
        showToast(`Ready: "${capturedData.title}" (${badge}${audioNote})`);
      }
    });

    return () => {
      if (unsubQueue) unsubQueue();
      if (unsubClip) unsubClip();
      if (unsubStream) unsubStream();
    };
  }, []);

  // Compute dynamic "MB Size / Play Time" and Audio status for each quality card
  const qualityCardsWithSize = useMemo(() => {
    const apiQualities = analyzedData?.qualities || [];
    const globalDuration = analyzedData?.durationText || '';
    const globalHasAudio = analyzedData ? analyzedData.hasAudio !== false : true;

    return BASE_QUALITY_CARDS.map((card) => {
      const matched = apiQualities.find((q) => q.id === card.id);
      const sizeStr = matched?.sizeText || card.defaultSize;
      const durStr = matched?.durationText || globalDuration || (analyzedData ? '' : card.defaultTime);
      const combinedSizeTime = durStr ? `${sizeStr} / ${durStr}` : sizeStr;
      const cardHasAudio = matched && typeof matched.hasAudio === 'boolean' ? matched.hasAudio : globalHasAudio;

      return {
        ...card,
        sizeText: sizeStr,
        durationText: durStr,
        combinedSizeTime,
        hasAudio: card.isAudio ? globalHasAudio : cardHasAudio,
        estimatedBytes: matched?.estimatedBytes || 0,
        variantUrl: matched?.variantUrl || null,
        audioUrl: matched?.audioUrl || null,
        isNative: Boolean(matched?.isNative),
        needsScale: Boolean(matched?.needsScale)
      };
    });
  }, [analyzedData]);

  const currentSelectedSizeAndTime = useMemo(() => {
    if (!analyzedData) return 'Check link to view MB / Play Time';
    if (analyzedData.mode === 'direct') {
      return analyzedData.durationText
        ? `${analyzedData.sizeText || 'Ready'} / ${analyzedData.durationText}`
        : (analyzedData.sizeText || 'Ready');
    }
    const found = qualityCardsWithSize.find((c) => c.id === selectedQuality);
    if (found) return found.combinedSizeTime;
    const dur = analyzedData.durationText;
    const sz = analyzedData.sizeText || '~350 MB';
    return dur ? `${sz} / ${dur}` : sz;
  }, [analyzedData, selectedQuality, qualityCardsWithSize]);

  const currentHasAudio = useMemo(() => {
    if (!analyzedData) return true;
    if (analyzedData.mode === 'direct') {
      return analyzedData.hasAudio !== false;
    }
    const found = qualityCardsWithSize.find((c) => c.id === selectedQuality);
    if (found && typeof found.hasAudio === 'boolean') return found.hasAudio;
    return analyzedData.hasAudio !== false;
  }, [analyzedData, selectedQuality, qualityCardsWithSize]);

  // Drag & Drop link anywhere
  const handleDrop = (e) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (text && /^https?:\/\//i.test(text.trim())) {
      const clean = text.trim().split(/\r?\n/)[0];
      setUrlInput(clean);
      setActiveTab('home');
      handleInspectUrl(clean);
    }
  };

  const handlePasteAndCheck = async () => {
    try {
      let text = '';
      if (api) {
        text = await api.readClipboard();
      } else if (navigator.clipboard) {
        text = await navigator.clipboard.readText();
      }
      if (text) {
        const clean = text.trim();
        setUrlInput(clean);
        handleInspectUrl(clean);
      } else {
        showToast('Clipboard is empty — copy a link first.');
      }
    } catch (_) {
      showToast('Could not read clipboard.');
    }
  };

  const handleInspectUrl = async (overrideUrl) => {
    const target = (overrideUrl !== undefined ? overrideUrl : urlInput).trim();
    if (!target) {
      setAnalysisError('Please paste a link first.');
      return;
    }

    setAnalyzing(true);
    setAnalysisError('');
    setAnalyzedData(null);
    setStreamCapturedBanner(false);

    try {
      const result = await api.analyzeUrl(target, 'auto');
      setAnalyzedData(result);
      setCustomFilename(result.title || result.filename || 'Video');

      if (result.mode === 'direct') {
        setSelectedQuality('original');
        setSelectedFormat(result.formats?.[0] || result.ext || 'original');
      } else {
        const nativeQ = (result.qualities || []).find((q) => q.isNative && !q.isAudioOnly);
        setSelectedQuality(nativeQ ? nativeQ.id : '1080p');
        setSelectedFormat('mp4');
      }
    } catch (_) {
      setAnalysisError('Could not inspect link automatically. Click Choose Episode / Browse Site to grab from page.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleOpenEpisodePicker = async (overrideUrl) => {
    const target = (overrideUrl || analyzedData?.pageUrl || urlInput).trim();
    if (!target) {
      setAnalysisError('Paste the website or movie link first, then click Choose Episode / Browse Site.');
      return;
    }
    setAnalysisError('');
    await api?.openStreamPicker(target);
  };

  const handleStartDownload = async () => {
    const target = (analyzedData?.url || urlInput).trim();
    if (!target) {
      setAnalysisError('Please paste a link to download.');
      return;
    }

    if (analyzedData?.needsEpisodeSelection) {
      handleOpenEpisodePicker(target);
      return;
    }

    const isDirectFile = analyzedData?.mode === 'direct';
    const isAudio = !isDirectFile && (selectedQuality.startsWith('audio') || selectedFormat === 'mp3' || selectedFormat === 'wav');
    const chosenCard = qualityCardsWithSize.find((c) => c.id === selectedQuality);

    // Use the exact resolution stream URL (variantUrl) for the selected quality button if available!
    const effectiveStreamUrl = (!isDirectFile && chosenCard?.variantUrl)
      ? chosenCard.variantUrl
      : target;

    const payload = {
      url: effectiveStreamUrl,
      audioUrl: chosenCard?.audioUrl || analyzedData?.audioUrl || null,
      needsScale: Boolean(chosenCard?.needsScale),
      hasAudio: currentHasAudio,
      pageUrl: analyzedData?.pageUrl || urlInput.trim(),
      headers: analyzedData?.headers || null,
      subtitles: analyzedData?.subtitles || [],
      title: customFilename.trim() || analyzedData?.title || 'Download',
      filename: customFilename.trim() || analyzedData?.filename || 'Download',
      mode: isDirectFile ? 'direct' : 'ytdlp',
      category: isAudio ? 'audio' : (analyzedData?.category || 'video'),
      quality: isDirectFile ? 'original' : selectedQuality,
      qualityLabel: isDirectFile ? 'Original File' : selectedQuality,
      format: isDirectFile ? (selectedFormat || analyzedData?.ext || 'original') : (isAudio ? 'mp3' : selectedFormat),
      thumbnail: analyzedData?.thumbnail || null,
      platform: analyzedData?.platform || 'Web',
      totalSize: isDirectFile ? (analyzedData?.totalSize || 0) : (chosenCard?.estimatedBytes || analyzedData?.totalSize || 0),
      sizeText: chosenCard?.sizeText || analyzedData?.sizeText || 'Auto',
      durationText: isDirectFile ? (analyzedData?.durationText || '') : (chosenCard?.durationText || analyzedData?.durationText || ''),
      saveDir: settings.downloadDir
    };

    await api?.addDownload(payload);
    setStreamCapturedBanner(false);
    showToast(`Turbo Download Started: "${payload.title}" (${currentSelectedSizeAndTime})`);
    setActiveTab('downloads');
  };

  // Webpage Grabber Actions
  const handleScanWebpage = async (overrideUrl) => {
    const target = (overrideUrl !== undefined ? overrideUrl : scanUrl).trim();
    if (!target) {
      setScanError('Please enter a website address.');
      return;
    }

    setScanning(true);
    setScanError('');
    setScanResult(null);
    setSelectedScanIds(new Set());

    try {
      const res = await api.scanWebpage(target);
      setScanResult(res);
      setSelectedScanIds(new Set((res.assets || []).map((a) => a.id)));
    } catch (err) {
      setScanError(err.message || 'Could not scan that page.');
    } finally {
      setScanning(false);
    }
  };

  const filteredScanAssets = useMemo(() => {
    if (!scanResult?.assets) return [];
    if (scanCategoryFilter === 'all') return scanResult.assets;
    return scanResult.assets.filter((a) => a.category === scanCategoryFilter);
  }, [scanResult, scanCategoryFilter]);

  const toggleScanItem = (id) => {
    setSelectedScanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadSelectedAssets = async () => {
    const chosen = filteredScanAssets.filter((a) => selectedScanIds.has(a.id));
    if (chosen.length === 0) {
      showToast('Select at least one file or image to download.');
      return;
    }

    const items = chosen.map((asset) => ({
      url: asset.url,
      title: asset.filename || asset.label,
      filename: asset.filename,
      mode: asset.isSocialEmbed ? 'ytdlp' : 'direct',
      category: asset.category,
      quality: 'best',
      format: asset.ext || 'original',
      platform: new URL(asset.url).hostname,
      thumbnail: asset.category === 'image' ? asset.url : null,
      saveDir: settings.downloadDir
    }));

    await api.addBatchDownloads(items);
    showToast(`Started downloading ${items.length} files at Turbo Speed!`);
    setActiveTab('downloads');
  };

  const handleStartBatchDownload = async () => {
    const lines = batchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l));

    if (lines.length === 0) {
      showToast('Paste at least one web link (one per line).');
      return;
    }

    const isAudio = batchQuality.startsWith('audio') || batchFormat === 'mp3';
    const items = lines.map((url, idx) => {
      let host = 'Web';
      let base = `Download #${idx + 1}`;
      let ext = '';
      try {
        const u = new URL(url);
        host = u.hostname.replace(/^www\./, '');
        const p = decodeURIComponent(u.pathname.split('/').pop() || '');
        if (p && p.length > 1) base = p;
        const dotIdx = p.lastIndexOf('.');
        if (dotIdx > 0 && dotIdx < p.length - 1) ext = p.slice(dotIdx + 1).toLowerCase();
      } catch (_) {}

      const isDirectExt = ['exe', 'msi', 'zip', 'rar', '7z', 'iso', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'py', 'js', 'ts', 'json'].includes(ext);

      return {
        url,
        title: base,
        filename: base,
        mode: isDirectExt ? 'direct' : 'ytdlp',
        category: isDirectExt ? (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) ? 'image' : ['exe', 'msi', 'iso'].includes(ext) ? 'setup' : 'document') : (isAudio ? 'audio' : 'video'),
        quality: isDirectExt ? 'original' : batchQuality,
        format: isDirectExt ? (ext || 'original') : batchFormat,
        platform: host,
        saveDir: settings.downloadDir
      };
    });

    await api.addBatchDownloads(items);
    setBatchText('');
    showToast(`Started ${items.length} Turbo downloads!`);
    setActiveTab('downloads');
  };

  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (queueFilter === 'active' && !['downloading', 'processing', 'queued'].includes(item.status)) return false;
      if (queueFilter === 'completed' && item.status !== 'completed') return false;
      if (queueFilter === 'video' && item.category !== 'video') return false;
      if (queueFilter === 'audio' && item.category !== 'audio') return false;
      if (queueFilter === 'image' && item.category !== 'image') return false;
      if (queueFilter === 'files' && ['video', 'audio', 'image'].includes(item.category)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          (item.title || '').toLowerCase().includes(q) ||
          (item.platform || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [queue, queueFilter, searchQuery]);

  const activeDownloadsCount = queue.filter((q) => q.status === 'downloading' || q.status === 'processing').length;
  const completedDownloadsCount = queue.filter((q) => q.status === 'completed').length;

  const handleUpdateSetting = async (patch) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await api?.updateSettings(patch);
  };

  const isDirectFileMode = analyzedData?.mode === 'direct';
  const isVideoCategory = !isDirectFileMode || analyzedData?.category === 'video';

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 select-none overflow-hidden border border-slate-800/80"
    >
      {/* Top Window Bar */}
      <header className="h-12 bg-[#0c1220] border-b border-slate-800/80 flex items-center justify-between px-4 drag-region shrink-0">
        <div className="flex items-center gap-3">
          <img
            src="./logo.png"
            alt="PlusGet"
            className="w-7 h-7 rounded-lg shadow-md shadow-cyan-500/20"
          />
          <span className="font-bold tracking-tight text-base bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400 bg-clip-text text-transparent">
            PlusGet
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            16x Turbo IDM Engine
          </span>
        </div>

        {/* Center Status Pills */}
        <div className="flex items-center gap-2.5 no-drag">
          <button
            onClick={() => handleUpdateSetting({ clipboardMonitor: !settings.clipboardMonitor })}
            className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition ${
              settings.clipboardMonitor
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span>Auto-Detect Links: {settings.clipboardMonitor ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={() => setActiveTab('browser-ext')}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/30 transition"
          >
            <Puzzle className="w-3.5 h-3.5 text-violet-400" />
            <span>Browser Takeover: Active</span>
          </button>
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={() => api?.minimizeWindow()}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition"
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => api?.maximizeWindow()}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition"
            title="Maximize"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => api?.closeWindow()}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-rose-600/80 transition"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Auto-Detected Copied Link Banner */}
      {clipboardAlert && (
        <div className="bg-gradient-to-r from-cyan-950/90 via-violet-950/90 to-slate-900 border-b border-cyan-500/30 px-6 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300">
              <Zap className="w-4 h-4" />
            </span>
            <div className="truncate">
              <span className="text-xs font-semibold text-cyan-300 mr-2">Link Copied:</span>
              <span className="text-xs text-slate-200 truncate">{clipboardAlert}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={() => {
                const target = clipboardAlert;
                setClipboardAlert(null);
                setUrlInput(target);
                setActiveTab('home');
                handleInspectUrl(target);
              }}
              className="px-3.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition"
            >
              Check Size, Time & Audio
            </button>
            <button
              onClick={() => {
                const target = clipboardAlert;
                setClipboardAlert(null);
                setUrlInput(target);
                setActiveTab('home');
                handleOpenEpisodePicker(target);
              }}
              className="px-3 py-1 rounded-lg bg-violet-500/25 hover:bg-violet-500/35 text-violet-200 border border-violet-500/30 font-semibold text-xs transition"
            >
              Pick Episode / Server
            </button>
            <button
              onClick={() => setClipboardAlert(null)}
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900/95 border border-cyan-500/40 shadow-2xl text-sm text-slate-100">
          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Layout */}
      <div className="flex-1 flex min-h-0">
        {/* Clean Sidebar */}
        <aside className="w-60 bg-[#0d1322] border-r border-slate-800/80 flex flex-col justify-between p-3 shrink-0">
          <div className="space-y-1.5">
            <button
              onClick={() => setActiveTab('home')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition ${
                activeTab === 'home'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-cyan-400" />
                <span>New Download</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('downloads')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition ${
                activeTab === 'downloads'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <ArrowDownToLine className="w-4 h-4 text-violet-400" />
                <span>My Downloads</span>
              </div>
              {queue.length > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activeDownloadsCount > 0
                      ? 'bg-cyan-500 text-slate-950 animate-pulse'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {queue.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('grabber')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition ${
                activeTab === 'grabber'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <ImageIcon className="w-4 h-4 text-pink-400" />
                <span>Grab Images & Files</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('browser-ext')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition ${
                activeTab === 'browser-ext'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Puzzle className="w-4 h-4 text-amber-400" />
                <span>Browser IDM Mode</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('batch')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition ${
                activeTab === 'batch'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Multiple Links</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-semibold transition ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-violet-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Settings className="w-4 h-4 text-slate-400" />
                <span>Preferences</span>
              </div>
            </button>
          </div>

          {/* Save Folder Box */}
          <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800/90 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                Save To Folder
              </span>
              <button
                onClick={() => api?.showInFolder(settings.downloadDir)}
                className="text-cyan-400 hover:underline text-[11px] font-semibold"
              >
                Open
              </button>
            </div>
            <div
              onClick={async () => {
                const chosen = await api?.selectDownloadFolder();
                if (chosen) setSettings((s) => ({ ...s, downloadDir: chosen }));
              }}
              className="text-[11px] text-slate-300 truncate bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800 cursor-pointer hover:border-cyan-500/40 transition"
              title="Click to change save folder"
            >
              {settings.downloadDir}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 text-center">
              <div className="bg-slate-950/60 rounded-lg py-1.5 border border-slate-800/70">
                <div className="text-sm font-bold text-cyan-400">{activeDownloadsCount}</div>
                <div className="text-[10px] text-slate-400">Active</div>
              </div>
              <div className="bg-slate-950/60 rounded-lg py-1.5 border border-slate-800/70">
                <div className="text-sm font-bold text-emerald-400">{completedDownloadsCount}</div>
                <div className="text-[10px] text-slate-400">Finished</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 overflow-y-auto p-6 bg-gradient-to-br from-[#090d16] via-[#0d1322] to-[#090d16]">
          {/* TAB 1: HOME (NEW DOWNLOAD WITH PRE-DOWNLOAD NAME, MB SIZE, PLAY TIME & AUDIO INDICATOR) */}
          {activeTab === 'home' && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Step 1: Paste Link Card */}
              <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-[#131c33] to-slate-900 border border-slate-800 p-6 shadow-xl space-y-4">
                <div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">
                    Paste Any Video, Movie, Image, or File Link
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Shows File Name, Size & Play Time (e.g. 280 MB / 1h 30m), and Audio Status before downloading
                  </p>
                </div>

                {/* Single Clean Input Bar */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="flex-1 relative flex items-center">
                    <Link2 className="w-4 h-4 text-cyan-400 absolute left-4 pointer-events-none" />
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleInspectUrl();
                      }}
                      placeholder="Paste link here (any movie/TV site, YouTube, TikTok, Facebook, image, or .exe/.zip file)..."
                      className="w-full pl-11 pr-24 py-4 rounded-xl bg-slate-950/95 border border-slate-700/80 focus:border-cyan-400 focus:outline-none text-sm text-white placeholder-slate-500"
                    />
                    <button
                      onClick={handlePasteAndCheck}
                      className="absolute right-2.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 font-semibold flex items-center gap-1.5 transition"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                      Paste
                    </button>
                  </div>

                  <button
                    onClick={() => handleInspectUrl()}
                    disabled={analyzing}
                    className="px-6 py-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition shrink-0"
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Checking Video & Audio...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Check Size & Audio</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Smart Browser / Episode Picker Bar */}
                <div className="p-3.5 rounded-xl bg-violet-500/10 border border-violet-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-violet-500/20 text-violet-300 shrink-0">
                      <Tv className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-violet-200">
                        Any Movie/TV Site (S1•E1..E8, Server 1..9) or Website Download Button / Image:
                      </div>
                      <div className="text-[11px] text-slate-300">
                        Open the <b>Smart Browser</b> to click any Episode, Server, Download Button, or Right-Click any Image!
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleOpenEpisodePicker()}
                    className="px-4 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shrink-0 shadow-md transition"
                  >
                    <Tv className="w-4 h-4" />
                    <span>Choose Episode / Browse Site</span>
                  </button>
                </div>

                {analysisError && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>{analysisError}</span>
                    </div>
                    <button
                      onClick={() => handleOpenEpisodePicker()}
                      className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold shrink-0"
                    >
                      Open Smart Browser
                    </button>
                  </div>
                )}
              </div>

              {/* Pre-Download File Info, MB Size, Play Time & Audio Status Card */}
              <div className="rounded-2xl bg-[#111827] border border-slate-800/90 p-6 shadow-xl space-y-5">
                {/* Header showing File Name, "MB Size / Play Time", and Audio Included / No Audio Badge */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
                  <div className="flex items-center gap-4 w-full md:w-auto flex-1">
                    {analyzedData?.thumbnail ? (
                      <img
                        src={analyzedData.thumbnail}
                        alt={customFilename}
                        className="w-28 h-20 object-cover rounded-xl border border-slate-700 bg-slate-950 shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 flex flex-col items-center justify-center text-cyan-400 shrink-0">
                        {analyzedData?.category === 'image' ? (
                          <ImageIcon className="w-8 h-8" />
                        ) : isDirectFileMode && analyzedData?.category !== 'video' ? (
                          <Package className="w-8 h-8" />
                        ) : (
                          <Film className="w-8 h-8" />
                        )}
                        <span className="text-[10px] font-bold uppercase mt-1">
                          {analyzedData?.category || 'Ready'}
                        </span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          {analyzedData?.platform || 'Ready to Download'}
                        </span>

                        <span className="text-xs font-extrabold px-3 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{currentSelectedSizeAndTime}</span>
                        </span>

                        {/* Audio Included vs No Audio Indicator Badge BEFORE Download */}
                        {isVideoCategory && (
                          currentHasAudio ? (
                            <span className="text-xs font-bold px-3 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 flex items-center gap-1.5">
                              <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Audio Included (AAC)</span>
                            </span>
                          ) : (
                            <span className="text-xs font-extrabold px-3 py-0.5 rounded-full bg-rose-500/25 text-rose-200 border border-rose-500/50 flex items-center gap-1.5 animate-pulse">
                              <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                              <span>No Audio (Video Only)</span>
                            </span>
                          )
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          File Name (Before Download):
                        </label>
                        <input
                          type="text"
                          value={customFilename}
                          onChange={(e) => setCustomFilename(e.target.value)}
                          placeholder="File name will appear here automatically..."
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm font-semibold text-white focus:border-cyan-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Warning Banner if Video Has No Audio Track */}
                {analyzedData && isVideoCategory && !currentHasAudio && (
                  <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <VolumeX className="w-6 h-6 text-rose-400 shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-rose-200">
                          Warning: This Video Does Not Include Audio
                        </div>
                        <div className="text-xs text-rose-300/90">
                          The source video stream has no sound track (muted or video-only file). If you are on a movie site, try switching to another Server (e.g. Server 1 or Server 2) in the Smart Browser.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* If Multi-Episode Streaming Page Needs Episode Selection */}
                {analyzedData?.needsEpisodeSelection && (
                  <div className="p-4 rounded-xl bg-violet-500/15 border border-violet-500/40 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Select Which Episode or Server You Want to Download
                      </div>
                      <div className="text-xs text-slate-300 mt-0.5">
                        Click the button on the right, click your Episode (e.g. S1•E8) and press Play ▶ — PlusGet will immediately display the Episode Name, MB Size, Play Time & Audio Status!
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenEpisodePicker()}
                      className="px-5 py-2.5 rounded-xl bg-violet-400 hover:bg-violet-300 text-slate-950 font-extrabold text-xs shrink-0"
                    >
                      Pick Episode & Play ▶
                    </button>
                  </div>
                )}

                {/* Quality & Format Selector with "MB Size / Play Time" & Audio Badge on Every Card */}
                {!isDirectFileMode ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold text-slate-200">
                        Select Quality (Shows Size, Play Time & Audio Status)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 mr-1">Format:</span>
                        {['mp4', 'mkv', 'mp3'].map((fmt) => (
                          <button
                            key={fmt}
                            onClick={() => {
                              setSelectedFormat(fmt);
                              if (fmt === 'mp3') setSelectedQuality('audio-320');
                              else if (selectedQuality.startsWith('audio')) setSelectedQuality('1080p');
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold uppercase border transition ${
                              selectedFormat === fmt
                                ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                            }`}
                          >
                            .{fmt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                      {qualityCardsWithSize.map((card) => {
                        const active = selectedQuality === card.id;
                        return (
                          <button
                            key={card.id}
                            onClick={() => {
                              setSelectedQuality(card.id);
                              if (card.isAudio) setSelectedFormat('mp3');
                              else if (selectedFormat === 'mp3') setSelectedFormat('mp4');
                            }}
                            className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                              active
                                ? 'bg-cyan-500/15 border-cyan-400 shadow-md shadow-cyan-950/50'
                                : 'bg-slate-950/70 border-slate-800/90 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1">
                                <span
                                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                                    active ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {card.badge}
                                </span>
                                {analyzedData && card.isNative && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Native
                                  </span>
                                )}
                              </div>
                              {card.hasAudio ? (
                                <span className="text-[10px] font-bold text-cyan-300 flex items-center gap-0.5" title="Audio Included">
                                  <Volume2 className="w-3 h-3" />
                                  Audio
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-400 flex items-center gap-0.5" title="No Audio Track">
                                  <VolumeX className="w-3 h-3" />
                                  Mute
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">{card.title}</div>
                              <div className="text-[11px] font-extrabold text-emerald-400 mt-1">
                                {card.combinedSizeTime}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Direct File Ready ({currentSelectedSizeAndTime})
                      </div>
                      <div className="text-xs text-slate-400">
                        {analyzedData?.category === 'video'
                          ? (currentHasAudio ? '🔊 Audio Track Verified • 8x Parallel Turbo Connections' : '🔇 Video-Only File (No Audio Track) • 8x Parallel Turbo Connections')
                          : 'Will be downloaded using 8 Parallel Turbo Connections'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Save Format:</span>
                      {(analyzedData?.formats || ['original']).map((fmt) => (
                        <button
                          key={fmt}
                          onClick={() => setSelectedFormat(fmt)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase border ${
                            selectedFormat === fmt
                              ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                              : 'bg-slate-900 text-slate-300 border-slate-800'
                          }`}
                        >
                          .{fmt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Big One-Click Turbo Download Button */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-cyan-400" />
                    <span>
                      {isVideoCategory && currentHasAudio
                        ? 'Video + AAC Stereo Audio Merged Automatically (16x Turbo Speed)'
                        : 'Multi-Connection Turbo Speed Enabled'}
                    </span>
                  </div>

                  <button
                    onClick={handleStartDownload}
                    className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-400 via-violet-500 to-pink-500 hover:opacity-95 text-slate-950 font-extrabold text-base flex items-center justify-center gap-2.5 shadow-xl shadow-cyan-500/20 transition"
                  >
                    <Download className="w-5 h-5" />
                    <span>
                      Download Now ({currentSelectedSizeAndTime !== 'Check link to view MB / Play Time' ? `${currentSelectedSizeAndTime} • ` : ''}.{selectedFormat.toUpperCase()})
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MY DOWNLOADS */}
          {activeTab === 'downloads' && (
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-white">My Downloads</h1>
                  <p className="text-xs text-slate-400">
                    Multi-connection accelerated downloads with pause & resume support
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search downloads..."
                      className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => api?.clearCompleted()}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium transition"
                  >
                    Clear Completed
                  </button>
                  <button
                    onClick={() => api?.showInFolder(settings.downloadDir)}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs text-cyan-300 font-semibold flex items-center gap-1.5 transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open Folder
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'In Progress' },
                  { id: 'completed', label: 'Completed' },
                  { id: 'video', label: 'Videos & Movies' },
                  { id: 'image', label: 'Images' },
                  { id: 'audio', label: 'Music / Audio' },
                  { id: 'files', label: 'Setups, Archives & Code' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setQueueFilter(tab.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                      queueFilter === tab.id
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {filteredQueue.length === 0 ? (
                <div className="rounded-2xl bg-[#111827] border border-slate-800/80 p-12 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                    <Download className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-300">No downloads in this tab</div>
                  <button
                    onClick={() => setActiveTab('home')}
                    className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs"
                  >
                    Start a Download
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredQueue.map((item) => {
                    const cat = CATEGORY_META[item.category] || CATEGORY_META.other;
                    const CatIcon = cat.icon;
                    const pct = Math.min(100, Math.max(0, Number(item.progress || 0)));
                    const segments = Array.isArray(item.segmentProgress) && item.segmentProgress.length > 0
                      ? item.segmentProgress
                      : [pct, pct, pct, pct, pct, pct, pct, pct];
                    const itemSizeAndTime = item.durationText
                      ? `${item.sizeText} / ${item.durationText}`
                      : item.sizeText;

                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-[#111827] border border-slate-800/90 flex flex-col gap-3"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3.5 min-w-0">
                            {item.thumbnail ? (
                              <img
                                src={item.thumbnail}
                                alt={item.title}
                                className="w-16 h-11 object-cover rounded-lg border border-slate-700 shrink-0 bg-slate-950"
                              />
                            ) : (
                              <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${cat.color}`}>
                                <CatIcon className="w-5 h-5" />
                              </div>
                            )}

                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-100 truncate">
                                {item.title}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400">
                                <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${cat.color}`}>
                                  {cat.label}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 uppercase text-[10px] font-bold">
                                  {item.quality || 'HD'} • .{item.format || 'MP4'}
                                </span>
                                <span className="font-bold text-emerald-300">{itemSizeAndTime}</span>
                                {item.category === 'video' && (
                                  item.hasAudio === false ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold flex items-center gap-1">
                                      <VolumeX className="w-3 h-3" />
                                      No Audio
                                    </span>
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold flex items-center gap-1">
                                      <Volume2 className="w-3 h-3" />
                                      Audio Included
                                    </span>
                                  )
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.status === 'downloading' && (
                              <button
                                onClick={() => api?.pauseDownload(item.id)}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1 transition"
                              >
                                <Pause className="w-3.5 h-3.5" />
                                Pause
                              </button>
                            )}
                            {(item.status === 'paused' || item.status === 'error' || item.status === 'cancelled') && (
                              <button
                                onClick={() => api?.resumeDownload(item.id)}
                                className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center gap-1 transition"
                              >
                                <Play className="w-3.5 h-3.5" />
                                Resume
                              </button>
                            )}
                            {item.status === 'completed' && (
                              <>
                                <button
                                  onClick={() => api?.openFile(item.filePath)}
                                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                  Open
                                </button>
                                <button
                                  onClick={() => api?.showInFolder(item.filePath || item.saveDir)}
                                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                                  title="Show in Folder"
                                >
                                  <FolderOpen className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => api?.removeDownload(item.id)}
                              className="p-2 rounded-lg bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition"
                              title="Remove"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Main Progress Bar + IDM-Style 8-Segment Parallel Channels Strip */}
                        <div className="space-y-1.5">
                          <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800/80">
                            <div
                              className={`h-full transition-all duration-300 ${
                                item.status === 'completed'
                                  ? 'bg-emerald-400'
                                  : item.status === 'error'
                                  ? 'bg-rose-500'
                                  : item.status === 'paused'
                                  ? 'bg-amber-400'
                                  : 'bg-gradient-to-r from-cyan-400 via-violet-500 to-pink-500'
                              }`}
                              style={{ width: `${item.status === 'completed' ? 100 : pct}%` }}
                            />
                          </div>

                          {item.status === 'downloading' && (
                            <div className="grid grid-cols-8 gap-1 pt-0.5">
                              {segments.map((segPct, idx) => (
                                <div key={idx} className="h-1 rounded bg-slate-950 overflow-hidden border border-slate-800/60">
                                  <div
                                    className="h-full bg-cyan-400/80 transition-all duration-300"
                                    style={{ width: `${segPct}%` }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-semibold capitalize ${
                                  item.status === 'completed'
                                    ? 'text-emerald-400'
                                    : item.status === 'error'
                                    ? 'text-rose-400'
                                    : item.status === 'paused'
                                    ? 'text-amber-400'
                                    : 'text-cyan-300'
                                }`}
                              >
                                {item.status === 'processing' ? 'Merging Video + Audio...' : item.status}
                              </span>
                              {item.error && <span className="text-rose-400 truncate max-w-md">{item.error}</span>}
                            </div>

                            <div className="flex items-center gap-4 font-mono">
                              <span>{pct.toFixed(1)}%</span>
                              {item.status === 'downloading' && (
                                <>
                                  <span className="text-cyan-300 font-bold">{item.speedText}</span>
                                  <span>ETA: {item.etaText}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: GRAB IMAGES & FILES FROM WEBPAGE */}
          {activeTab === 'grabber' && (
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="rounded-2xl bg-[#111827] border border-slate-800 p-6 space-y-4">
                <div>
                  <h1 className="text-xl font-bold text-white flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-pink-400" />
                    Grab All Images, Videos & Files from Any Website
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Enter any webpage link to view all high-resolution images, videos, setups, and documents on that page and download them in one click.
                  </p>
                </div>

                <div className="flex gap-2.5">
                  <input
                    type="text"
                    value={scanUrl}
                    onChange={(e) => setScanUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleScanWebpage();
                    }}
                    placeholder="Paste website address (e.g. https://example.com)..."
                    className="flex-1 px-4 py-3 rounded-xl bg-slate-950 border border-slate-700/80 text-sm text-white focus:border-pink-400 focus:outline-none"
                  />
                  <button
                    onClick={() => handleScanWebpage()}
                    disabled={scanning}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 text-slate-950 font-bold text-sm flex items-center gap-2 shrink-0"
                  >
                    {scanning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Scanning...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>Find Images & Files</span>
                      </>
                    )}
                  </button>
                </div>

                {scanError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                    {scanError}
                  </div>
                )}
              </div>

              {scanResult && (
                <div className="rounded-2xl bg-[#111827] border border-slate-800 p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                    <div>
                      <div className="text-sm font-bold text-white">{scanResult.pageTitle}</div>
                      <div className="text-xs text-slate-400">
                        Found {scanResult.assets.length} downloadable images & files
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (selectedScanIds.size === filteredScanAssets.length) {
                            setSelectedScanIds(new Set());
                          } else {
                            setSelectedScanIds(new Set(filteredScanAssets.map((a) => a.id)));
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium flex items-center gap-1.5"
                      >
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                        {selectedScanIds.size === filteredScanAssets.length ? 'Unselect All' : 'Select All'}
                      </button>

                      <button
                        onClick={handleDownloadSelectedAssets}
                        className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Selected ({selectedScanIds.size})
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {['all', 'image', 'video', 'setup', 'archive', 'code', 'document'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setScanCategoryFilter(cat)}
                        className={`px-3 py-1 rounded-lg text-xs capitalize font-semibold transition ${
                          scanCategoryFilter === cat
                            ? 'bg-pink-500 text-slate-950'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        {cat === 'all' ? 'All Items' : `${cat}s`}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto pr-1">
                    {filteredScanAssets.map((asset) => {
                      const checked = selectedScanIds.has(asset.id);
                      const cat = CATEGORY_META[asset.category] || CATEGORY_META.other;
                      return (
                        <div
                          key={asset.id}
                          onClick={() => toggleScanItem(asset.id)}
                          className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-3 transition ${
                            checked
                              ? 'bg-cyan-500/10 border-cyan-500/40'
                              : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {}}
                              className="rounded accent-cyan-400"
                            />
                            {asset.category === 'image' ? (
                              <img
                                src={asset.url}
                                alt={asset.filename}
                                className="w-12 h-12 rounded-lg object-cover bg-slate-900 border border-slate-800 shrink-0"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : null}
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-200 truncate">
                                {asset.filename}
                              </div>
                            </div>
                          </div>

                          <span className={`px-2 py-0.5 rounded border text-[10px] uppercase font-bold shrink-0 ${cat.color}`}>
                            {asset.ext || asset.category}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: BROWSER IDM MODE */}
          {activeTab === 'browser-ext' && (
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-[#151c35] to-slate-900 border border-violet-500/30 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-violet-500/20 text-violet-300 border border-violet-500/30">
                      <Puzzle className="w-6 h-6" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold text-white">
                        Browser Download Button Takeover (Like IDM)
                      </h1>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Automatically catch any Download button, Video, or Image you click in Chrome, Edge, or Brave and download it 16x faster in PlusGet!
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
                    Bridge Active
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3">
                    <div className="text-sm font-bold text-cyan-300">
                      Method 1: Connect Your Chrome / Edge / Brave Browser
                    </div>
                    <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                      <li>
                        Click <b>Open Extension Folder</b> below.
                      </li>
                      <li>
                        In Chrome/Edge, open <code className="text-cyan-300 bg-slate-900 px-1.5 py-0.5 rounded">chrome://extensions</code> and turn ON <b>Developer mode</b> (top right).
                      </li>
                      <li>
                        Click <b>Load unpacked</b> and select the opened <code className="text-cyan-300 bg-slate-900 px-1.5 py-0.5 rounded">browser-extension</code> folder!
                      </li>
                    </ol>
                    <div className="text-[11px] text-slate-400">
                      Once added: clicking <b>any Download button</b> on any website cancels the slow browser download and opens PlusGet with the File Name, MB Size, Play Time & Audio Status!
                    </div>
                    <button
                      onClick={() => api?.openExtensionFolder()}
                      className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition"
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span>Open Browser Extension Folder</span>
                    </button>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="text-sm font-bold text-violet-300">
                        Method 2: Use PlusGet's Built-in Smart Browser (No Extension Needed)
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Don't want to install a browser extension? Whenever you open a site in PlusGet's <b>Smart Browser</b>:
                      </p>
                      <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                        <li>Clicking <b>any Download button</b> automatically intercepts the file with Name & MB Size.</li>
                        <li>Playing <b>any Movie or TV Episode</b> automatically grabs the master video+audio stream with MB Size, Play Time & Audio Status.</li>
                        <li>Right-clicking <b>any Image</b> lets you download it immediately.</li>
                      </ul>
                    </div>
                    <button
                      onClick={() => handleOpenEpisodePicker(urlInput || 'https://www.google.com')}
                      className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition"
                    >
                      <Tv className="w-4 h-4" />
                      <span>Launch PlusGet Smart Browser</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: MULTIPLE LINKS */}
          {activeTab === 'batch' && (
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="rounded-2xl bg-[#111827] border border-slate-800 p-6 space-y-4">
                <div>
                  <h1 className="text-xl font-bold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-emerald-400" />
                    Download Multiple Links at Once
                  </h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Paste as many links as you want (videos, images, setups, archives) — one link per line.
                  </p>
                </div>

                <textarea
                  rows={8}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={`https://www.youtube.com/watch?v=...\nhttps://example.com/photo.png\nhttps://example.com/installer.exe`}
                  className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-400 focus:outline-none text-xs text-slate-200"
                />

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-300">Quality for Videos:</span>
                    <select
                      value={batchQuality}
                      onChange={(e) => setBatchQuality(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200"
                    >
                      <option value="1080p">1080p Full HD</option>
                      <option value="720p">720p HD</option>
                      <option value="480p">480p Standard</option>
                      <option value="audio-320">Audio Only (MP3)</option>
                    </select>
                  </div>

                  <button
                    onClick={handleStartBatchDownload}
                    className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download All Links</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SIMPLE PREFERENCES */}
          {activeTab === 'settings' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="rounded-2xl bg-[#111827] border border-slate-800 p-6 space-y-5">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-cyan-400" />
                  Preferences
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      Save Downloads To
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={settings.downloadDir}
                        className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300"
                      />
                      <button
                        onClick={async () => {
                          const chosen = await api?.selectDownloadFolder();
                          if (chosen) setSettings((s) => ({ ...s, downloadDir: chosen }));
                        }}
                        className="px-4 py-2.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold"
                      >
                        Change Folder
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      Simultaneous Downloads: {settings.maxConcurrent} at a time
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={6}
                      value={settings.maxConcurrent}
                      onChange={(e) => handleUpdateSetting({ maxConcurrent: Number(e.target.value) })}
                      className="w-full accent-cyan-400"
                    />
                  </div>

                  <label className="flex items-center justify-between p-4 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-200">Auto-Detect Copied Links</div>
                      <div className="text-[11px] text-slate-400">
                        Offer to download automatically whenever you copy a link in your web browser
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.clipboardMonitor)}
                      onChange={(e) => handleUpdateSetting({ clipboardMonitor: e.target.checked })}
                      className="w-4 h-4 accent-cyan-400"
                    />
                  </label>

                  <label className="flex items-center justify-between p-4 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer">
                    <div>
                      <div className="text-xs font-semibold text-slate-200">Sort into Category Folders</div>
                      <div className="text-[11px] text-slate-400">
                        Automatically organize into Video, Audio, Setup, and Image folders
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.organizeByCategory)}
                      onChange={(e) => handleUpdateSetting({ organizeByCategory: e.target.checked })}
                      className="w-4 h-4 accent-cyan-400"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
