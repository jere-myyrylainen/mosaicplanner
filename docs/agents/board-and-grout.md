# Board and grout

[geometry.js](../../geometry.js) owns the board boundary and tile fit checks. [editor.js](../../editor.js) owns the board controls. [board-renderer.js](../../board-renderer.js) draws the board, clip, grid, and grout for both entry points.

## Preserve these behaviors

- Use the same board shape and size form for a new project and for **Project → Board settings**. Set the project’s default grout width and color in the same form. Apply its geometry and grout fields in one action.
- Keep the board centered at the origin. A circular board uses equal width and height. For a rounded rectangle, cap the corner radius at half the shorter dimension. Keep the rendered outline and `fitsBoard` consistent when changing supported shapes.
- Render editor rulers on the top and left of the board's bounding box. Keep 10% ticks and format their values in millimetres from the left or top origin. Use the view's scale to size ruler text and thin crowded labels as space runs out.
- Reject board geometry edits that leave any placed tile outside the new boundary. Check tile shape and rotation as part of the fit.
- The worktable fills its own panel beside the tile library, or directly below the canvas on narrow screens. Keep its width fixed in millimetres and extend the editing area vertically to fill the panel at 100% zoom. Move its pieces by the same offset as the table when the board dimensions change. Fit and zoom each canvas independently.
- Clip grout to each piece's own surface. The mosaic board remains the clip for reference images.
- Preserve the SVG layer order from board to reference images, grid, grout, tile faces, and custom guides. Keep reference images and grout clipped to the board. Editor previews and selection outlines sit above the shared layers.
- Use the same editor theme color for the bare board and worktable. Keep the grid, guides, and editing marks visible in light and dark themes. Tile and grout colors come from the project.
- Keep grout rendering and placement spacing aligned. Each piece contributes half its own grout width outside its face. A zero width hides that piece’s grout. A piece inherits the project width and color wherever it has no override. Changing width redraws grout and affects later placements without repositioning existing pieces.
- Keep both split pieces touching along the cut. Preserve the source piece’s grout overrides in both fragments.
- Preserve the default grout color when opening files saved before `seamColor` was added.

## Check changes

- Start a project with each board shape and verify the library is retained. Cancel a new project and a board edit, then apply multiple changed fields and undo them together.
- Test tiles near the edge of rectangular, circular, and rounded boards. Try a board resize that would exclude a placed tile.
- Check rulers after resizing, changing language, zooming, panning, and fitting the board. At a typical fit, verify values at both ends and at every 10% tick.
- Verify neighboring pieces with different widths and colors, including a piece with zero width. Compare the editor and viewer after saving.
- Put tiles near the outer edges of both surfaces and use a grout width larger than the gap between surfaces. Resize the board and undo while a piece is on the worktable.
- Show and hide an occupied worktable. Verify that the board zoom and the worktable tiles stay intact when reopening the panel.
- Place a tile in the extra worktable height, then undo, redo, and reopen at a shorter viewport. Confirm the entire placement remains available with the worktable's fit control.
