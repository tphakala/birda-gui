# Birda GUI

[![CI](https://github.com/tphakala/birda-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/tphakala/birda-gui/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub-pink.svg)](https://github.com/sponsors/tphakala)

Desktop GUI for [birda](https://github.com/tphakala/birda), a bird species detection CLI powered by BirdNET. Analyze audio recordings for bird species, browse detections, and explore results on an interactive map.

Built with Electron, Svelte 5, and Tailwind CSS.

## Features

- **Audio analysis**: Run BirdNET detection on audio files with real-time progress tracking
- **Detection browser**: Browse, filter, and sort bird species detections with audio playback
- **Interactive map**: View detections on a MapLibre GL map by location
- **Species overview**: Summary statistics across all analyzed recordings
- **Audio waveforms**: Visualize and play back detection audio clips with WaveSurfer.js
- **Local database**: All detections stored locally in SQLite
- **Bundled CLI**: The birda CLI is included with release builds; no separate installation needed

## Download

Pre-built binaries for Windows, Linux, and macOS are available on the [Releases](https://github.com/tphakala/birda-gui/releases) page.

| Platform | Formats                                   |
| -------- | ----------------------------------------- |
| Windows  | NSIS installer, portable exe (x64)        |
| Linux    | AppImage, deb (x64)                       |
| macOS    | dmg, signed and notarized (Apple silicon) |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (22.12 or a later 22.x, 24.x, or 26 and newer, as required by the `electron` package and Vitest 5)
- Network access on the first build or lint: the translation compiler downloads its inlang plugins once and caches them in `project.inlang/cache`

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

The build automatically fetches the bundled birda CLI binary into `resources/birda-cli/`. In development the app uses the CLI path set in Settings when one is set (an invalid path is reported as an error). Otherwise it uses that bundled copy (fetched by `npx tsx scripts/fetch-birda-cli.ts`, `task fetch-cli`, or any build), then a [birda](https://github.com/tphakala/birda) CLI on your PATH.

## Tech Stack

- **Electron 43**: Desktop runtime
- **Svelte 5**: UI framework (runes)
- **Tailwind CSS 4** + **daisyUI 5**: Styling
- **TypeScript**: Strict mode throughout
- **better-sqlite3**: Local detection storage
- **WaveSurfer.js**: Audio waveform visualization
- **MapLibre GL**: Map visualization
- **Paraglide**: Compile-time i18n
- **Vite** + **electron-builder**: Build tooling and packaging

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for copyright information.
