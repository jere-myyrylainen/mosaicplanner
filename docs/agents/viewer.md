# Read-only viewer

[viewer.html](../../viewer.html), [viewer.js](../../viewer.js), and [viewer.css](../../viewer.css) provide the read-only entry point. The viewer shares project decoding, localization, and SVG rendering with the editor.

## Preserve these behaviors

- Keep all scripts loaded by the viewer compatible with Safari on iOS 12, including `geometry.js`, `i18n.js`, and `board-renderer.js`. Keep the `FileReader` file path and SVG `xlink:href` for reference images.
- Support local selection of a saved project and relative same-origin HTTP or HTTPS URLs passed as `?project=`. Use the shared project reader on both paths and let the latest load win if requests overlap.
- Render saved board, tile, grout, and visibility state with the shared renderer. Keep zoom controls, scroll-to-pan, and Fit to view usable on narrow touch screens.

## Check changes

- Open a saved file with grout, a reference image, and custom guides. Compare visible layers with the editor and try an invalid file and a same-origin project link.
- Check zoom and fit in a narrow viewport. Record the actual browser used for testing, especially when an iOS 12 device is unavailable.
