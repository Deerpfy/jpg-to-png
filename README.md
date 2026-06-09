# JPG to PNG - Offline Converter

A tiny, single-purpose web tool that converts JPG/JPEG images to lossless PNG
entirely in your browser. There is no server, no build step, and no network
request at any time. Your images never leave your device.

## What it does

- Converts one or many `.jpg` / `.jpeg` files to `.png`.
- Decodes and encodes images locally with the Canvas API.
- Preserves the original pixel dimensions. PNG is lossless, so there is no
  quality setting and nothing to tune.
- Keeps the correct visual orientation of EXIF-rotated photos (where the
  browser supports `createImageBitmap`).
- Produces opaque PNGs, which is correct because JPGs carry no transparency.

## How to use

1. Open `index.html` in a browser. You can double-click the file or drag it
   into a browser window. No local server is required.
2. Drop one or more JPG/JPEG files onto the drop zone, or click it to pick
   files with your system file dialog.
3. Each image is converted and listed with a preview, its output pixel
   dimensions, and a **Download PNG** button.
4. Use **Download all PNGs** to save every converted image in sequence, or
   **Clear** to start over.

Each PNG is saved with the original file name and a `.png` extension
(for example `photo.jpg` becomes `photo.png`).

## 100% offline and client-side

This tool runs completely on your device:

- It works straight from the `file://` protocol. No web server, no upload,
  no API call.
- It uses no third-party libraries, no CDN, no remote fonts, and no analytics.
- All processing happens in the browser tab via the Canvas API.

You can confirm this by opening your browser developer tools: the Network tab
shows no requests when you convert images.

## Browser support

- Requires a modern browser with HTML Canvas support (`canvas.toBlob` with
  `image/png`). This covers current versions of Chrome, Edge, Firefox, and
  Safari.
- EXIF orientation is honored through `createImageBitmap` with
  `imageOrientation: "from-image"`. If a browser lacks `createImageBitmap`,
  the tool falls back to decoding through an `<img>` element; conversion still
  works, but automatic EXIF rotation may not be applied.
- Non-JPEG files are rejected with an inline message, and a file that fails to
  decode shows an inline error on its own row without interrupting the rest of
  the batch.

## A note on fonts

To honor the strict offline, no-CDN constraint, the interface uses fonts that
are already installed on your system (a refined serif for the headline, the
platform UI sans for controls, and a monospace face for pixel dimensions). No
font files are downloaded or bundled.

## File tree

```
jpg-to-png/
  index.html              Single screen; links the stylesheet in <head> and
                          loads tool.js as a classic script before </body>.
  assets/
    css/
      style.css           Visual system from the apple-frontend-design and
                          apple-mobile-design passes.
    js/
      tool.js             Classic script (window globals): drag-and-drop and
                          file picker, Canvas JPG-to-PNG conversion, per-file
                          download, download-all, edge-case handling, and
                          object-URL cleanup.
  README.md               This file.
```
