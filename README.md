# Mosaic Planner

Mosaic Planner is an offline browser app for designing mosaics. Open `index.html` in a modern browser. The app requires no installation, server, or internet connection.

To serve the project folder locally, run `python3 -m http.server 8765 --bind 127.0.0.1` in the folder and open `http://127.0.0.1:8765` in your browser.

Use the language menu in the header to switch between **Suomi** (Finnish) and **English**. The browser remembers your choice when local storage is available.

## Your first project

- The Compass Rose example opens on your first visit. Select **New** to start with an empty board and keep your current tile library.
- Choose a rectangular, circular, or rounded rectangular board. Enter board, guide grid, and tile dimensions in millimetres.
- Under **Reference images**, add JPG or PNG images beneath the grid and tiles. Adjust the selected image's width and opacity, or select **Move image** and drag on the canvas. Reference images are included in the project JSON file.
- Add rectangular, circular, or triangular tile types to the library. Set the base length for a triangle and edit either its height or apex angle. The other field updates automatically. An apex angle of 60° makes the triangle equilateral. Choose a tile type and click to place a tile or drag to draw. The Line and Shape tools place tiles along an outline. The Fill tool places tiles in a connected empty area, using a grid sized to the selected tile.
- With the Freehand tool, set **Rotation** below the board before clicking or dragging. Press **R** or use the rotate button to turn the next tiles by 15°.
- A red, translucent tile preview marks a blocked freehand placement and keeps the tiles and grout underneath visible.
- Resize the tile library by dragging its left edge or by tabbing to the resize handle and using the arrow keys. The browser remembers the width. Double-click the handle to restore the default.
- Open **Sort and filter** in the tile library to sort tiles by name or filter by size and colour. The browser remembers the sort order.
- The colour filter uses families such as browns and yellows. A shade can belong to more than one family.
- Add comma-separated tags to a tile type, such as `glass, outdoor`. The tag cloud shows how many tile types have each tag. Selecting multiple tags shows tile types that have all of them. Tags are saved with the project.
- Choose **Grout width** and **Grout color** under **Board**. Each tile gets half the width around its edges, so tiles spaced at the minimum gap share a full-width joint. Set the width to zero to hide the grout. Changing the width redraws the grout and updates the minimum gap for subsequent placements. The color is saved with the project, and older files open with gray grout. With snapping enabled, Fill snaps its first tile to the guide grid, then uses the tile dimensions and grout width to place the remaining tiles.
- Use the trash button in the library to remove a tile type. Tiles already placed with that type stay on the board and in the saved file.
- Click a tile to select it. Drag from an empty spot to select multiple tiles, or Shift-click individual tiles to add them to or remove them from the selection. Drag a selected tile to move the entire selection. Choose **Delete selected** to remove those tiles together. You can also rotate a single selected tile.
- Scroll the mouse wheel to zoom. Use the Pan tool or hold Space while dragging to move the view.
- With the Eraser, click to remove a single tile or drag to remove several. Undo restores all tiles removed in one drag.
- Open **Tile counts** at the bottom of the canvas to see the number of placed tiles of each type. The counts include placed tiles whose types have been removed from the library.

The browser stores your most recent project locally when its settings allow it. **Save** downloads the project and its tile library as a JSON file. Use **Open** to load that file into the editor on any device.

## Read-only viewer

Open [viewer.html](viewer.html) in Safari, including on iOS 12, and choose **Open project** to select a saved `.mosaic.json` file. On iOS, open the viewer from a web server and pick the file from the Files app. The browser opens the file locally. The viewer shows the board, placed tiles with their grout, visible guide grid and reference images. Use **+** to zoom in, swipe to scroll the enlarged board, and use **Fit to view** to see the whole board again.

To open a specific plan automatically, put its JSON file on the same web server as the viewer. For a file named `plan.mosaic.json` in the same folder, open `viewer.html?project=plan.mosaic.json`. Anyone who can access the JSON URL can read the project and its embedded reference images.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V, B, L, M, G, H | Select, Freehand, Line, Shape, Fill, Pan |
| E | Eraser |
| Esc | Return to the Select tool |
| Space + drag | Pan the view |
| R | Rotate the freehand tile or a selected tile by 15° |
| Shift + click or drag | Modify the current selection |
| Delete / Backspace | Delete selected tiles |
| Ctrl / ⌘ + Z | Undo |
| Ctrl / ⌘ + Shift + Z | Redo |
| Ctrl / ⌘ + S | Save to a file |
