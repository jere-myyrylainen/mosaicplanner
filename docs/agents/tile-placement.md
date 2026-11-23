# Tile placement and editing

The pointer lifecycle starts in `beginPointer` and runs through `updateGesture` and `endPointer` in [editor.js](../../editor.js). [geometry.js](../../geometry.js) provides tile geometry, stroke sampling, and `PlacementIndex`.

## Preserve these behaviors

- Use `PlacementIndex` for board fit, overlap, and grout gap checks. Candidate placement in a stroke must account for both earlier tiles and tiles accepted during that stroke. Use the same placement rules for the preview and commit.
- Use `PlacementIndex.snapToTiles` for tile-to-tile snapping. It projects the moving tile's center onto the contact outline determined by both tile shapes, their rotation, and the grout gap. Use committed pieces as snap targets and the current action's index to validate candidates.
- In combined snapping, intersect the same contact outline with nearby guides before trying single targets. Validate the exact intersection against the board and other pieces. Use the translated selection for validation in a group move.
- Keep freehand rotation and tile dimensions in the stroke spacing calculation. Line and Shape place tiles along the sampled path. Fill uses the snapped seed and then steps by tile dimensions plus grout width, expanding through connected accepted placements.
- When moving a selection, snap the dragged tile's center and apply the same offset to every selected tile. Validate against the board and unselected tiles before committing the group.
- Preserve rectangle selection from empty canvas and Shift-click selection. Tile erase handles both one tile and a swept drag. Keep previews temporary and clean them up on pointer cancellation or lost pointer capture.

## Check changes

- Test an allowed and blocked placement with grout and rotation. Try a freehand drag, a line or outline, and a fill next to existing tiles.
- Check group movement with snapping enabled, movement blocked by another tile, and undo after a drag or erase.
- Check tile snapping against rectangles, rotated tiles, triangles, and circles with zero and nonzero grout. Exercise both sides of the contact line and make sure selected tiles cannot act as snap targets for their own move.
