# Lumirec

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/Tedysek01/lumirec)](https://github.com/Tedysek01/lumirec/stargazers)
[![Download](https://img.shields.io/github/v/release/Tedysek01/lumirec?label=download)](https://github.com/Tedysek01/lumirec/releases/latest)

**Free, open-source screen recorder with a built-in editor for macOS.** Record your screen and turn it into a polished product demo in minutes — no subscriptions, no watermarks.

Think Screen Studio, but free.

## What you can do

- **Record** your whole screen or a specific app
- **Auto-zoom** that follows your cursor automatically
- **Highlight** your cursor and clicks so viewers never lose track
- **Annotate** with text, arrows, and images
- **Edit** on a timeline — trim, split, rearrange, add transitions
- **Style** with custom backgrounds, aspect ratios, and motion blur
- **Export** as MP4 or GIF

Everything happens inside one app. Record, edit, export. That's it.

## Download

Grab the latest `.dmg` from the [Releases page](https://github.com/Tedysek01/lumirec/releases/latest).

- **Apple Silicon** (M1/M2/M3/M4) — `arm64` build
- **Intel Mac** — `x64` build

> Not code-signed yet. On first launch, right-click the app and select "Open".

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build:mac
```

## Tech Stack

Electron + React + TypeScript + Vite + PixiJS

## Credits

Built on top of [OpenScreen](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem — MIT License.

## License

[MIT](LICENSE)
