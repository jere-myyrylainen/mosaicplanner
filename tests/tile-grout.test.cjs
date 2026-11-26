const assert = require('node:assert/strict');
const Model = require('../geometry.js');

const tile = { id: 'square', name: 'Square', shape: 'rectangle', width: 10, height: 10, color: '#315764' };
const piece = (id, x, y = 0) => ({ id, tileId: tile.id, x, y, angle: 0 });
const project = Model.blankProject([{ ...tile, seam: 8, seamColor: '#16A04B' }]);
project.grid.snapTiles = true;
project.pieces = [{ ...piece('wide-grout', 0), seam: 10, seamColor: '#B60505' }];

const index = new Model.PlacementIndex(project);
const zeroGrout = { ...piece('candidate', 14.5), seam: 0 };
const candidate = index.snapPlacement(project, zeroGrout, 1);
assert.equal(candidate.piece.x, 15, 'Use half the fixed grout width when the moving piece has zero grout');
assert(index.accepts(candidate));
assert(!index.accepts(Model.pieceGeometry(tile, zeroGrout)), 'Reject an undersized gap with raw geometry too');

const inherited = index.snapPlacement(project, piece('inherited', 15.5), 1);
assert.equal(inherited.piece.x, 16, 'Use the project width for a piece without an override');
assert(index.accepts(inherited));

const guides = {
  ...project, pieces: [], grid: { ...project.grid, snap: true, visible: false, snapTiles: false },
  guides: [{ shape: 'line', x: 30, y: -50, endX: 30, endY: 50 }]
};
const guideIndex = new Model.PlacementIndex(guides);
const nearGuide = { ...piece('guide', 20.8), seam: 8 };
assert.equal(guideIndex.snapPlacement(guides, nearGuide, 1).piece.x, 21, 'Use only the moving piece’s grout at a guide');

const split = Model.splitPiece(tile, project.pieces[0], { x: 0, y: -6 }, { x: 0, y: 6 });
assert.equal(split.fragments.length, 2);
for (const fragment of split.fragments) {
  assert.equal(fragment.seam, 10);
  assert.equal(fragment.seamColor, '#b60505');
}

project.pieces.push({ ...zeroGrout, x: 10 }, piece('legacy', -10));
const saved = JSON.parse(JSON.stringify(project));
const restored = Model.readProject(saved);
assert.equal(restored.tiles[0].seam, 8);
assert.equal(restored.tiles[0].seamColor, '#16a04b');
assert.equal(restored.pieces[0].seamColor, '#b60505');
assert.equal(restored.pieces[1].seam, 0);
assert.equal(restored.pieces[2].seam, undefined);
assert.equal(Model.pieceSeam(restored.pieces[2], restored), 2);
assert.throws(() => Model.readProject({ ...saved, pieces: [{ ...saved.pieces[0], seam: -1 }] }), /invalidProject/);
assert.throws(() => Model.readProject({ ...saved, tiles: [{ ...tile, seamColor: 'red' }] }), /invalidProject/);
assert.throws(() => Model.readProject({ ...saved, pieces: [saved.pieces[0], { ...zeroGrout, x: 9 }] }), /invalidPlacements/);

console.log('Tile grout tests passed.');
