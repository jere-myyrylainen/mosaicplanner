# Mosaic Planner

Mosaic Planner is an offline mosaic editor written in plain JavaScript, HTML, CSS, and SVG. Open `index.html` to edit projects or `viewer.html` to view them. The app runs directly from these files and can also be served by a static web server.

## Run and verify

- For local HTTP testing, run `python3 -m http.server 8765 --bind 127.0.0.1` from the repository root and open `http://127.0.0.1:8765/`.
- Check each changed script with `node --check path/to/script.js`. For model checks, load `require('./geometry.js')` from Node at the repository root.
- Run `node tests/tile-snapping.test.cjs` after changing tile snapping.
- Exercise changed behavior in the browser through the relevant editor or viewer controls. Use the feature checks below to choose cases that cover the change. If a browser check is unavailable, report what was verified and what remains unverified.

## Working conventions

- Read the relevant feature guides before changing their code. Update the corresponding guide when a change affects behavior, saved data, or a compatibility requirement.
- Keep the runtime dependency-free and preserve direct opening of the editor and its local file workflow. Reuse the plain scripts and existing SVG layers.
- Keep reusable geometry and project validation in `geometry.js` and shared SVG rendering in `board-renderer.js`. Keep editor interactions in `editor.js`. Scripts loaded by `viewer.html`, including shared scripts, target Safari on iOS 12.
- Use millimetres for project dimensions and coordinates, degrees for tile rotation, and CSS pixels for pointer tolerances. Convert coordinates at the editor boundary.
- Commit each completed editor action through `commit(next)`. Create new snapshots and copy modified collections or objects so undo, redo, and autosave see consistent project state.
- Supply Finnish and English for new interface text, including accessible names and feedback. Keep user-supplied names and tags independent of the interface language.

## Feature guides

| Area | Guide |
| --- | --- |
| Guide grid, custom guides, and snapping | [Guides and snapping](docs/agents/guides.md) |
| Board shapes, SVG layers, and grout | [Board and grout](docs/agents/board-and-grout.md) |
| Drawing, filling, selection, movement, and erasing | [Tile placement and editing](docs/agents/tile-placement.md) |
| Tile types, filters, and inventory | [Tile library](docs/agents/tile-library.md) |
| Image import, positioning, and rendering | [Reference images](docs/agents/reference-images.md) |
| Project format, import, export, and autosave | [Project files and storage](docs/agents/project-files.md) |
| Read-only rendering, file opening, and zoom | [Viewer](docs/agents/viewer.md) |
| Language selection, labels, and formatting | [Localization](docs/agents/localization.md) |
