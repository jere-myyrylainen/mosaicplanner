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

console.log('Tile splitting tests passed.');
