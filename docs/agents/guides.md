# Guides and snapping

The guide controls live in [index.html](../../index.html) and the gestures in [editor.js](../../editor.js). [geometry.js](../../geometry.js) defines guide geometry, snapping, and saved data validation. [board-renderer.js](../../board-renderer.js) renders guides in the editor and viewer.

## Preserve these behaviors

- Keep `grid.visible` and `grid.guidesVisible` independent. `grid.snap` controls snapping to both visible sources. Saved projects use a top-level `guides` array. Files predating custom guides default to an empty array with custom guide visibility enabled.
- Keep snapping to placed tiles independent of guide visibility and guide snapping. `grid.snapTiles` defaults to false in older projects. Use `PlacementIndex.snapPlacement` to prioritize the nearest valid combined position within the screen-pixel tolerance, then use the existing single-target behavior. Prefer tile contact at equal distance.
- Keep the grid pattern and its snapping origin aligned at minus half the grid spacing. Project onto one horizontal or vertical line at a time. A vertical line preserves Y and a horizontal line preserves X, including near a crossing.
- Combine different visible custom guides and custom guides with nearby grid lines. Pure grid intersections retain single-axis snapping. Work with finite segments for lines and square edges and full circumferences for circular guides. Convert the eight-CSS-pixel tolerance into board units when the editor view changes.
- A line guide can snap either endpoint to a nearby board-edge anchor within the screen-pixel tolerance. Keep this independent of tile snapping. A square starts at a corner and a circle starts at its center, using raw pointer coordinates. Use `guideFromDrag` and `guideShape` to keep the preview and committed outline consistent.
- Derive anchors from the current board with `boardGuideAnchors`. Step by 10 mm from the bounding box's left or top and include the full span. Project each mark to both corresponding sides of the actual outline, including arcs on rounded and circular boards. Keep anchors out of the project JSON. The saved line contains the resulting endpoint coordinates.
- Commit a guide on pointer release and discard cancelled and zero-size gestures. Guide erasing targets the nearest custom outline and uses the same action history as drawing.

## Check changes

- Test clicks near both axes and near a crossing, clicks outside the snap distance, and the same interactions at two zoom levels.
- With both snapping options on, test a closer guide, a closer tile edge, and a guide target blocked by placed tiles.
- Test crossings between distinct guides and with a tile contact outline. Include diagonal lines, square edges, circular guides, and a crossing that is blocked or outside the snap tolerance.
- Draw and remove all three guide shapes. Verify undo and redo, cancellation, independent visibility, and snapping with each guide source hidden.
- Draw a line between edge anchors with tile snapping off. Check both endpoints at two zoom levels, and repeat on a circle and a rounded rectangle. Include a board dimension with a partial 10 mm interval at the far end.
- Save and reopen the project in the editor and viewer. Check the guide geometry and visibility in both.
