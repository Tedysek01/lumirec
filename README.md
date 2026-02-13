# Lumirec

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/Tedysek01/lumirec)](https://github.com/Tedysek01/lumirec/stargazers)

**The free, open-source screen recorder with a built-in editor.** Record polished product demos, tutorials, and bug reports — no subscriptions, no watermarks, no limits.

Think Screen Studio, but free.

## Why Lumirec?

Most screen recorders just capture your screen. Lumirec captures it *and* makes it look professional — auto-zoom that follows your cursor, smooth transitions, cursor highlights, annotations, and more. All built into one app.

## Features

**Recording**
- Record your entire screen or a specific app window
- Audio capture support

**Auto-Zoom & Camera Work**
- Auto-zoom that intelligently follows cursor activity
- Manual zoom with full keyframe control — set depth, duration, and position
- Cursor smoothing for clean, professional mouse movement
- Motion blur for silky pan and zoom animations

**Cursor Highlights**
- Customizable cursor spotlight effects
- Click highlights to make interactions obvious

**Annotations**
- Text labels, arrows, and image overlays
- Google Fonts support for beautiful typography

**Editing**
- Timeline editor with drag-and-drop segments
- Trim, split, and rearrange clips
- Transitions between segments
- Crop to any region
- Undo/redo for every action
- Save and load project files

**Backgrounds & Style**
- Wallpapers, solid colors, gradients, or custom images
- Multiple aspect ratios (16:9, 16:10, 4:3, 1:1, 9:16)
- Custom resolutions

**Export**
- MP4 and GIF export
- Multiple resolution presets

## Installation

Download the latest release for your platform from the [Releases page](https://github.com/Tedysek01/lumirec/releases).

Supports macOS, Windows, and Linux.

## Development

```bash
npm install
npm run dev
```

### Build for production

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

## Tech Stack

Electron + React + TypeScript + Vite + PixiJS

## Credits

Built on top of [OpenScreen](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem — MIT License.

## License

[MIT](LICENSE) — do whatever you want with it.
