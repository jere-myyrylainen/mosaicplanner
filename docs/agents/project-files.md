# Project files and storage

[geometry.js](../../geometry.js) defines the version 1 snapshot in `blankProject` and validates and normalizes imports in `readProject`. [editor.js](../../editor.js) manages history and JSON file input and output. [project-storage.js](../../project-storage.js) manages browser autosave.

## Preserve these behaviors

- Keep the `.mosaic.json` file self-contained. When adding an optional field, provide a default for older files and validate it before using it in either entry point. Use the same reader for editor import, autosave restoration, and the viewer.
- Preserve existing piece locations on import. The reader validates fit, references to tile types, and physical overlap with a zero grout gap so saved projects remain readable after a grout gap increase.
- Save diamonds, ovals, and leaves with the `diamond`, `oval`, and `leaf` shape values. Their width and height are the full dimensions in millimetres before rotation.
- A split piece keeps its original `tileId` and stores an optional convex `outline` in local millimetres before rotation. Validate the ordered vertices and use them for fit and overlap checks. Pieces without an outline use the library shape and dimensions.
- The optional numeric `worktable` field records the square table's side length in millimetres. Both surfaces use the same piece list and coordinate space. Derive the table bounds from the board dimensions and validate that each piece fits on its surface. Files without the field open with only the mosaic board.
- Use immutable snapshots for history and persistence. Keep zoom, active tools, selected pieces, and library filters as editor state. The language and library order are separate browser preferences.
- Keep copied pieces and the paste preview in the editor session. Opening or starting a project clears the clipboard. Only committed copies enter the project snapshot and the undo history.
- Keep the current localStorage key and IndexedDB fallback compatible with previous saves. Preserve the behavior that newer saves take precedence when asynchronous writes finish and that a failed restore surfaces the load error.

## Check changes

- Round-trip a project through JSON in Node with `blankProject` and `readProject`. Include an older snapshot lacking the new field and an invalid value for that field.
- Test browser refresh and export followed by import. Check that undo restores the prior project after opening or creating a project. Use a distinct local origin or a test profile when exercising autosave with fixtures.
