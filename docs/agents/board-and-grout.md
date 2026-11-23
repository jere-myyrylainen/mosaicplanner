# Board and grout

[geometry.js](../../geometry.js) owns the board boundary and tile fit checks. [editor.js](../../editor.js) owns the board controls. [board-renderer.js](../../board-renderer.js) draws the board, clip, grid, and grout for both entry points.

## Preserve these behaviors

- Keep the board centered at the origin. A circular board uses equal width and height. For a rounded rectangle, cap the corner radius at half the shorter dimension. Keep the rendered outline and `fitsBoard` consistent when changing supported shapes.
- Reject board geometry edits that leave any placed tile outside the new boundary. Check tile shape and rotation as part of the fit.
- Preserve the SVG layer order from board to reference images, grid, grout, tile faces, and custom guides. Keep reference images and grout clipped to the board. Editor previews and selection outlines sit above the shared layers.
- Keep grout rendering and placement spacing aligned. Each tile contributes half the joint width outside its face. A zero width hides the grout layer's contents. Changing width redraws grout and affects later placements without repositioning existing tiles.
- Preserve the default grout color when opening files saved before `seamColor` was added.

## Check changes

- Test tiles near the edge of rectangular, circular, and rounded boards. Try a board resize that would exclude a placed tile.
- Verify grout at zero and nonzero widths and compare the editor and viewer after saving a custom color.
