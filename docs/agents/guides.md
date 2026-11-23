# Guides and snapping

The guide controls live in [index.html](../../index.html) and the gestures in [editor.js](../../editor.js). [geometry.js](../../geometry.js) defines guide geometry, snapping, and saved data validation. [board-renderer.js](../../board-renderer.js) renders guides in the editor and viewer.

## Preserve these behaviors

- Keep `grid.visible` and `grid.guidesVisible` independent. `grid.snap` controls snapping to both visible sources. Saved projects use a top-level `guides` array. Files predating custom guides default to an empty array with custom guide visibility enabled.
- Keep snapping to placed tiles independent of guide visibility and guide snapping. `grid.snapTiles` defaults to false in older projects. Use `PlacementIndex.snapPlacement` to prioritize the nearest valid combined position within the screen-pixel tolerance, then use the existing single-target behavior. Prefer tile contact at equal distance.
- Use `gridOrigin` for both the SVG pattern and snapping. Each axis starts at the saved offset minus half the grid spacing. `grid.offsetX` and `grid.offsetY` are in millimetres, positive right and down, and default to zero in older projects. Project onto one horizontal or vertical line at a time. A vertical line preserves Y and a horizontal line preserves X, including near a crossing.
- Use `paintGridPosition` to preview drag adjustments in the editor. Commit both offsets together on release and restore the saved position on cancellation. Keep the move tool available while the guide grid is visible.
- Build guide targets from the moving tile's boundary and rotation. Keep the tile face half the current grout width from the guide or grid line, so the line marks the center of the joint. At zero grout width the face touches the line. For custom guides use finite segments or circumferences, and support both sides of the line and the inside or outside of a circle when the tile fits.
- Combine the resulting tile positions for different visible custom guides and for custom guides with nearby grid lines. Pure grid intersections retain single-axis snapping. Convert the eight-CSS-pixel tolerance into board units when the editor view changes.
- Allow two nearby guide contacts to combine diagonally within square root of two times the usual tolerance. When pointing at a visible guide crossing, also check the nearby grout-offset positions of that specific pair. Use the tile's size to keep those candidates local, and check them against the board and placed tiles before falling back to other snap targets.
- A line guide can snap either endpoint to a nearby board-edge anchor within the screen-pixel tolerance. Keep this independent of tile snapping. A square starts at a corner and a circle starts at its center, using raw pointer coordinates. Use `guideFromDrag` and `guideShape` to keep the preview and committed outline consistent.
- Derive anchors from the current board with `boardGuideAnchors`. Step by 10 mm from the bounding box's left or top and include the full span. Project each mark to both corresponding sides of the actual outline, including arcs on rounded and circular boards. Keep anchors out of the project JSON. The saved line contains the resulting endpoint coordinates.
- Commit a guide on pointer release and discard cancelled and zero-size gestures. Guide erasing targets the nearest custom outline and uses the same action history as drawing.

## Check changes

- Test clicks near both axes and near a crossing, clicks outside the snap distance, and the same interactions at two zoom levels.
- Shift the grid with numeric inputs and by dragging. Check visual and snap alignment on both axes, cancellation and undo, and the saved position in the editor and viewer.
- With both snapping options on, test a closer guide, a closer tile edge, and a guide target blocked by placed tiles.
- Test crossings between distinct guides and with a tile contact outline. Include diagonal lines, square edges, circular guides, and a crossing that is blocked or outside the snap tolerance.
- Aim directly at a crossing with a tile wider than the snap tolerance, then approach the same crossing with both tile edges just inside their individual snap distances.
- Check the gap between the tile face and the guide for rectangles, rotated polygons, and circles. Include zero and nonzero grout widths, two tiles on opposite sides of a guide, and the inside and outside of a circular guide.
- Draw and remove all three guide shapes. Verify undo and redo, cancellation, independent visibility, and snapping with each guide source hidden.
- Draw a line between edge anchors with tile snapping off. Check both endpoints at two zoom levels, and repeat on a circle and a rounded rectangle. Include a board dimension with a partial 10 mm interval at the far end.
- Save and reopen the project in the editor and viewer. Check the guide geometry and visibility in both.
