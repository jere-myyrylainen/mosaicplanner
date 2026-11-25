# Mosaic Planner

Mosaic Planner is an offline browser app for designing mosaics. Open `index.html` in a modern browser. The app requires no installation, server, or internet connection.

To serve the project folder locally, run `python3 -m http.server 8765 --bind 127.0.0.1` in the folder and open `http://127.0.0.1:8765` in your browser.

Use the language menu in the header to switch between **Suomi** (Finnish) and **English**. The browser remembers your choice when local storage is available.

## Your first project

- The Compass Rose example opens on your first visit. Choose **File → New** to name the project and size a rectangular, circular, or rounded rectangular board. Creating a project keeps your current tile library. Change the board later under **Project → Board settings**.
- Open **Project → Guide grid settings** and choose **Move guide grid**, then drag on the canvas to shift the grid. For precise positioning, enter **Horizontal offset** and **Vertical offset** in millimetres. Positive values shift right and down from the default position. The project saves both offsets.
- Select **Custom guides** in the left toolbar, then choose a line, square, or circle above the canvas. Drag a line from end to end, a square from a corner, or a circle from its center to its edge. Choose **Remove guide** and click a guide's outline to delete it. Undo works for both drawing and removing guides. Toggle their visibility under **View**.
- The top and left rulers show millimetres from the left and top of the board at 10% intervals. Select **Line guide** to see anchor points every 10 mm along the board edges and at the ends of each scale. Either end of a line guide snaps to a nearby anchor.
- Open the magnet icon in the bottom bar to enable **Snap to placed tiles** or **Snap to guide lines**. A tile keeps its rotation and leaves a full grout gap to a placed tile or half a gap to a visible grid line or guide, which marks the center of the joint.
- Any two eligible edges can snap together when they yield a valid placement. This includes two targets of the same kind and pairs from different sources. Bring the tile close to both edges or aim at a visible line crossing. With a single nearby target, the tile can slide along that edge.
- When continuing a row from a placed tile, a valid tile-and-grid snap keeps the grout gap to the neighbor and aligns the new tile with the grid line.
- Choose **Add image** in the left toolbar to import JPG or PNG images beneath the grid and tiles. Use **Reference images** on the right to adjust the selected image's width and opacity, or select **Move image** and drag on the canvas. Reference images are included in the project JSON file.
- Add rectangular, circular, triangular, diamond, oval, or leaf tile types to the library. Measure a diamond from tip to tip along each axis. A leaf tapers at both ends along its longer axis. Set the base length for a triangle and edit either its height or apex angle. The other field updates automatically. An apex angle of 60° makes the triangle equilateral. Choose a tile type and click to place a tile or drag to draw. The Line and Shape tools place tiles along an outline. The Fill tool places tiles in a connected empty area, using a grid sized to the selected tile.
- With the Freehand tool, set **Rotation** above the board before clicking or dragging. Press **R** or use the rotate button to turn the next tiles by 15°.
- A red, translucent tile preview marks a blocked freehand placement and keeps the tiles and grout underneath visible.
- Use the expand button next to **Tile library** to widen the sidebar and browse the tiles in a grid. The board remains available while you work. Use the same button to switch back to the compact list.
- Choose **Clone tile type** on a library tile to prefill a new tile type with its shape, dimensions, colour, and tags. Edit the copy and save it as a separate tile type.
- Open **Sort and filter** in the tile library to sort tiles by name or filter by size and colour. The browser remembers the sort order.
- The colour filter uses families such as browns and yellows. A shade can belong to more than one family.
- Add comma-separated tags to a tile type, such as `glass, outdoor`. The tag cloud shows how many tile types have each tag. Selecting multiple tags shows tile types that have all of them. Tags are saved with the project.
- Choose **Grout width** and **Grout color** below the tile library on the right. Each tile gets half the width around its edges, so tiles spaced at the minimum gap share a full-width joint. Set the width to zero to hide the grout. Changing the width redraws the grout and updates the minimum gap for subsequent placements. The color is saved with the project, and older files open with gray grout. Fill applies the enabled snapping options to its first tile, then uses the tile dimensions and grout width to place the remaining tiles.
- Use the trash button in the library to remove a tile type. Tiles already placed with that type stay on the board and in the saved file.
- Click a tile to select it. Drag from an empty spot to select multiple tiles, or Shift-click individual tiles to add them to or remove them from the selection. Drag a selected tile to move the entire selection. Press **R** or use the rotate button to turn the selection by 15° around its center. Enter a positive or negative angle under **Rotate by** to turn a group by a specific amount. Choose **Delete selected** to remove the tiles together.
- Choose the scissors (**Split tile**) or press **X**, then drag a straight line across a tile. Both endpoints snap to corners and the quarter, midpoint, and three-quarter marks. A cut close to 90° locks perpendicular to the starting edge, including on rotated tiles. When this lock is active, the endpoint snaps where that perpendicular line meets the boundary. The measurements show how much of the starting edge each piece keeps. The two pieces touch along the cut, and you can move them apart to leave space for grout. Use Undo to restore the original tile.
- Circles, ovals, and leaves show four snap points along their symmetry axes. On a leaf, drag from tip to tip or between the middle points of the two arcs. On a circle, drag from the rim toward the center to lock onto a diameter in that direction.
- Use the **Worktable** button above the canvas to show or hide the panel beside the tile library. The worktable uses the full height of the panel. On narrow screens it opens directly below the board. Place, cut, and edit tiles there with the usual tools, and drag tiles between the two surfaces. Use the worktable's own **Fit to view** when it contains pieces from a taller window. Hiding the panel keeps its pieces in the project, separate from the mosaic inventory.
- Use **Copy selected tiles** and **Paste tiles** in the toolbar to duplicate a selection within the current project. Click or tap the board to place the preview. The copies keep their spacing and rotation, and the editor selects them together after placement. Press Esc or choose **Cancel** to leave paste mode.
- Scroll the mouse wheel to zoom. Use the Pan tool or hold Space while dragging to move the view.
- With the Eraser, click to remove a single tile or drag to remove several. Undo restores all tiles removed in one drag.
- Open the tile-count icon and number in the bottom bar to see the number of placed tiles of each type, including a count of cut pieces. The counts include placed tiles whose types have been removed from the library.

The browser stores your most recent project locally when its settings allow it. **File → Save** downloads the project and its tile library as a JSON file. Use **File → Open** to load that file into the editor on any device.

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
| R | Rotate the freehand tile or the current selection by 15° |
| Shift + click or drag | Modify the current selection |
| Delete / Backspace | Delete selected tiles |
| Ctrl / ⌘ + C | Copy selected tiles |
| Ctrl / ⌘ + V | Start placing a copy |
| Ctrl / ⌘ + Z | Undo |
| Ctrl / ⌘ + Shift + Z | Redo |
| Ctrl / ⌘ + S | Save to a file |
