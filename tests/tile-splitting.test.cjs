const assert = require('assert').strict;
const Model = require('../geometry.js');

const tile = { id: 'tile', name: 'Tile', shape: 'rectangle', width: 20, height: 12, color: '#445566' };
const original = { id: 'original', tileId: tile.id, x: 0, y: 0, angle: 30 };
const start = { x: -16, y: 1 };
const end = { x: 16, y: 1 };
const project = Model.blankProject([tile]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, a + ' differs from ' + b);
const area = points => points.reduce((sum, { x, y }, i) => {
  const next = points[(i + 1) % points.length];
  return sum + x * next.y - next.x * y;
}, 0) / 2;

const { fragments } = Model.splitPiece(tile, original, start, end);
const pieces = fragments.map((piece, index) => ({ ...piece, id: 'fragment-' + index }));
const [lower, upper] = pieces.map(piece => Model.pieceGeometry(tile, piece));
close(lower.minY, 1);
close(upper.maxY, 1);
close(area(lower.points) + area(upper.points), tile.width * tile.height);

for (const seam of [0, 2, 50]) {
  const saved = JSON.parse(JSON.stringify({ ...project, seam, pieces }));
  const restored = Model.readProject(saved);
  assert.deepEqual(restored.pieces, pieces);
  const index = new Model.PlacementIndex({ ...restored, pieces: [pieces[0]] });
  assert.equal(index.accepts(index.geometry(pieces[1])), seam === 0);
  assert.ok(index.accepts(index.geometry({ ...pieces[1], y: pieces[1].y - seam })));

  saved.pieces[0].outline.reverse();
  assert.throws(() => Model.readProject(saved), /invalidProject/);
}

assert.equal(Model.splitPiece(tile, original, start, { x: 0, y: 1 }), undefined);
assert.deepEqual(Model.readProject({ ...project, pieces: [original] }).pieces, [original]);

const index = new Model.PlacementIndex({ ...project, pieces: [original] });
const world = (x, y) => ({ x: x * Math.sqrt(3) / 2 - y / 2, y: x / 2 + y * Math.sqrt(3) / 2 });
const near = world(-3.25, -6.5);
const edge = index.nearestSplitStart(near, 1);
assert.equal(edge.fraction, undefined);
close(edge.along, 6.75);

const locked = index.splitLine(near, world(-1.5, 12), edge);
assert.ok(locked.locked);
close(locked.end.x, world(-3.25, 12).x);
close(locked.end.y, world(-3.25, 12).y);
assert.equal(Model.splitPiece(tile, original, locked.start, locked.end).fragments.length, 2);

const far = world(-3.25, -16);
const lockedFromOutside = index.splitLine(far, world(-1.5, 12));
assert.ok(lockedFromOutside.locked);
close(lockedFromOutside.edge.along, edge.along);

const diagonalEnd = world(8, 12);
const diagonal = index.splitLine(near, diagonalEnd, edge);
assert.equal(diagonal.locked, undefined);
assert.equal(diagonal.end, diagonalEnd);
close(diagonal.edge.along, 6.75);

for (const fraction of [.25, .5, .75]) {
  const x = 20 * fraction - 10;
  const start = world(x + .5, -6.5);
  const snapped = index.nearestSplitStart(start, 1);
  assert.equal(snapped.fraction, fraction);
  close(snapped.along, 20 * fraction);
  const cut = index.splitLine(start, world(x + .5, 9), snapped, 1);
  assert.ok(cut.locked);
  close(cut.end.x, world(x, 9).x);
  close(cut.end.y, world(x, 9).y);
}
assert.equal(index.nearestSplitStart(world(-8, -6.5), 8).fraction, undefined);
const distantQuarter = index.splitLine(world(-4.5, -16), world(-3, 12), undefined, 1);
assert.ok(distantQuarter.locked);
assert.equal(distantQuarter.edge.fraction, .25);
const angledQuarter = index.splitLine(world(-9.5, -16), world(2, 9), undefined, 1);
assert.equal(angledQuarter.locked, undefined);
assert.equal(angledQuarter.edge.fraction, .25);
assert.equal(Model.splitPiece(tile, original, angledQuarter.start, angledQuarter.end).fragments.length, 2);

