const assert = require('assert').strict;
const Model = require('../geometry.js');

const tile = { id: 'tile', name: 'Tile', shape: 'rectangle', width: 20, height: 12, color: '#445566' };
const original = { id: 'original', tileId: tile.id, x: 0, y: 0, angle: 30 };
const start = { x: -16, y: 1 };
const end = { x: 16, y: 1 };
const project = Model.blankProject([tile]);

for (const seam of [0, 2]) {
  const { fragments } = Model.splitPiece(tile, original, start, end, seam);
  const pieces = fragments.map((piece, index) => ({ ...piece, id: 'fragment-' + index }));
  const [lower, upper] = pieces.map(piece => Model.pieceGeometry(tile, piece));
  assert.ok(Math.abs(lower.minY - (1 + seam / 2)) < 1e-7);
  assert.ok(Math.abs(upper.maxY - (1 - seam / 2)) < 1e-7);

  // Keeping the library shape for either fragment would make these two pieces overlap.
  const saved = JSON.parse(JSON.stringify({ ...project, seam, pieces }));
  const restored = Model.readProject(saved);
  assert.deepEqual(restored.pieces, pieces);
  const index = new Model.PlacementIndex({ ...restored, pieces: [pieces[0]] });
  assert.ok(index.accepts(index.geometry(pieces[1])));

  saved.pieces[0].outline.reverse();
  assert.throws(() => Model.readProject(saved), /invalidProject/);
}

assert.equal(Model.splitPiece(tile, original, start, { x: 0, y: 1 }, 0), undefined);
assert.deepEqual(Model.splitPiece(tile, original, start, end, 50), {});
assert.deepEqual(Model.readProject({ ...project, pieces: [original] }).pieces, [original]);

const index = new Model.PlacementIndex({ ...project, pieces: [original] });
const world = (x, y) => ({ x: x * Math.sqrt(3) / 2 - y / 2, y: x / 2 + y * Math.sqrt(3) / 2 });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, a + ' differs from ' + b);
const near = world(-3.25, -6.5);
const edge = index.nearestSplitEdge(near, 1);
const dimensions = Model.splitEdgeLengths(edge, 2);
close(dimensions.before, 5.75);
close(dimensions.after, 12.25);

const locked = index.splitLine(near, world(-1.5, 12), edge);
assert.ok(locked.locked);
close(locked.end.x, world(-3.25, 12).x);
close(locked.end.y, world(-3.25, 12).y);
assert.equal(Model.splitPiece(tile, original, locked.start, locked.end, 2).fragments.length, 2);

const far = world(-3.25, -16);
const lockedFromOutside = index.splitLine(far, world(-1.5, 12));
assert.ok(lockedFromOutside.locked);
close(lockedFromOutside.edge.along, edge.along);

const diagonalEnd = world(8, 12);
const diagonal = index.splitLine(near, diagonalEnd, edge);
assert.equal(diagonal.locked, undefined);
assert.equal(diagonal.end, diagonalEnd);
const diagonalLengths = Model.splitEdgeLengths(edge, 2, diagonal.start, diagonal.end);
close(diagonalLengths.before, 6.75 - Math.hypot(11.25, 18) / 18);
close(diagonalLengths.after, 13.25 - Math.hypot(11.25, 18) / 18);

console.log('Tile splitting tests passed.');
