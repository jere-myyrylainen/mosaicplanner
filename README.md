# Mosaic Planner

Mosaic Planner is an offline browser app for designing mosaics. Open `index.html` in a modern browser. The app requires no installation, server, or internet connection.

To serve the project folder locally, run `python3 -m http.server 8765 --bind 127.0.0.1` in the folder and open `http://127.0.0.1:8765` in your browser.

Use the language menu in the header to switch between **Suomi** (Finnish) and **English**. The browser remembers your choice when local storage is available.

## Your first project

- The Compass Rose example opens on your first visit. Select **New** to start with an empty board and keep your current tile library.
- Choose a rectangular, circular, or rounded rectangular board. Enter board, guide grid, and tile dimensions in millimetres.
- Select **Move guide grid** and drag on the canvas to shift the grid. For precise positioning, use **Horizontal offset** and **Vertical offset** in the guide grid settings. Positive values shift right and down from the default position. The project saves both offsets.
- Use the blue guide tools to draw a line, square, or circle. Drag a line from end to end, a square from a corner, or a circle from its center to its edge. Choose **Remove guide** and click a guide's outline to delete it. Undo works for both drawing and removing guides.
- The top and left rulers show millimetres from the left and top of the board at 10% intervals. Select **Line guide** to see anchor points every 10 mm along the board edges and at the ends of each scale. Either end of a line guide snaps to a nearby anchor.
- Snap to placed tiles, visible grid lines, and visible custom guides. Enable **Snap to placed tiles** or **Snap to guide lines** to use those targets. A tile keeps its rotation and leaves a full grout gap to a placed tile or half a gap to a guide line, which marks the center of the joint.
- Any two eligible edges can snap together when they yield a valid placement. This includes two targets of the same kind and pairs from different sources. Bring the tile close to both edges or aim at a visible line crossing. With a single nearby target, the tile can slide along that edge.
- When continuing a row from a placed tile, a valid tile-and-grid snap keeps the grout gap to the neighbor and aligns the new tile with the grid line.
- Under **Reference images**, add JPG or PNG images beneath the grid and tiles. Adjust the selected image's width and opacity, or select **Move image** and drag on the canvas. Reference images are included in the project JSON file.
- Add rectangular, circular, triangular, diamond, oval, or leaf tile types to the library. Measure a diamond from tip to tip along each axis. A leaf tapers at both ends along its longer axis. Set the base length for a triangle and edit either its height or apex angle. The other field updates automatically. An apex angle of 60° makes the triangle equilateral. Choose a tile type and click to place a tile or drag to draw. The Line and Shape tools place tiles along an outline. The Fill tool places tiles in a connected empty area, using a grid sized to the selected tile.
- With the Freehand tool, set **Rotation** below the board before clicking or dragging. Press **R** or use the rotate button to turn the next tiles by 15°.
- A red, translucent tile preview marks a blocked freehand placement and keeps the tiles and grout underneath visible.
- Use the expand button next to **Tile library** to widen the sidebar and browse the tiles in a grid. The board remains available while you work. Use the same button to switch back to the compact list.
- Choose **Clone tile type** on a library tile to prefill a new tile type with its shape, dimensions, colour, and tags. Edit the copy and save it as a separate tile type.
- Open **Sort and filter** in the tile library to sort tiles by name or filter by size and colour. The browser remembers the sort order.
- The colour filter uses families such as browns and yellows. A shade can belong to more than one family.
- Add comma-separated tags to a tile type, such as `glass, outdoor`. The tag cloud shows how many tile types have each tag. Selecting multiple tags shows tile types that have all of them. Tags are saved with the project.
- Choose **Grout width** and **Grout color** under **Board**. Each tile gets half the width around its edges, so tiles spaced at the minimum gap share a full-width joint. Set the width to zero to hide the grout. Changing the width redraws the grout and updates the minimum gap for subsequent placements. The color is saved with the project, and older files open with gray grout. Fill applies the enabled snapping options to its first tile, then uses the tile dimensions and grout width to place the remaining tiles.
- Use the trash button in the library to remove a tile type. Tiles already placed with that type stay on the board and in the saved file.
- Click a tile to select it. Drag from an empty spot to select multiple tiles, or Shift-click individual tiles to add them to or remove them from the selection. Drag a selected tile to move the entire selection. Choose **Delete selected** to remove those tiles together. You can also rotate a single selected tile.
- Choose the scissors (**Split tile**) or press **X**, then drag a straight line all the way across one placed tile. A cut close to 90° snaps perpendicular to the starting edge, including on a rotated tile. The measurements show how much of that straight edge each piece keeps after the grout gap. The pieces retain their tile type and can be moved, rotated, or split again. Use Undo to restore the original tile.
- Select **Worktable** to open a small surface next to the board. Place a tile there or drag one over from the mosaic. After cutting it, drag the pieces you want back onto the mosaic. Worktable pieces are saved with the project and the mosaic inventory counts pieces on the board. Empty the worktable to close it.
- Use **Copy selected tiles** and **Paste tiles** in the toolbar to duplicate a selection within the current project. Click or tap the board to place the preview. The copies keep their spacing and rotation, and the editor selects them together after placement. Press Esc or choose **Cancel** to leave paste mode.
- Scroll the mouse wheel to zoom. Use the Pan tool or hold Space while dragging to move the view.
- With the Eraser, click to remove a single tile or drag to remove several. Undo restores all tiles removed in one drag.
- Open **Tile counts** at the bottom of the canvas to see the number of placed tiles of each type, including a count of cut pieces. The counts include placed tiles whose types have been removed from the library.

The browser stores your most recent project locally when its settings allow it. **Save** downloads the project and its tile library as a JSON file. Use **Open** to load that file into the editor on any device.

## Read-only viewer

Open [viewer.html](viewer.html) in Safari, including on iOS 12, and choose **Open project** to select a saved `.mosaic.json` file. On iOS, open the viewer from a web server and pick the file from the Files app. The browser opens the file locally. The viewer shows the board, placed tiles with their grout, and any visible grid, custom guides, and reference images. Use **+** to zoom in, swipe to scroll the enlarged board, and use **Fit to view** to see the whole board again.

The viewer shows the mosaic board. Reopen the project in the editor to access any pieces stored on the worktable.

To open a specific plan automatically, put its JSON file on the same web server as the viewer. For a file named `plan.mosaic.json` in the same folder, open `viewer.html?project=plan.mosaic.json`. Anyone who can access the JSON URL can read the project and its embedded reference images.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V, B, L, M, G, H | Select, Freehand, Line, Shape, Fill, Pan |
| E | Eraser |
| X | Split tile |
| Esc | Cancel paste or return to the Select tool |
| Space + drag | Pan the view |
| R | Rotate the freehand tile or a selected tile by 15° |
| Shift + click or drag | Modify the current selection |
| Delete / Backspace | Delete selected tiles |
| Ctrl / ⌘ + C | Copy selected tiles |
| Ctrl / ⌘ + V | Start placing a copy |
| Ctrl / ⌘ + Z | Undo |
| Ctrl / ⌘ + Shift + Z | Redo |
| Ctrl / ⌘ + S | Save to a file |
