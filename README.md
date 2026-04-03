# Birda GUI

[![CI](https://github.com/tphakala/birda-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/tphakala/birda-gui/actions/workflows/ci.yml)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Electron](https://img.shields.io/badge/Electron-41-47848F.svg)](https://www.electronjs.org/)
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub-pink.svg)](https://github.com/sponsors/tphakala)

Desktop GUI for [birda](https://github.com/tphakala/birda), a bird species detection CLI powered by BirdNET. Analyze audio recordings for bird species, browse detections, and explore results on an interactive map.

Built with Electron, Svelte 5, and Tailwind CSS.

## Features

- **Audio analysis** - Run BirdNET detection on audio files with real-time progress tracking
- **Detection browser** - Browse, filter, and sort bird species detections with audio playback
- **Interactive map** - View detections on a MapLibre GL map by location
- **Species overview** - Summary statistics across all analyzed recordings
- **Audio waveforms** - Visualize and play back detection audio clips with WaveSurfer.js
- **Local database** - All detections stored locally in SQLite
- **Bundled CLI** - The birda CLI is included with release builds; no separate installation needed

## Download

Pre-built binaries for Windows, Linux, and macOS are available on the [Releases](https://github.com/tphakala/birda-gui/releases) page.

| Platform | Formats                      |
| -------- | ---------------------------- |
| Windows  | NSIS installer, portable exe |
| Linux    | AppImage, deb                |
| macOS    | dmg (signed & notarized)     |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)

### Setup

```bash
npm install
```

### Run

```bash
npm run dev
```

### Build

```bash
# Build for current platform
npm run dist

# Platform-specific
npm run dist:win     # Windows (NSIS installer + portable)
npm run dist:linux   # Linux (AppImage + deb)
npm run dist:mac     # macOS (dmg)
```

The build automatically fetches the bundled birda CLI binary. For development, the [birda](https://github.com/tphakala/birda) CLI must be installed and available on your PATH.

## Tech Stack

- **Electron 41** - Desktop runtime
- **Svelte 5** - UI framework (runes)
- **Tailwind CSS 4** + **daisyUI 5** - Styling
- **TypeScript** - Strict mode throughout
- **better-sqlite3** - Local detection storage
- **WaveSurfer.js** - Audio waveform visualization
- **MapLibre GL** - Map visualization
- **Paraglide** - Compile-time i18n
- **electron-vite** - Build tooling

## License

[CC BY-NC-SA 4.0](LICENSE)
