# Tile placement and editing

The pointer lifecycle starts in `beginPointer` and runs through `updateGesture` and `endPointer` in [editor.js](../../editor.js). [geometry.js](../../geometry.js) provides tile geometry, stroke sampling, and `PlacementIndex`.

## Preserve these behaviors

- Use `PlacementIndex` for board fit, overlap, and grout gap checks. Candidate placement in a stroke must account for both earlier tiles and tiles accepted during that stroke. Use the same placement rules for the preview and commit.
- Use `tileVertices` for polygon outlines in both rendering and geometry. Ovals and leaves use a convex sampled outline for fit, contact, and erasing. Reserve facing-edge endpoint alignment for tiles with straight sides.
- Use `PlacementIndex.snapPlacement` for tile-to-tile snapping. It projects the moving tile's center onto the contact outline determined by both tile shapes, their rotation, and the grout gap. Use committed pieces as snap targets and the current action's index to validate candidates.
- For combined snapping, intersect the contact outlines of two distinct placed tiles or of a placed tile and a grid or custom guide edge. Contacts with the same outward direction slide together. Opposing contacts can hold a tile between neighbors. When nearby tiles compete, offer exact alignment of the ends of two facing edges within a short lateral tolerance, with the full grout gap. Validate candidates against the board and other pieces, using the translated selection for group moves.
- Keep freehand rotation and tile dimensions in the stroke spacing calculation. Line and Shape place tiles along the sampled path. Fill uses the snapped seed and then steps by tile dimensions plus grout width, expanding through connected accepted placements.
- When moving a selection, compute the anchor tile's center from the snap targets and apply the same offset to every selected tile. Validate against the board and unselected tiles before committing the group.
- Copy captures the selected pieces in the editor clipboard. Paste previews one translation of their outlines and snaps the tile nearest the group's center. Keep the copied rotations and internal spacing. Check each copy against the board and existing tiles with the current grout gap. Commit the entire group with new IDs as one action, then select the copies. Escape or Cancel discards the preview and leaves the selection available.
- Split draws a straight line across one placed tile. Require both endpoints at or beyond its boundary and reject a line that fully crosses multiple tiles. Clip the tile outline back by half the current grout width on each side of the line. Sample a circular outline when cutting it. Preview the two resulting shapes, then replace the original with two individually editable pieces in one commit.
- Tile gestures work on the mosaic and the worktable. Each piece must fit completely on one surface. Fill stays on the surface where it starts, and pieces can be dragged between surfaces.
- Preserve rectangle selection from empty canvas and Shift-click selection. Tile erase handles both one tile and a swept drag. Keep previews temporary and clean them up on pointer cancellation or lost pointer capture.

## Check changes

- Test an allowed and blocked placement with grout and rotation. Try a freehand drag, a line or outline, and a fill next to existing tiles.
- Check group movement with snapping enabled, movement blocked by another tile, and undo after a drag or erase.
- Copy and paste a single tile and a mixed selection with rotated tiles. Verify preview, group snapping, rejection when any tile collides or crosses the board edge, cancellation, repeated paste, and undo and redo of the whole group. Test the toolbar, keyboard shortcuts, and touch placement.
- Split a rotated tile and a round tile at zero and nonzero grout widths. Check incomplete and multi-tile cuts, cancellation, a cut too close to an edge for the current grout width, and undo and redo. Move, rotate, copy, erase, and split a resulting piece again.
- Run `node tests/tile-splitting.test.cjs` to check the seam and saved outlines of a rotated split.
- Place and split a tile on the worktable. Move one fragment to the mosaic and check both counts. Verify that a drop between surfaces leaves the original piece in place and that the table closes when empty.
- Run `node tests/worktable.test.cjs` to check fit, snapping, and opening saved pieces on both surfaces.
- Check tile snapping against rectangles, rotated tiles, triangles, and circles with zero and nonzero grout. Exercise both sides of the contact line and make sure selected tiles cannot act as snap targets for their own move.
- Check rotated diamonds, ovals, and leaves against tile edges and guides. Erase across a tapered tip and verify that a stroke through the empty corner of the tile's bounding box leaves the tile in place.
- Place and move a tile in a corner formed by two neighboring tiles. Verify the grout gap to each neighbor, fallback to a single target outside the combined range, and rejection when another tile blocks the corner.
- Run `node tests/tile-snapping.test.cjs` to verify alignment directly under either tile in a straight row, sliding between aligned positions, and genuine corners.
