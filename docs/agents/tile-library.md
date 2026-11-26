# Tile library

[editor.js](../../editor.js) owns the tile dialog, filtering, sorting, and inventory. [geometry.js](../../geometry.js) defines shapes, triangle conversions, tag normalization, color families, and saved tile validation.

## Preserve these behaviors

- Keep the stable tile type ID when editing. Pieces reference the type through `tileId`. Validate shape and size changes against the board and other pieces. Cut pieces retain their saved outlines and continue to use the linked type's color and name.
- Cloning pre-fills the tile dialog with an editable copy name, shape, dimensions, color, and tags. Saving creates a new active tile type with its own ID and counts toward the library limit. Existing pieces retain their original type.
- Keep circular tile width and height equal. A triangle stores base width and height. The dialog derives either height or apex angle from the other, and old projects may still contain the `equilateral` shape.
- Diamonds use two tip-to-tip dimensions. Ovals and leaves use their full width and height. The leaf tapers to two tips on its longer axis, with horizontal tips when the dimensions are equal. Use the shared tile renderer for library and inventory swatches so they show the actual proportions.
- Archiving a type removes it from the active library while keeping placed pieces and their type definition in the project. Count placed pieces in inventory even if their type is archived, and show how many pieces of each type are cut.
- The mosaic inventory counts pieces on the main board. Show the number of worktable pieces separately in the editor's status bar.
- Show the current mosaic count next to the inventory icon. Give the disclosure a localized accessible name and keep its per-type breakdown in the panel.
- Build library filters from active types. A color can belong to multiple families. Tag filtering requires all selected tags and uses normalized keys while retaining their display labels. Name sorting uses the active locale. The browser stores the selected sort order separately from the project.
- In the compact list, show a swatch, name, tag pills, and dimensions at the right end of each row. Use a shared swatch scale across the library and enlarge exceptionally small silhouettes to keep them legible. Show the active drawing tile's larger preview, full dimensions, tags, and library actions below the list, including when filters hide its row. Keep the expanded grid’s actions on the cards. Below the library, set the grout for new pieces of the active type or for the single placed piece currently selected. The larger preview uses the effective grout as its edge stroke. The reset action restores the project defaults for the current target.

## Check changes

- Add and edit a triangle using both height and apex angle. Verify that an edit which makes existing pieces invalid leaves the old type intact.
- Clone a tile already in use. Verify the prefilled values, saving with a new ID, cancellation, and undo. Check the clone button in the compact details and expanded grid.
- Create a diamond, an oval, and leaves in both horizontal and vertical proportions. Check their swatches and reopen their dimensions in the edit dialog.
- Archive an in-use type and verify counts, rendering, and reopening. For filter or layout edits, test combined filters and compact and expanded library views.
- Compare swatches for different sizes, filter the list, and verify that their scale and the selected details remain consistent. Test long names, tags, and dimensions at narrow widths.
