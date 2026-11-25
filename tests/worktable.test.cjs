const assert = require('assert').strict;
const Model = require('../geometry.js');

const tile = { id: 'tile', name: 'Tile', shape: 'rectangle', width: 10, height: 10, color: '#445566' };
const piece = (id, x, y = 0) => ({ id, tileId: tile.id, x, y, angle: 0 });
const board = { shape: 'rectangle', width: 100, height: 100, radius: 0 };
const project = { ...Model.blankProject([tile]), board, worktable: 48, seam: 20 };
const table = Model.worktableBounds(board, project.worktable);
const boardPiece = piece('board', board.width / 2 - 5);
const index = new Model.PlacementIndex({ ...project, pieces: [boardPiece] });

const tablePiece = piece('table', table.minX + 5);
assert.ok(index.accepts(index.geometry(tablePiece)), 'Grout clearance is independent across surfaces');
index.add(index.geometry(tablePiece));
assert.ok(!index.accepts(index.geometry(piece('overlap', table.minX + 7))));
assert.ok(!index.accepts(index.geometry(piece('gap', (table.minX + board.width / 2) / 2))));
assert.ok(!index.accepts(index.geometry(piece('off-edge', table.maxX - 4))));

const withSnapping = { ...project, grid: { ...project.grid, snap: true, snapTiles: true } };
const nearTablePiece = piece('move', tablePiece.x + 30.5);
assert.equal(index.snapPlacement(withSnapping, nearTablePiece, 1).piece.x, tablePiece.x + 30);
const customGuide = { shape: 'line', x: table.minX, y: 0, endX: table.maxX, endY: 0 };
const byGuide = piece('guide', table.maxX - 6, 14);
const guidesOnly = { ...withSnapping, grid: { ...withSnapping.grid, snapTiles: false }, guides: [customGuide] };
assert.equal(index.snapPlacement(guidesOnly, byGuide, 2).piece.y, 14);

const saved = { ...project, pieces: [boardPiece, tablePiece] };
assert.deepEqual(Model.readProject(JSON.parse(JSON.stringify(saved))).pieces, saved.pieces);
assert.throws(() => Model.readProject({ ...saved, worktable: -1 }), /invalidProject/);
assert.throws(() => Model.readProject({ ...saved, worktable: undefined }), /invalidPlacements/);
assert.equal(Model.readProject({ ...project, worktable: undefined }).worktable, undefined);

const tall = { ...project, worktableHeight: 160 };
const tallPiece = piece('tall', tablePiece.x, 65);
assert.ok(new Model.PlacementIndex(tall).accepts(Model.pieceGeometry(tile, tallPiece)));
const restoredTall = Model.readProject({ ...tall, pieces: [tallPiece] });
assert.equal(restoredTall.worktableHeight, 160);
assert.deepEqual(restoredTall.pieces, [tallPiece]);
assert.throws(() => Model.readProject({ ...project, pieces: [tallPiece] }), /invalidPlacements/);
assert.throws(() => Model.readProject({ ...tall, worktable: undefined }), /invalidProject/);
assert.throws(() => Model.readProject({ ...tall, worktableHeight: 10001 }), /invalidProject/);

const wide = { ...project, board: { ...board, width: 10000 } };
const wideTable = Model.worktableBounds(wide.board, wide.worktable);
const widePiece = piece('wide', wideTable.maxX - 5);
assert.deepEqual(Model.readProject({ ...wide, pieces: [widePiece] }).pieces, [widePiece]);

console.log('Worktable tests passed.');
