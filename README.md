# PlusGet — Universal Video, Movie, Image & 16x Turbo Download Manager

<p align="center">
  <img src="public/logo.png" width="128" alt="PlusGet Logo" />
</p>

**PlusGet** is a high-speed desktop download manager and universal video/file grabber built with **Electron**, **React**, **Tailwind CSS**, **Node.js**, **`yt-dlp`**, and **`FFmpeg`**.

## Key Features

- **Pre-Download File Name, MB Size, Play Time & Audio Detection**:
  - Displays the editable **File Name**, **Size & Play Time** (e.g., `~280 MB / 1h 30m`), and **Audio Track Status** (`🔊 Audio Included (AAC)` vs. `🔇 No Audio (Video Only)`) before downloading.
- **Universal Movie, TV Series & Social Video Downloader**:
  - Supports **YouTube, TikTok, Facebook, Instagram, X/Twitter, Vimeo, Reddit**, and **Multi-Server / Multi-Episode Movie & TV Streaming Websites** via a built-in **Smart Stream Sniffer & Episode Picker** with automatic ad/popup blocking and HLS `master.m3u8` audio+video merging.
- **8x–16x Parallel Turbo Download Engine (Like IDM)**:
  - Splits direct files (`.exe`, `.msi`, `.iso`, `.zip`, code, documents, images) into **8 parallel byte-range connections** and downloads **16 concurrent stream segments** for videos.
- **Browser Download Button Takeover (`browser-extension/`)**:
  - Includes a Chrome / Edge / Brave extension (`browser-extension/`) and local bridge (`127.0.0.1:45789`) that automatically intercepts browser download buttons, adds a floating **`⬇ Download Video with PlusGet`** button over web video players, and adds right-click **Download Image / Link with PlusGet** menu items.
- **Full Image & Webpage Asset Grabber**:
  - Download individual images with format conversion (`.JPG`, `.PNG`, `.WEBP`, `.ICO`) or scan any webpage URL to batch-download all images, videos, setups, and files.

## Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build React frontend
npm run build

# Start Electron desktop app
npm start
```
