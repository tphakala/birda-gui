# Birda GUI

[![CI](https://github.com/tphakala/birda-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/tphakala/birda-gui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-40-47848F.svg)](https://www.electronjs.org/)
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub-pink.svg)](https://github.com/sponsors/tphakala)

Desktop GUI for [birda](https://github.com/tphakala/birda), a bird species detection CLI powered by BirdNET.

Built with Electron, Svelte 5, and Tailwind CSS.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [birda](https://github.com/tphakala/birda) CLI installed and available on your PATH

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
# Build for current platform
npm run dist

# Platform-specific
npm run dist:win     # Windows (NSIS installer + portable)
npm run dist:linux   # Linux (AppImage + deb)
npm run dist:mac     # macOS (dmg)
```

## Tech Stack

- **Electron 40** - Desktop runtime
- **Svelte 5** - UI framework (runes)
- **Tailwind CSS 4** + **daisyUI 5** - Styling
- **better-sqlite3** - Local detection storage
- **WaveSurfer.js** - Audio waveform visualization
- **MapLibre GL** - Map visualization
- **electron-vite** - Build tooling

## License

[MIT](LICENSE)
