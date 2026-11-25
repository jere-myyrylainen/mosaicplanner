# Board and grout

[geometry.js](../../geometry.js) owns the board boundary and tile fit checks. [editor.js](../../editor.js) owns the board controls. [board-renderer.js](../../board-renderer.js) draws the board, clip, grid, and grout for both entry points.

## Preserve these behaviors

- Keep the board centered at the origin. A circular board uses equal width and height. For a rounded rectangle, cap the corner radius at half the shorter dimension. Keep the rendered outline and `fitsBoard` consistent when changing supported shapes.
- Render editor rulers on the top and left of the board's bounding box. Keep 10% ticks and format their values in millimetres from the left or top origin. Use the view's scale to size ruler text and thin crowded labels as space runs out.
- Reject board geometry edits that leave any placed tile outside the new boundary. Check tile shape and rotation as part of the fit.
- The optional square worktable sits to the right of the board. Its size stays fixed during board edits. Move its pieces by the same offset as the table when the board dimensions change. Fit to view includes both surfaces when the table is open.
- Clip grout to each piece's own surface. The mosaic board remains the clip for reference images.
- Preserve the SVG layer order from board to reference images, grid, grout, tile faces, and custom guides. Keep reference images and grout clipped to the board. Editor previews and selection outlines sit above the shared layers.
- Keep grout rendering and placement spacing aligned. Each tile contributes half the joint width outside its face. A zero width hides the grout layer's contents. Changing width redraws grout and affects later placements without repositioning existing tiles.
- Preserve the default grout color when opening files saved before `seamColor` was added.

## Check changes

- Test tiles near the edge of rectangular, circular, and rounded boards. Try a board resize that would exclude a placed tile.
- Check rulers after resizing, changing language, zooming, panning, and fitting the board. At a typical fit, verify values at both ends and at every 10% tick.
- Verify grout at zero and nonzero widths and compare the editor and viewer after saving a custom color.
- Put tiles near the outer edges of both surfaces and use a grout width larger than the gap between surfaces. Resize the board and undo while a piece is on the worktable.
