# Reference images

The editor import and controls live in [editor.js](../../editor.js). [geometry.js](../../geometry.js) validates imported reference records and defines image limits. [board-renderer.js](../../board-renderer.js) shares the image positioning logic with the viewer.

## Preserve these behaviors

- Validate PNG and JPEG using file signatures and decoded dimensions during image import. Keep per-image, total payload, and image count limits consistent with project validation in `readReferences`.
- Store self-contained image data URLs in the project. `x` and `y` represent the image center, `width` is in millimetres, and `pixelWidth` and `pixelHeight` determine its aspect ratio.
- Render references inside the board clip below the grid and tiles. Preserve visibility, opacity, scale, and position through save and reload.
- Keep asynchronous imports tied to the project generation that started them so opening or creating a project during an image read cannot attach images to the wrong project. Treat slider input and dragging as previews until the edit is committed.

## Check changes

- Import a PNG or JPEG and reject an invalid file. Move, resize, hide, and undo an image edit.
- Save and reopen a project with an image in both the editor and viewer. For image storage changes, also exercise a project large enough to use IndexedDB.
