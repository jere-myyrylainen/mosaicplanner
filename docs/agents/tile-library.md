# Tile library

[editor.js](../../editor.js) owns the tile dialog, filtering, sorting, and inventory. [geometry.js](../../geometry.js) defines shapes, triangle conversions, tag normalization, color families, and saved tile validation.

## Preserve these behaviors

- Keep the stable tile type ID when editing. Pieces reference the type through `tileId`. Validate shape and size changes against all existing pieces of that type before committing.
- Keep circular tile width and height equal. A triangle stores base width and height. The dialog derives either height or apex angle from the other, and old projects may still contain the `equilateral` shape.
- Archiving a type removes it from the active library while keeping placed pieces and their type definition in the project. Count placed pieces in inventory even if their type is archived.
- Build library filters from active types. A color can belong to multiple families. Tag filtering requires all selected tags and uses normalized keys while retaining their display labels. Name sorting uses the active locale. The browser stores the selected sort order separately from the project.

## Check changes

- Add and edit a triangle using both height and apex angle. Verify that an edit which makes existing pieces invalid leaves the old type intact.
- Archive an in-use type and verify counts, rendering, and reopening. For filter or layout edits, test combined filters and compact and expanded library views.
