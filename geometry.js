(function () {
  'use strict';

  const EPSILON = 1e-7;
  const MAX_PIECES = 12000;
  const MAX_TYPES = 200;
  const MAX_STROKE = 2500;
  const CELL_SIZE = 32;
  const MAX_CELLS_PER_QUERY = 64;
  const TAU = 2 * Math.PI;
  const boardShapes = ['rectangle', 'circle', 'rounded'];
  const tileShapes = ['rectangle', 'circle', 'triangle'];

  function angleInDegrees(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function pointInBoard(board, point) {
    const x = Math.abs(point.x);
    const y = Math.abs(point.y);
    const halfWidth = board.width / 2;
    const halfHeight = board.height / 2;
    if (board.shape === 'circle') return Math.hypot(x, y) <= halfWidth + EPSILON;
    const radius = board.shape === 'rounded' ? board.radius : 0;
    return Math.hypot(
      Math.max(0, x - halfWidth + radius),
      Math.max(0, y - halfHeight + radius)
    ) <= radius + EPSILON;
  }

  function pieceGeometry(tile, piece) {
    const halfWidth = tile.width / 2;
    const halfHeight = tile.height / 2;
    if (tile.shape === 'circle') {
      return {
        piece, radius: halfWidth, minX: piece.x - halfWidth, maxX: piece.x + halfWidth,
        minY: piece.y - halfHeight, maxY: piece.y + halfHeight
      };
    }

    const angle = piece.angle * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let vertices;
    if (tile.shape === 'triangle') {
      vertices = [{ x: 0, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }];
    } else {
      vertices = [
        { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }
      ];
    }

    const points = vertices.map(point => ({
      x: piece.x + point.x * cos - point.y * sin,
      y: piece.y + point.x * sin + point.y * cos
    }));
    return {
      piece,
      points,
      minX: Math.min(...points.map(point => point.x)),
      minY: Math.min(...points.map(point => point.y)),
      maxX: Math.max(...points.map(point => point.x)),
      maxY: Math.max(...points.map(point => point.y))
    };
  }

  function fitsBoard(board, geometry) {
    const { piece, points, radius } = geometry;
    if (!radius) return points.every(point => pointInBoard(board, point));
    if (radius > Math.min(board.width, board.height) / 2 + EPSILON) return false;
    const inset = {
      ...board,
      width: board.width - 2 * radius,
      height: board.height - 2 * radius,
      radius: Math.max(0, board.radius - radius)
    };
    return pointInBoard(inset, piece);
  }

  function minSegmentDistanceSquared(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const t = Math.max(0, Math.min(1, projection));
    return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
  }

  function pointInPolygon(point, points) {
    return points.every((start, i) => {
      const end = points[(i + 1) % points.length];
      return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x) >= 0;
    });
  }

  function overlapOnAxes(points, other) {
    return points.every((start, i) => {
      const end = points[(i + 1) % points.length];
      const dx = end.y - start.y;
      const dy = start.x - end.x;
      const project = point => point.x * dx + point.y * dy;
      const first = points.map(project);
      const second = other.map(project);
      const tolerance = EPSILON * Math.hypot(dx, dy);
      return Math.max(...first) > Math.min(...second) + tolerance &&
        Math.max(...second) > Math.min(...first) + tolerance;
    });
  }

  function edgesWithinDistance(points, other, distance) {
    return points.some(point => other.some((start, i) =>
      minSegmentDistanceSquared(point, start, other[(i + 1) % other.length]) < distance ** 2
    ));
  }

  function tooClose(first, second, gap) {
    const distance = Math.max(0, gap - EPSILON);
    if (first.maxX + distance <= second.minX + EPSILON || second.maxX + distance <= first.minX + EPSILON ||
        first.maxY + distance <= second.minY + EPSILON || second.maxY + distance <= first.minY + EPSILON) {
      return false;
    }
    if (first.radius && second.radius) {
      return Math.hypot(first.piece.x - second.piece.x, first.piece.y - second.piece.y) <
        first.radius + second.radius + gap - EPSILON;
    }
    if (first.radius || second.radius) {
      const circle = first.radius ? first : second;
      const polygon = first.radius ? second : first;
      return pointInPolygon(circle.piece, polygon.points) ||
        edgesWithinDistance([circle.piece], polygon.points, circle.radius + gap - EPSILON);
    }
    if (overlapOnAxes(first.points, second.points) && overlapOnAxes(second.points, first.points)) return true;
    return distance > 0 &&
      (edgesWithinDistance(first.points, second.points, distance) ||
        edgesWithinDistance(second.points, first.points, distance));
  }

  function cellsInBounds(geometry, margin = 0) {
    const x = Math.floor((geometry.minX - margin) / CELL_SIZE);
    const y = Math.floor((geometry.minY - margin) / CELL_SIZE);
    const width = Math.floor((geometry.maxX + margin) / CELL_SIZE) - x + 1;
    const height = Math.floor((geometry.maxY + margin) / CELL_SIZE) - y + 1;
    if (width * height > MAX_CELLS_PER_QUERY) return null;
    const keys = [];
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) keys.push(column + '/' + row);
    }
    return keys;
  }

  class PlacementIndex {
    constructor(project, excludedId) {
      this.board = project.board;
      this.gap = project.seam;
      this.tileTypes = new Map(project.tiles.map(tile => [tile.id, tile]));
      this.cells = new Map();
      this.geometries = [];
      this.largeGeometries = [];
      for (const piece of project.pieces) {
        if (piece.id !== excludedId) this.add(this.geometry(piece));
      }
    }

    geometry(piece) {
      return pieceGeometry(this.tileTypes.get(piece.tileId), piece);
    }

    add(geometry) {
      this.geometries.push(geometry);
      const keys = cellsInBounds(geometry);
      if (!keys) {
        this.largeGeometries.push(geometry);
        return;
      }
      for (const key of keys) {
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(geometry);
      }
    }

    accepts(geometry) {
      if (!fitsBoard(this.board, geometry)) return false;
      const keys = cellsInBounds(geometry, this.gap);
      const collides = other => tooClose(geometry, other, this.gap);
      if (!keys) return !this.geometries.some(collides);
      if (this.largeGeometries.some(collides)) return false;
      const neighbors = new Set();
      for (const key of keys) {
        const cell = this.cells.get(key);
        if (cell) for (const other of cell) neighbors.add(other);
      }
      for (const other of neighbors) {
        if (collides(other)) return false;
      }
      return true;
    }
  }

  function sampleSegment(start, end, spacing, firstDistance = 0, limit = MAX_STROKE) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const points = [];
    let distance = firstDistance;

    while (distance <= length + EPSILON && points.length < limit) {
      const fraction = length > 0 ? Math.min(distance / length, 1) : 0;
      points.push({ x: start.x + fraction * dx, y: start.y + fraction * dy });
      distance += spacing;
    }
    return { points, nextDistance: Math.max(0, distance - length), limited: distance < length };
  }

  function lineSpacing(tile, gap, start, end) {
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const length = Math.hypot(dx, dy);
    if (!length || tile.shape === 'circle') return tile.width + gap;
    return Math.min((tile.width + gap) * length / dx, (tile.height + gap) * length / dy);
  }

  function outlinePath(shape, start, end) {
    if (shape === 'rectangle' || start.x === end.x || start.y === end.y) {
      return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }, start];
    }
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    const segments = Math.max(32, Math.min(2048, Math.ceil(Math.max(radiusX, radiusY) * TAU / 3)));
    return Array.from({ length: segments + 1 }, (_, i) => ({
      x: centerX + radiusX * Math.cos(i * TAU / segments),
      y: centerY + radiusY * Math.sin(i * TAU / segments)
    }));
  }

  function sampleOutline(tile, gap, path) {
    const points = [];
    const spacing = Math.max(tile.width, tile.height) + gap;
    let nextDistance = 0;
    for (let i = 1; i < path.length; i++) {
      const segment = sampleSegment(path[i - 1], path[i], spacing, nextDistance, MAX_STROKE - points.length);
      points.push(...segment.points);
      nextDistance = segment.nextDistance;
      if (points.length >= MAX_STROKE) break;
    }
    return points;
  }

  function blankProject(tiles) {
    return {
      version: 1,
      name: 'Nimetön mosaiikki',
      board: { shape: 'circle', width: 200, height: 200, radius: 18 },
      seam: 2,
      grid: { visible: true, size: 12, weight: 0.2, snap: false },
      tiles,
      pieces: []
    };
  }

  function demoProject() {
    const project = blankProject([
      { id: 'spruce', name: 'Kuusenvihreä', color: '#285b52' },
      { id: 'jade', name: 'Salvia', color: '#75a18a' },
      { id: 'sand', name: 'Hiekka', color: '#e5ca9e' },
      { id: 'clay', name: 'Terrakotta', color: '#bb684e' },
      { id: 'ivory', name: 'Luonnonvalkoinen', color: '#f9f0d9' }
    ].map(tile => ({ ...tile, shape: 'rectangle', width: 10, height: 10 })));
    project.name = 'Kompassiruusu';

    const rows = [
      '       H       ',
      '    HHIKIHH    ',
      '   HIIIKIIIH   ',
      '  HIISHKHSIIH  ',
      ' HIISKKKKKSIIH ',
      ' HIHKKSSSKKHIH ',
      ' IISKSHTHSKSII ',
      'HKKKKSTHTSKKKKH',
      ' IISKSHTHSKSII ',
      ' HIHKKSSSKKHIH ',
      ' HIISKKKKKSIIH ',
      '  HIISHKHSIIH  ',
      '   HIIIKIIIH   ',
      '    HHIKIHH    ',
      '       H       '
    ];
    const design = { K: 'spruce', S: 'jade', H: 'sand', T: 'clay', I: 'ivory' };

    rows.forEach((row, y) => {
      Array.from(row).forEach((symbol, x) => {
        const tileId = design[symbol];
        const center = { x: (x - 7) * 12, y: (y - 7) * 12 };
        if (!tileId || Math.hypot(Math.abs(center.x) + 5, Math.abs(center.y) + 5) > 100) return;
        project.pieces.push({ id: 'demo-' + x + '-' + y, tileId, ...center, angle: 0 });
      });
    });
    return project;
  }

  function validNumber(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
  }

  function validText(value, maxLength) {
    return typeof value === 'string' && Boolean(value.trim()) && value.length <= maxLength;
  }

  function readProject(value) {
    const error = 'Tiedosto ei ole kelvollinen Mosaic Planner -työ.';
    if (!value || value.version !== 1 || !validText(value.name, 80)) throw new Error(error);
    const { board, grid, tiles, pieces, seam } = value;
    if (!board || !boardShapes.includes(board.shape) ||
        !validNumber(board.width, 1, 10000) || !validNumber(board.height, 1, 10000) ||
        !validNumber(board.radius, 0, Math.min(board.width, board.height) / 2) ||
        (board.shape === 'circle' && board.width !== board.height) ||
        !validNumber(seam, 0, 100) || !grid || typeof grid.visible !== 'boolean' ||
        typeof grid.snap !== 'boolean' || !validNumber(grid.size, .5, 1000) ||
        !validNumber(grid.weight, .1, 10)) throw new Error(error);
    if (!Array.isArray(tiles) || !tiles.length || tiles.length > MAX_TYPES ||
        !Array.isArray(pieces) || pieces.length > MAX_PIECES) throw new Error(error);

    const tileTypes = new Map();
    for (const tile of tiles) {
      if (!tile || !validText(tile.id, 100) || tileTypes.has(tile.id) || !validText(tile.name, 60) ||
          !tileShapes.includes(tile.shape) || !/^#[0-9a-f]{6}$/i.test(tile.color) ||
          !validNumber(tile.width, .5, 10000) || !validNumber(tile.height, .5, 10000) ||
          (tile.shape === 'circle' && tile.width !== tile.height)) throw new Error(error);
      tileTypes.set(tile.id, {
        id: tile.id, name: tile.name.trim(), shape: tile.shape, color: tile.color,
        width: tile.width, height: tile.height
      });
    }

    const ids = new Set();
    const restored = blankProject([...tileTypes.values()]);
    restored.name = value.name.trim();
    restored.board = { shape: board.shape, width: board.width, height: board.height, radius: board.radius };
    restored.grid = { visible: grid.visible, size: grid.size, weight: grid.weight, snap: grid.snap };
    restored.seam = seam;
    const index = new PlacementIndex({ ...restored, seam: 0 });
    for (const piece of pieces) {
      if (!piece || !validText(piece.id, 100) || ids.has(piece.id) || !tileTypes.has(piece.tileId) ||
          !validNumber(piece.x, -5000, 5000) || !validNumber(piece.y, -5000, 5000) ||
          !validNumber(piece.angle, -360, 360)) throw new Error(error);
      const clean = { id: piece.id, tileId: piece.tileId, x: piece.x, y: piece.y, angle: angleInDegrees(piece.angle) };
      const geometry = index.geometry(clean);
      if (!index.accepts(geometry)) throw new Error('Työssä on päällekkäisiä tai alustan ulkopuolisia paloja.');
      index.add(geometry);
      ids.add(piece.id);
      restored.pieces.push(clean);
    }
    return restored;
  }

  const model = {
    MAX_PIECES, MAX_TYPES, MAX_STROKE, PlacementIndex, angleInDegrees, blankProject, demoProject,
    fitsBoard, lineSpacing, outlinePath, pieceGeometry, pointInBoard, readProject, sampleOutline,
    sampleSegment, validNumber
  };

  if (typeof module === 'object') module.exports = model;
  else window.MosaicGeometry = model;
}());
