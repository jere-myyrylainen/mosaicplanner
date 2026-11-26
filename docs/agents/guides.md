# Guides and snapping

The guide controls live in [index.html](../../index.html) and the gestures in [editor.js](../../editor.js). [geometry.js](../../geometry.js) defines guide geometry, snapping, and saved data validation. [board-renderer.js](../../board-renderer.js) renders guides in the editor and viewer.

## Preserve these behaviors

- Put grid visibility, spacing, line weight, offsets, and the move command under **Project → Guide grid settings**. The custom guide button opens its adjacent toolbar with the first option aligned to the main tool immediately above it. Hide this toolbar when no guide tool is available or another tool is active. Keep custom guide visibility in **View** and both snap choices behind the magnet in the bottom bar.
- Keep `grid.visible` and `grid.guidesVisible` independent. `grid.snap` controls snapping to both visible sources. Saved projects use a top-level `guides` array. Files predating custom guides default to an empty array with custom guide visibility enabled.
- Keep snapping to placed tiles independent of guide visibility and guide snapping. `grid.snapTiles` defaults to false in older projects. Use `PlacementIndex.snapPlacement` to prioritize a valid pair of nearby snap edges before trying single targets. Prefer the closer valid position between competing pairs.
- On the worktable, use tile snap targets from the table itself. Grid and custom guide snapping apply to the mosaic board.
- Use `gridOrigin` for both the SVG pattern and snapping. Each axis starts at the saved offset minus half the grid spacing. `grid.offsetX` and `grid.offsetY` are in millimetres, positive right and down, and default to zero in older projects. When only one line attracts, a vertical line preserves Y and a horizontal line preserves X.
- Use `paintGridPosition` to preview drag adjustments in the editor. Commit both offsets together on release and restore the saved position on cancellation. Keep the move tool available while the guide grid is visible.
- Build guide targets from the moving tile's boundary and rotation. Keep the tile face half the moving piece’s grout width from the guide or grid line, so the line marks the center of the joint. At zero grout width the face touches the line. For custom guides use finite segments or circumferences, and support both sides of the line and the inside or outside of a circle when the tile fits.
- Support all pairs of snap targets from placed tiles, visible grid lines, and visible custom guides. A square guide contributes four independent edges. For a pair made entirely of grid lines, cap the per-axis tolerance at a quarter of the grid spacing so single-axis snapping remains available.
- For a grid-and-tile pair, require the grid line and the tile contact to constrain separate directions. A shared line or tangent constrains one direction. Prefer a valid grid-and-tile position to a pure grid crossing so a continued row keeps the set grout gap.
- Convert the eight-CSS-pixel tolerance into board units when the editor view changes. Allow two nearby edges to combine diagonally within square root of two times the usual tolerance. When pointing at a visible guide crossing, use the tile's size to keep grout-offset candidates local. Prefer the side of each line the pointer is on and try other sides when those positions are blocked.
- A line guide can snap either endpoint to a nearby board-edge anchor within the screen-pixel tolerance. Keep this independent of tile snapping. A square starts at a corner and a circle starts at its center, using raw pointer coordinates. Use `guideFromDrag` and `guideShape` to keep the preview and committed outline consistent.
- Derive anchors from the current board with `boardGuideAnchors`. Step by 10 mm from the bounding box's left or top and include the full span. Project each mark to both corresponding sides of the actual outline, including arcs on rounded and circular boards. Keep anchors out of the project JSON. The saved line contains the resulting endpoint coordinates.
- With a mouse, start a guide on the first press, preview on pointer movement, and commit on the second press. Escape cancels the preview and keeps the tool active. On touchscreens and with pens, commit on drag release. Discard canceled and zero-size drawings. Guide erasing targets the nearest custom outline and uses the same action history as drawing.

## Check changes

- Test clicks near both axes and near a crossing, clicks outside the snap distance, and the same interactions at two zoom levels.
- Aim at a crossing with only the grid visible and verify simultaneous alignment. Then move away from the crossing along one grid line and verify that motion on the other axis stays free.
- With both snapping options on, place the first tile by aiming at a grid crossing. Place a second tile in the same row. Test grid spacing that matches the tile plus grout and spacing that differs. Check alignment when pointing at the next tile center and at the visible grid crossing.
- Shift the grid with numeric inputs and by dragging. Check visual and snap alignment on both axes, cancellation and undo, and the saved position in the editor and viewer.
- With both snapping options on, test a closer guide, a closer tile edge, and a guide target blocked by placed tiles.
- Verify all six pairings of the three snap sources. Include diagonal lines, corners of a square guide, circular guides, and a crossing that is blocked or outside the snap tolerance.
- Aim directly at a crossing with a tile wider than the snap tolerance, then approach the same crossing with both tile edges just inside their individual snap distances.
- Check the gap between the tile face and the guide for rectangles, rotated polygons, and circles. Include zero and nonzero grout widths, two tiles on opposite sides of a guide, and the inside and outside of a circular guide.
- Draw and remove all three guide shapes. Verify that moving with the mouse button released updates the preview, the second press commits, and Escape clears the preview with the tool still active. Check undo and redo, independent visibility, and snapping with each guide source hidden.
- Draw a line between edge anchors with tile snapping off. Check both endpoints at two zoom levels, and repeat on a circle and a rounded rectangle. Include a board dimension with a partial 10 mm interval at the far end.
- Save and reopen the project in the editor and viewer. Check the guide geometry and visibility in both.
