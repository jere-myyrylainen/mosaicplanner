const assert = require('assert').strict;
const Model = require('../geometry.js');

const square = { id: 'square', name: 'Square', shape: 'rectangle', width: 10, height: 10, color: '#315764' };
const narrow = { ...square, id: 'narrow', name: 'Narrow', width: 8 };
const circle = { ...square, id: 'circle', name: 'Circle', shape: 'circle' };

function tile(x, y, angle = 0, tileId = square.id) {
  return { x, y, angle, tileId };
}

function project(pieces, seam = 2) {
  const result = Model.blankProject([square, narrow, circle]);
  result.grid.snapTiles = true;
  result.seam = seam;
  result.pieces = pieces.map((piece, index) => ({ ...piece, id: 'placed-' + index }));
  return result;
}

function expectPosition(project, desired, x, y, label) {
  const index = new Model.PlacementIndex(project);
  const candidate = index.snapPlacement(project, desired, 3);
  assert(index.accepts(candidate), label + ' must fit with the configured grout');
  assert(Math.hypot(candidate.piece.x - x, candidate.piece.y - y) < 1e-7,
    label + ' expected (' + x + ', ' + y + '), got (' + candidate.piece.x + ', ' + candidate.piece.y + ')');
}

for (const seam of [2, 0, 4]) {
  const pitch = square.width + seam;
  const row = project([tile(0, 0), tile(pitch, 0)], seam);
  expectPosition(row, tile(0, pitch), 0, pitch, 'Exactly below the left tile');
  expectPosition(row, tile(pitch, pitch), pitch, pitch, 'Exactly below the right tile');
  expectPosition(row, tile(.4, pitch - .5), 0, pitch, 'Close to alignment below the left tile');
  expectPosition(row, tile(pitch + .4, pitch - .5), pitch, pitch, 'Close to alignment below the right tile');
  expectPosition(row, tile(pitch / 2, pitch - .5), pitch / 2, pitch, 'Slide along the row between aligned positions');
}

const row = project([tile(0, 0), tile(12, 0)]);
expectPosition(row, tile(-.6, 11.5, 0, narrow.id), -1, 12, 'Align the left edges of different-width tiles');
row.grid.snap = true;
expectPosition(row, tile(.4, 11.5), 0, 12, 'Align below one tile with grid and tile snapping enabled');

const angle = 30;
const radians = angle * Math.PI / 180;
function rotatedTile(x, y) {
  return tile(x * Math.cos(radians) - y * Math.sin(radians),
    x * Math.sin(radians) + y * Math.cos(radians), angle);
}
const rotatedRow = project([rotatedTile(0, 0), rotatedTile(12, 0)]);
const aligned = rotatedTile(0, 12);
expectPosition(rotatedRow, rotatedTile(.4, 11.5), aligned.x, aligned.y, 'Same edge alignment on a rotated row');

const corner = project([tile(0, 12), tile(12, 0)]);
expectPosition(corner, tile(11.4, 11.5), 12, 12, 'Independent contacts still snap inside an L corner');
const rounds = project([tile(-6, 0, 0, circle.id), tile(6, 0, 0, circle.id)]);
expectPosition(rounds, tile(.6, 10.7, 0, circle.id), 0, Math.sqrt(108), 'Two curved contacts still combine');
const betweenRounds = project([tile(-12, 0, 0, circle.id), tile(12, 0, 0, circle.id)]);
expectPosition(betweenRounds, tile(.5, .2, 0, circle.id), 0, 0, 'Opposing curved contacts can pin a tile');

const newTypes = ['diamond', 'oval', 'leaf'].map(shape => ({
  ...square, id: shape, name: shape, shape, width: 20, height: 10
}));
for (const seam of [0, 2]) {
  const besideLeaf = project([tile(0, 0, 90, 'leaf')], seam);
  besideLeaf.tiles.push(...newTypes);
  const atGuide = Model.blankProject(newTypes);
  atGuide.seam = seam;
  atGuide.grid = { ...atGuide.grid, snap: true, visible: false };
  atGuide.guides = [{ shape: 'line', x: 20, y: -80, endX: 20, endY: 80 }];
  for (const { shape } of newTypes) {
    const x = 15 + seam;
    expectPosition(besideLeaf, tile(x + .35, 0, 0, shape), x, 0, shape + ' snaps beside a rotated leaf');
    const at = 10 - seam / 2;
    expectPosition(atGuide, tile(at + .35, 12, 0, shape), at, 12, shape + ' snaps its tip to a guide');
  }
}

const betweenOvals = project([tile(-11, 0, 0, 'oval'), tile(11, 0, 0, 'oval')]);
betweenOvals.tiles.push(...newTypes);
const ovalIndex = new Model.PlacementIndex(betweenOvals);
const ovalContact = ovalIndex.snapPlacement(betweenOvals, tile(.3, 10, 0, 'oval'), 3);
assert(ovalIndex.accepts(ovalContact), 'Two oval contacts leave room for the moving tile');
assert(Math.abs(ovalContact.piece.x) < 1e-7, 'Two symmetric oval contacts center the moving tile');
assert(!ovalIndex.accepts(ovalIndex.geometry({ ...ovalContact.piece, y: ovalContact.piece.y - .01 })),
  'Moving closer to the two ovals would reduce the grout gap');

console.log('Tile snapping tests passed.');
