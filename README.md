<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logo-dark.svg"/>
  <img src="docs/readme/logo-light.svg" alt="Pixl Playroom" width="460"/>
</picture>

**Develop everything. Rent nothing.**

<a href="https://github.com/xuckless/pixl-playroom/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/xuckless/pixl-playroom?include_prereleases&style=flat-square&color=9d8bea&labelColor=0b0816&label=release"/></a> <img alt="macOS · Windows" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows-ebe9f3?style=flat-square&logo=apple&logoColor=ebe9f3&labelColor=0b0816"/> <a href="#license"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-9d8bea?style=flat-square&labelColor=0b0816"/></a> <img alt="Built on the PIXL engine" src="https://img.shields.io/badge/built%20on-PIXL%20engine-ebe9f3?style=flat-square&labelColor=0b0816"/>

[playroom.pixlfoundation.com](https://playroom.pixlfoundation.com) · [Features](docs/features.md) · [Keys](docs/keys.md) · [How it fits together](docs/architecture.md) · [Releases](https://github.com/xuckless/pixl-playroom/releases)

<br/>

<img src="docs/readme/screenshot.webp" alt="Pixl Playroom developing a RAW of yellow flowers, split before and after, with the histogram and the adjustment cards on the right" width="820"/>

</div>

A RAW photo developer for macOS and Windows: masks, looks, colour grading, AI noise reduction and super-resolution, working on the folders you already have. Free during the beta.

## Every frame is a real render

What you see is the [PIXL engine](https://engine.pixlfoundation.com)'s render of your photo with its recipe, through the same compiler an export uses. The histogram measures exactly what is shown.

<img src="docs/readme/develop.svg" alt="Moving the Temperature slider from 5200 K to 7400 K warms a pixel landscape and moves its histogram" width="720"/>

## Your folders, as they are

No import and no catalogue. The original is never written: your edit lives in a sidecar beside it, and titles and keywords go into a standard `.xmp` file other apps read too.

<img src="docs/readme/files.svg" alt="A folder holding IMG_0042.CR2, never written, with IMG_0042.CR2.playroom.json and IMG_0042.xmp appearing beside it" width="720"/>

## What's inside

- **Develop:** every Lightroom-style card from white balance to detail, PIXL's camera profiles for 46 bodies, 306 looks, curves, the colour mixer and colour grading.
- **Masks:** Subject, Background, Objects (click, box or scribble), Sky, People and their parts, brushes and gradients, joined by add, subtract and intersect.
- **AI:** denoise, deblur, JPEG restore and super-resolution. Models download on demand and run on your computer.
- **Library:** ratings, flags, labels, smart collections, stacks, duplicates, virtual copies and batch export.
- **HDR:** gain maps read and written, and HDR editing on a display with headroom.

Every card and tool, with the engine operation behind it: [docs/features.md](docs/features.md)

## Install

Download the latest beta for macOS 15+ (Apple silicon or Intel) or Windows 10+ (64-bit) from [playroom.pixlfoundation.com](https://playroom.pixlfoundation.com). Playroom updates itself on the stable or beta channel (Settings → Updates).

## Develop

```sh
pnpm install             # needs a read:packages token for the engine (.github/RELEASING.md)
pnpm dev                 # the app; pnpm dev -- /path/to/photo.CR2 opens a photo
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

The engine is `@xuckless/pixl-engine`, a closed package of compiled binaries, so a build needs access to it. Automation, model mirrors and development kits: [docs/development.md](docs/development.md). The project file format: [docs/pixl-format.md](docs/pixl-format.md). Planned work: [TODO.md](TODO.md).

## License

Pixl Playroom's source is [Apache-2.0](LICENSE) (see [NOTICE](NOTICE)). The PIXL engine it loads at run time is a separate, closed-source component, distributed only as compiled binaries; it is not covered by this licence and is not available through this repository. Third-party components are listed in [build/THIRD_PARTY_NOTICES.txt](build/THIRD_PARTY_NOTICES.txt).