const cornerStart = world(-9.65, -6.35);
const cornerEdge = index.nearestSplitStart(cornerStart, 1);
assert.equal(cornerEdge.fraction, 0);
const cornerCut = index.splitLine(cornerStart, world(9.7, 5.6), cornerEdge, 1);
assert.equal(cornerCut.locked, undefined);
close(cornerCut.start.x, world(-10, -6).x);
close(cornerCut.start.y, world(-10, -6).y);
close(cornerCut.endAnchor.x, world(10, 6).x);
close(cornerCut.endAnchor.y, world(10, 6).y);
const diagonalParts = Model.splitPiece(tile, original, cornerCut.start, cornerCut.end).fragments;
assert.ok(diagonalParts.every(part => part.outline.length === 3));
close(area(diagonalParts[0].outline) + area(diagonalParts[1].outline), tile.width * tile.height);
assert.equal(Model.readProject({ ...project, pieces: diagonalParts.map((part, i) => ({ ...part, id: String(i) })) }).pieces.length, 2);

for (const x of [-5, 0, 5]) {
  const cut = index.splitLine(cornerStart, world(x + .3, 5.6), cornerEdge, 1);
  assert.equal(cut.locked, undefined);
  close(cut.endAnchor.x, world(x, 6).x);
  close(cut.endAnchor.y, world(x, 6).y);
}

const rightAngleStart = world(-3.8, -6.3);
const rightAngleEdge = index.nearestSplitStart(rightAngleStart, 1.1);
assert.equal(rightAngleEdge.fraction, undefined);
const conflict = index.splitLine(rightAngleStart, world(-4.8, 5.5), rightAngleEdge, 1.1);
assert.ok(conflict.locked);
close(conflict.endAnchor.x, world(-3.8, 6).x);
close(conflict.endAnchor.y, world(-3.8, 6).y);

const nearCorner = index.splitLine(cornerStart, world(-9.7, 5.5), cornerEdge, 1);
assert.ok(nearCorner.locked);
assert.equal(nearCorner.edge.fraction, undefined);
close(nearCorner.endAnchor.x, world(-9.65, 6).x);
close(nearCorner.endAnchor.y, world(-9.65, 6).y);
assert.equal(index.splitLine(cornerStart, cornerStart, cornerEdge, 1).endAnchor, undefined);

const curvePiece = { ...original, x: 17, y: -22 };
const curvePoint = (x, y) => {
  const point = world(x, y);
  return { x: curvePiece.x + point.x, y: curvePiece.y + point.y };
};
const checkPoint = (point, expected) => {
  close(point.x, expected.x);
  close(point.y, expected.y);
};
for (const [shape, width, height] of [['leaf', 34, 16], ['leaf', 16, 34], ['oval', 30, 18], ['circle', 28, 28]]) {
  const curved = { ...tile, shape, width, height };
  const curveIndex = new Model.PlacementIndex({ ...project, tiles: [curved], pieces: [curvePiece] });
  const hover = curveIndex.nearestSplitStart(curvePiece, 2);
  assert.equal(hover.marks.length, 4);
  assert.equal(hover.point, undefined);
  for (const [x, y] of [[width / 2, 0], [0, height / 2]]) {
    const start = curvePoint(1.04 * x, 1.04 * y);
    const end = curvePoint(-.94 * x, -.94 * y);
    const target = curveIndex.nearestSplitStart(start, 2);
    checkPoint(target.point, curvePoint(x, y));
    const cut = curveIndex.splitLine(start, end, target, 2);
    assert.ok(cut.locked);
    checkPoint(cut.endAnchor, curvePoint(-x, -y));
    const parts = Model.splitPiece(curved, curvePiece, cut.start, cut.end).fragments;
    close(area(parts[0].outline), area(parts[1].outline));
    const reopened = Model.readProject({
      ...project, tiles: [curved], pieces: parts.map((part, i) => ({ ...part, id: 'curve-' + i }))
    });
    assert.equal(reopened.pieces.length, 2);
  }
}

const round = { ...tile, shape: 'circle', width: 40, height: 40 };
const roundIndex = new Model.PlacementIndex({ ...project, tiles: [round], pieces: [curvePiece] });
const rim = curvePoint(16, 12);
const finish = curvePoint(-14.6, -11.6);
for (const from of [curvePoint(16.4, 12.3), curvePoint(28, 21)]) {
  const target = roundIndex.nearestSplitStart(from, 2);
  if (target) checkPoint(target.point, rim);
  const diameter = roundIndex.splitLine(from, finish, target, 2);
  assert.ok(diameter.locked && diameter.endAnchor);
  close((diameter.curveTarget.point.x + diameter.endAnchor.x) / 2, curvePiece.x);
  close((diameter.curveTarget.point.y + diameter.endAnchor.y) / 2, curvePiece.y);
  const parts = Model.splitPiece(round, curvePiece, diameter.start, diameter.end).fragments;
  close(area(parts[0].outline), area(parts[1].outline));
}

console.log('Tile splitting tests passed.');
