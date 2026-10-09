PIXL’s own colour, a clearer way to export, and scopes at full size.

## Colour

- The engine now works in PixlRGB, PIXL’s own wide working space.
- Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like.
- HDR exports use the engine’s own tone mapping, gamut compression and gain maps.
- RAW files use PIXL’s own camera colour for the 46 bodies it knows (the others keep the file’s own). RAWs you edited before can shift a little, and heals, denoise and enhance made on the old colour are marked, because their pixels moved. Your white balance keeps its look. Switch any photo back under Colour in the develop panel.

## Export

- Export in four steps: Format, Size & colour, Metadata & HDR, and Review, built from the editor’s own cards and sliders.
- Review shows the first photo as it will be exported, and what would go wrong before it does: a setting that cannot work, a folder that cannot be written, a full disk, files that would be replaced.
- Fit a photo inside a width and height, and read what each rendering intent does next to the choice.

## Scopes

- The histogram and the colour chart open at full size: overlay, parade, one channel or luma, with the before picture behind and HDR in stops.
- A CIE 1976 chart with PixlRGB and the gamuts you compare it to.
- Metrics before and after (range, contrast, clipping, colour cast), the photo’s dominant colours with their values, and how it reads with a colour-vision deficiency.

## Masks

- Object detection has its own button beside the brush, gradients and lasso.
- A mask’s edge is one crisp line at any zoom.
- The pins over the photo are gone; gradient and lasso handles show when the pointer is over the photo.

## Changes

- HEIC export is replaced by AVIF (HEIC files still open).
- Select Subject is moving to one smaller model (U²-Netp). If you already have U²-Net or the exact JPEG repair, they are listed under AI models as being retired: U²-Net keeps making Subject and Background masks until the next update, and either can be removed to free the space.

## Coming soon

- **Better models**: Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.
- **Smart looks, reimagined**: Looks that understand more of the photo and adjust each part on its own.
- **An MCP server for the editor**: Let an AI assistant work in Playroom with you, on your own computer.
- **And much more**: This is a beta: there is a lot more on the way.
