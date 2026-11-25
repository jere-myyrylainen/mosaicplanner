(function () {
  'use strict';

  const EPSILON = 1e-7;
  const MAX_PIECES = 12000;
  const MAX_TYPES = 200;
  const MAX_STROKE = 2500;
  const MAX_PROJECT_FILE = 32 * 1024 * 1024;
  const MAX_GUIDES = 500;
  const GUIDE_LIMIT = 50000;
  const GRID_OFFSET_LIMIT = 50000;
  const MAX_REFERENCES = 8;
  const MAX_REFERENCE_FILE = 12 * 1024 * 1024;
  const MAX_REFERENCE_DATA = 24 * 1024 * 1024;
  const REFERENCE_POSITION_LIMIT = 50000;
  const CELL_SIZE = 32;
  const MAX_CELLS_PER_QUERY = 64;
  const TAU = 2 * Math.PI;
  const SPLIT_SNAP_SLOPE = Math.tan(10 * Math.PI / 180);
  const SPLIT_FRACTIONS = Object.freeze([0, 1 / 4, 1 / 2, 3 / 4, 1]);
  const CURVE_SEGMENTS = 64;
  const MAX_OUTLINE_VERTICES = 128;
  const DEFAULT_SEAM_COLOR = '#a9a49b';
  const MIN_TRIANGLE_HEIGHT = .1;
  const boardShapes = ['rectangle', 'circle', 'rounded'];
  const tileShapes = ['rectangle', 'circle', 'triangle', 'equilateral', 'diamond', 'oval', 'leaf'];
  const ovalOutline = Array.from({ length: CURVE_SEGMENTS }, (_, index) => {
    const angle = index * TAU / CURVE_SEGMENTS;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  // Taper the oval toward both ends while keeping the leaf tips slightly rounded.
  const leafOutline = ovalOutline.map(({ x, y }) => ({
    x, y: y * Math.sqrt(.08 + .92 * y * y)
  }));

  function angleInDegrees(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function triangleHeight(side) {
    return side * Math.sqrt(3) / 2;
  }

  function triangleHeightFromAngle(base, angle) {
    if (!(base > 0 && angle > 0 && angle < 180)) return NaN;
    if (angle === 60) return triangleHeight(base);
    return base / (2 * Math.tan(angle * Math.PI / 360));
  }

  function triangleApexAngle(base, height) {
    if (!(base > 0 && height > 0)) return NaN;
    if (height === triangleHeight(base)) return 60;
    return Math.atan2(base / 2, height) * 360 / Math.PI;
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

  function worktableBounds(board, size) {
    if (size === undefined) return;
    const gap = Math.max(12, Math.min(board.width, board.height) / 10);
    const minX = board.width / 2 + gap;
    return { minX, maxX: minX + size, minY: -size / 2, maxY: size / 2 };
  }

  function isOnWorktable(table, point) {
    // Pick a surface by the center's X coordinate before checking its outer edges.
    return Boolean(table && point.x >= table.minX - EPSILON);
  }

  function boardGuideAnchors(board) {
    const { width, height } = board;
    const radius = board.shape === 'circle' ? width / 2 : board.shape === 'rounded' ? board.radius : 0;
    const anchors = [];

    function addSide(span, depth, pointAt) {
      function addMark(distance) {
        const offset = distance - span / 2;
        const corner = Math.max(0, Math.abs(offset) - (span / 2 - radius));
        const edge = depth / 2 - radius + Math.sqrt(Math.max(0, radius ** 2 - corner ** 2));
        anchors.push(pointAt(offset, edge));
      }

      for (let distance = 0; distance < span; distance += 10) addMark(distance);
      addMark(span);
    }

    addSide(width, height, (x, edge) => ({ x, y: -edge }));
    addSide(width, height, (x, edge) => ({ x, y: edge }));
    addSide(height, width, (y, edge) => ({ x: -edge, y }));
    addSide(height, width, (y, edge) => ({ x: edge, y }));
    return anchors;
  }

  function nearestGuideAnchor(anchors, point, limit) {
    let bestDistance = limit ** 2;
    let nearest;
    for (const anchor of anchors) {
      const distance = (anchor.x - point.x) ** 2 + (anchor.y - point.y) ** 2;
      if (distance <= bestDistance) {
        nearest = anchor;
        bestDistance = distance;
      }
    }
    return nearest;
  }

  function tileVertices(tile) {
    const halfWidth = tile.width / 2;
    const halfHeight = tile.height / 2;
    if (tile.shape === 'triangle' || tile.shape === 'equilateral') {
      return [{ x: 0, y: -halfHeight }, { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }];
    }
    if (tile.shape === 'diamond') {
      return [{ x: 0, y: -halfHeight }, { x: halfWidth, y: 0 }, { x: 0, y: halfHeight }, { x: -halfWidth, y: 0 }];
    }
    if (tile.shape === 'oval' || tile.shape === 'leaf') {
      const outline = tile.shape === 'oval' ? ovalOutline : leafOutline;
      // The leaf's two tapered tips follow its longer dimension.
      if (tile.shape === 'leaf' && halfHeight > halfWidth) {
        return outline.map(({ x, y }) => ({ x: -y * halfWidth, y: x * halfHeight }));
      }
      return outline.map(({ x, y }) => ({ x: x * halfWidth, y: y * halfHeight }));
    }
    return [
      { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }
    ];
  }

  function pieceGeometry(tile, piece) {
    if (!piece.outline && tile.shape === 'circle') {
      const halfWidth = tile.width / 2;
      const halfHeight = tile.height / 2;
      return {
        piece, radius: halfWidth, minX: piece.x - halfWidth, maxX: piece.x + halfWidth,
        minY: piece.y - halfHeight, maxY: piece.y + halfHeight
      };
    }

    const angle = piece.angle * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const points = (piece.outline || tileVertices(tile)).map(point => ({
      x: piece.x + point.x * cos - point.y * sin,
      y: piece.y + point.x * sin + point.y * cos
    }));
    return {
      piece,
      points,
      curved: !piece.outline && (tile.shape === 'oval' || tile.shape === 'leaf'),
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

  function segmentFraction(point, start, dx, dy) {
    if (!dx && !dy) return 0;
    const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    return Math.max(0, Math.min(1, projection));
  }

  function minSegmentDistanceSquared(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const t = segmentFraction(point, start, dx, dy);
    return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
  }

  function readGuide(guide) {
    const validCoordinate = value => validNumber(value, -GUIDE_LIMIT, GUIDE_LIMIT);
    if (!guide || !validCoordinate(guide.x) || !validCoordinate(guide.y)) return;
    const { shape, x, y } = guide;
    if (shape === 'line' && validCoordinate(guide.endX) && validCoordinate(guide.endY) &&
        Math.hypot(guide.endX - x, guide.endY - y) > EPSILON) {
      return { shape, x, y, endX: guide.endX, endY: guide.endY };
    }
    if (shape === 'square' && validNumber(guide.size, EPSILON, GUIDE_LIMIT * 2) &&
        validCoordinate(x + guide.size) && validCoordinate(y + guide.size)) {
      return { shape, x, y, size: guide.size };
    }
    if (shape === 'circle' && validNumber(guide.radius, EPSILON, GUIDE_LIMIT * 2)) {
      return { shape, x, y, radius: guide.radius };
    }
  }

  function guideFromDrag(shape, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (shape === 'line') return readGuide({ shape, x: start.x, y: start.y, endX: end.x, endY: end.y });
    if (shape === 'circle') return readGuide({ shape, x: start.x, y: start.y, radius: Math.hypot(dx, dy) });
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return readGuide({
      shape, size, x: start.x - (dx < 0 ? size : 0), y: start.y - (dy < 0 ? size : 0)
    });
  }

  function projectOntoGuide(point, guide) {
    const { x, y } = guide;
    if (guide.shape === 'line') {
      const dx = guide.endX - x;
      const dy = guide.endY - y;
      const fraction = segmentFraction(point, guide, dx, dy);
      return { x: x + fraction * dx, y: y + fraction * dy };
    }
    if (guide.shape === 'circle') {
      const dx = point.x - x;
      const dy = point.y - y;
      const distance = Math.hypot(dx, dy);
      if (!distance) return { x: x + guide.radius, y };
      return { x: x + dx / distance * guide.radius, y: y + dy / distance * guide.radius };
    }
    const right = x + guide.size;
    const bottom = y + guide.size;
    const clampedX = Math.max(x, Math.min(right, point.x));
    const clampedY = Math.max(y, Math.min(bottom, point.y));
    if (clampedX !== point.x || clampedY !== point.y) return { x: clampedX, y: clampedY };

    const edgeX = point.x - x <= right - point.x ? x : right;
    const edgeY = point.y - y <= bottom - point.y ? y : bottom;
    if (Math.abs(point.x - edgeX) <= Math.abs(point.y - edgeY)) return { x: edgeX, y: point.y };
    return { x: point.x, y: edgeY };
  }

  function nearestGuide(guides, point, limit) {
    let nearest;
    let bestDistance = limit;
    // Prefer the most recently drawn guide when two guides are equally close.
    for (let index = guides.length - 1; index >= 0; index--) {
      const candidate = projectOntoGuide(point, guides[index]);
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance > bestDistance || (nearest && distance === bestDistance)) continue;
      nearest = { index, point: candidate };
      bestDistance = distance;
    }
    return nearest;
  }

  function sideOfEdge(start, end, point) {
    return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  }

  function linePart(x, y, endX, endY) {
    return { shape: 'line', x, y, endX, endY };
  }

  function guideParts(guide) {
    if (guide.shape !== 'square') return [guide];
    const { x, y, size } = guide;
    const right = x + size;
    const bottom = y + size;
    return [linePart(x, y, right, y), linePart(right, y, right, bottom),
      linePart(right, bottom, x, bottom), linePart(x, bottom, x, y)];
  }

  function gridOrigin({ size, offsetX = 0, offsetY = 0 }) {
    return { x: offsetX - size / 2, y: offsetY - size / 2 };
  }

  function gridLine(coordinate, size, halfSpan, origin) {
    const first = Math.ceil((-halfSpan - origin) / size);
    const last = Math.floor((halfSpan - origin) / size);
    if (first > last) return;
    const index = Math.max(first, Math.min(last, Math.round((coordinate - origin) / size)));
    return origin + index * size;
  }

  function* segmentIntersections(first, second) {
    const ax = first.endX - first.x;
    const ay = first.endY - first.y;
    const bx = second.endX - second.x;
    const by = second.endY - second.y;
    const determinant = ax * by - ay * bx;
    if (Math.abs(determinant) <= Number.EPSILON * (Math.abs(ax * by) + Math.abs(ay * bx))) return;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const a = (dx * by - dy * bx) / determinant;
    const b = (dx * ay - dy * ax) / determinant;
    const aTolerance = EPSILON / Math.hypot(ax, ay);
    const bTolerance = EPSILON / Math.hypot(bx, by);
    if (a >= -aTolerance && a <= 1 + aTolerance && b >= -bTolerance && b <= 1 + bTolerance) {
      yield { x: first.x + a * ax, y: first.y + a * ay };
    }
  }

  function* segmentCircleIntersections(line, circle) {
    const length = Math.hypot(line.endX - line.x, line.endY - line.y);
    if (!length) return;
    const ux = (line.endX - line.x) / length;
    const uy = (line.endY - line.y) / length;
    const dx = circle.x - line.x;
    const dy = circle.y - line.y;
    const offset = Math.abs(dx * uy - dy * ux);
    if (offset > circle.radius + EPSILON) return;
    const center = dx * ux + dy * uy;
    const halfChord = Math.sqrt(Math.max(0, (circle.radius - offset) * (circle.radius + offset)));
    for (const distance of [center - halfChord, center + halfChord]) {
      if (distance >= -EPSILON && distance <= length + EPSILON) {
        yield { x: line.x + distance * ux, y: line.y + distance * uy };
      }
    }
  }

  function* circleIntersections(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    const difference = first.radius - second.radius;
    if (!distance || distance > first.radius + second.radius + EPSILON ||
        distance < Math.abs(difference) - EPSILON) return;
    const along = (distance ** 2 + difference * (first.radius + second.radius)) / (2 * distance);
    const halfChord = Math.sqrt(Math.max(0, (first.radius - along) * (first.radius + along)));
    const ux = dx / distance;
    const uy = dy / distance;
    for (const side of [-halfChord, halfChord]) {
      yield { x: first.x + ux * along - uy * side, y: first.y + uy * along + ux * side };
    }
  }

  function intersections(first, second) {
    if (first.shape === 'line' && second.shape === 'line') return segmentIntersections(first, second);
    if (first.shape === 'line') return segmentCircleIntersections(first, second);
    if (second.shape === 'line') return segmentCircleIntersections(second, first);
    return circleIntersections(first, second);
  }

  function* sharedContactPoints(part, other, origin, contact) {
    const projected = projectOntoGuide(origin, other);
    const onOther = projectOntoGuide(contact, other);
    const onPart = projectOntoGuide(projected, part);
    if (Math.hypot(contact.x - onOther.x, contact.y - onOther.y) <= EPSILON) yield contact;
    if (Math.hypot(projected.x - onPart.x, projected.y - onPart.y) <= EPSILON) yield projected;
    yield* intersections(part, other);
  }

  function* contactCrossings(first, second, { origin, intersect = intersections } = {}) {
    if (!second.length) return;
    for (const part of first) {
      const projected = origin && projectOntoGuide(origin, part);
      for (const other of second) {
        const a = part.bounds;
        const b = other.bounds;
        if (a && b && (a.maxX + EPSILON < b.minX || b.maxX + EPSILON < a.minX ||
                       a.maxY + EPSILON < b.minY || b.maxY + EPSILON < a.minY)) continue;
        const points = origin ? sharedContactPoints(part, other, origin, projected) : intersect(part, other);
        for (const point of points) {
          if (onContactPart(part, point) && onContactPart(other, point)) yield point;
        }
      }
    }
  }

  function* guideCrossings({ custom, lattice }, cross = contactCrossings) {
    const earlier = lattice.slice();
    for (const parts of custom) {
      yield* cross(parts, earlier);
      earlier.push(...parts);
    }
  }

  function* alignedGuideCrossings({ board, grid }, guides, piece, limit, includeGridOnly) {
    yield* guideCrossings(guides);
    if (!includeGridOnly) return;

    // Keep room to slide along a single line even when the grid is dense.
    const range = Math.min(limit, grid.size / 4);
    for (const vertical of guides.lattice) {
      if (vertical.gridX === undefined || Math.abs(vertical.x - piece.x) > range) continue;
      for (const horizontal of guides.lattice) {
        if (horizontal.gridY === undefined || Math.abs(horizontal.y - piece.y) > range) continue;
        if (pointInBoard(board, { x: vertical.gridX, y: horizontal.gridY })) {
          yield { x: vertical.x, y: horizontal.y };
        }
      }
    }
  }

  function* tileGuideCrossings(tiles, guides, origin) {
    for (const tile of tiles) yield* contactCrossings(tile.parts, guides, { origin });
  }

  function* gridTileCrossings(tiles, gridEdges) {
    for (const tile of tiles) {
      for (const part of tile.parts) {
        for (const edge of gridEdges) {
          if (part.shape === 'circle') {
            const distance = edge.x === edge.endX ? Math.abs(edge.x - part.x) : Math.abs(edge.y - part.y);
            // A tangent circle and a grid edge still constrain the same axis.
            if (Math.abs(distance - part.radius) <= EPSILON) continue;
          }
          for (const point of intersections(part, edge)) {
            if (onContactPart(part, point)) yield point;
          }
        }
      }
    }
  }

  function independentTileIntersections(first, second) {
    if (first.shape === 'circle' && second.shape === 'circle') {
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (Math.abs(distance - Math.abs(first.radius - second.radius)) <= EPSILON) return [];
    } else if (first.shape === 'circle' || second.shape === 'circle') {
      const circle = first.shape === 'circle' ? first : second;
      const line = first.shape === 'line' ? first : second;
      const length = Math.hypot(line.endX - line.x, line.endY - line.y);
      if (Math.abs(guideSide(line, circle) - circle.radius * length) <= EPSILON * length) return [];
    }
    return intersections(first, second);
  }

  function faceSpan(points, tx, ty, direction) {
    const depths = points.map(point => direction * (point.x * ty - point.y * tx));
    const edge = Math.max(...depths);
    const along = points.filter((point, index) => edge - depths[index] <= EPSILON)
      .map(point => point.x * tx + point.y * ty);
    if (along.length >= 2) return [Math.min(...along), Math.max(...along)];
  }

  function* alignedTilePoints(geometry, tiles, limit) {
    if (tiles.length < 2 || !geometry.points || geometry.curved) return;
    const { piece } = geometry;
    for (const tile of tiles) {
      if (!tile.fixed.points || tile.fixed.curved) continue;
      for (const part of tile.parts) {
        if (part.shape !== 'line') continue;
        const dx = part.endX - part.x;
        const dy = part.endY - part.y;
        const length = Math.hypot(dx, dy);
        if (!length) continue;
        const tx = dx / length;
        const ty = dy / length;
        const fixedFace = faceSpan(tile.fixed.points, tx, ty, 1);
        const movingFace = faceSpan(geometry.points, tx, ty, -1);
        if (!fixedFace || !movingFace) continue;

        // Align an endpoint of each facing edge while keeping the grout gap.
        for (let end = 0; end < 2; end++) {
          const shift = fixedFace[end] - movingFace[end];
          if (Math.abs(shift) > limit / 2) continue;
          const along = (piece.x - part.x) * tx + (piece.y - part.y) * ty + shift;
          if (along < -EPSILON || along > length + EPSILON) continue;
          yield { x: part.x + along * tx, y: part.y + along * ty };
        }
      }
    }
  }

  function* tileCrossings(tiles, guides, geometry, limit) {
    yield* tileGuideCrossings(tiles, guides, geometry.piece);
    yield* alignedTilePoints(geometry, tiles, limit);

    // Contacts along the same direction slide together. Opposing contacts can still pin a tile.
    const sorted = tiles.slice().sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < sorted.length; i++) {
      const first = sorted[i];
      for (let j = i + 1; j < sorted.length && sorted[j].minX <= first.maxX + EPSILON; j++) {
        const second = sorted[j];
        if (first.maxY + EPSILON < second.minY || second.maxY + EPSILON < first.minY) continue;
        yield* contactCrossings(first.parts, second.parts, { intersect: independentTileIntersections });
      }
    }
  }

  function pointInPolygon(point, points) {
    return points.every((start, i) => sideOfEdge(start, points[(i + 1) % points.length], point) >= 0);
  }

  function segmentHits(geometry, start, end, bounds) {
    if (bounds.maxX < geometry.minX || bounds.minX > geometry.maxX ||
        bounds.maxY < geometry.minY || bounds.minY > geometry.maxY) return false;
    if (geometry.radius) {
      return minSegmentDistanceSquared(geometry.piece, start, end) <= geometry.radius ** 2;
    }

    const range = polygonLineRange(geometry.points, start, end);
    return Boolean(range && range.entry <= 1 && range.exit >= 0);
  }

  // Clip the line to the inside of each edge of the convex tile.
  function polygonLineRange(points, start, end) {
    let entry = -Infinity;
    let exit = Infinity;
    let entryEdge;
    for (let i = 0; i < points.length; i++) {
      const edgeStart = points[i];
      const edgeEnd = points[(i + 1) % points.length];
      const from = sideOfEdge(edgeStart, edgeEnd, start);
      const to = sideOfEdge(edgeStart, edgeEnd, end);
      if (from === to && from < 0) return;
      if (to > from) {
        const crossing = from / (from - to);
        if (crossing > entry) {
          entry = crossing;
          entryEdge = i;
        }
      }
      if (to < from) exit = Math.min(exit, from / (from - to));
      if (entry > exit) return;
    }
    return { entry, exit, entryEdge };
  }

  function circleLineRange({ piece, radius }, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const x = piece.x - start.x;
    const y = piece.y - start.y;
    const across = (x * dy - y * dx) / length;
    if (Math.abs(across) >= radius) return;
    const along = (x * dx + y * dy) / length;
    const halfChord = Math.sqrt(radius * radius - across * across);
    return { entry: (along - halfChord) / length, exit: (along + halfChord) / length };
  }

  function curveSplitMarks({ piece, radius, points }) {
    if (!radius) return [0, 1, 2, 3].map(index => points[index * CURVE_SEGMENTS / 4]);
    const angle = piece.angle * Math.PI / 180;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return [
      { x: piece.x + x, y: piece.y + y }, { x: piece.x - y, y: piece.y + x },
      { x: piece.x - x, y: piece.y - y }, { x: piece.x + y, y: piece.y - x }
    ];
  }

  function curveSplitStart(curve, pointer, limit) {
    const marks = curveSplitMarks(curve);
    const reach = Math.min(limit, Math.hypot(marks[0].x - marks[1].x, marks[0].y - marks[1].y) / 4);
    let point = nearestGuideAnchor(marks, pointer, reach);
    const { radius, piece } = curve;
    if (!point && radius) {
      const dx = pointer.x - piece.x;
      const dy = pointer.y - piece.y;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(distance - radius) <= Math.min(limit, radius / 2) && distance > EPSILON) {
        point = { x: piece.x + dx * radius / distance, y: piece.y + dy * radius / distance };
      }
    }
    return { curve, marks, point };
  }

  function extendSplitStart(start, pivot, end) {
    const chord = Math.hypot(end.x - pivot.x, end.y - pivot.y);
    if (chord <= EPSILON) return start;
    const scale = Math.hypot(start.x - pivot.x, start.y - pivot.y) / chord;
    return { x: pivot.x - scale * (end.x - pivot.x), y: pivot.y - scale * (end.y - pivot.y) };
  }

  function curveSplitLine(start, end, target, limit, anchored) {
    const { point, curve, marks } = target;
    const { piece: center } = curve;
    const radius = Math.hypot(center.x - point.x, center.y - point.y);
    const nx = (center.x - point.x) / radius;
    const ny = (center.y - point.y) / radius;
    const depth = (end.x - point.x) * nx + (end.y - point.y) * ny;
    const drift = Math.abs((end.x - point.x) * ny - (end.y - point.y) * nx);
    const rawDrift = Math.abs((end.x - start.x) * ny - (end.y - start.y) * nx);
    const fixedStart = !target.entry;
    if (fixedStart && depth > EPSILON && Math.min(drift, rawDrift) <= depth * SPLIT_SNAP_SLOPE) {
      const chord = 2 * radius;
      const endAnchor = Math.abs(depth - chord) <= Math.min(limit, chord / 4) ?
        { x: 2 * center.x - point.x, y: 2 * center.y - point.y } : undefined;
      const finish = endAnchor || { x: point.x + depth * nx, y: point.y + depth * ny };
      const from = Math.min(0, (start.x - point.x) * nx + (start.y - point.y) * ny);
      return {
        start: { x: point.x + from * nx, y: point.y + from * ny },
        end: finish, curveTarget: target, endAnchor, locked: true
      };
    }

    const endAnchor = nearestGuideAnchor(marks.filter(mark => {
      const chord = Math.hypot(mark.x - point.x, mark.y - point.y);
      return chord > EPSILON && Math.hypot(end.x - mark.x, end.y - mark.y) <= chord / 4;
    }), end, limit);
    const finish = endAnchor || end;
    let origin = start;
    if (anchored) origin = point;
    else if (fixedStart || endAnchor) origin = extendSplitStart(start, point, finish);
    return { start: origin, end: finish, curveTarget: target, endAnchor };
  }

  function splitEdge(points, index, origin) {
    const first = points[index];
    const last = points[(index + 1) % points.length];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return;
    const fraction = segmentFraction(origin, first, dx, dy);
    return {
      points, first, last, length, along: fraction * length, tx: dx / length, ty: dy / length,
      point: { x: first.x + dx * fraction, y: first.y + dy * fraction }
    };
  }

  function positionSplitEdge(edge, along, limit) {
    const { first, last, length, tx, ty } = edge;
    const fraction = SPLIT_FRACTIONS[Math.round(4 * along / length)];
    const mark = fraction * length;
    // Keep some free positions between nearby marks even when the edge is small on screen.
    const snapped = fraction !== undefined && Math.abs(mark - along) <= Math.min(limit, length / 16);
    const distance = snapped ? mark : along;
    const point = distance === 0 ? first : distance === length ? last :
      { x: first.x + distance * tx, y: first.y + distance * ty };
    return {
      ...edge, along: distance, fraction: snapped ? fraction : undefined, point
    };
  }

  function crossesSplitInterior(points, start, end) {
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return points.every((first, i) => {
      const last = points[(i + 1) % points.length];
      return sideOfEdge(first, last, middle) > EPSILON * Math.hypot(last.x - first.x, last.y - first.y);
    });
  }

  function nearestSplitEnd({ points, point: start }, end, limit) {
    let nearest;
    let best = limit;
    for (let i = 0; i < points.length; i++) {
      const edge = splitEdge(points, i, end);
      if (!edge) continue;
      const anchor = positionSplitEdge(edge, edge.along, limit);
      if (anchor.fraction === undefined) continue;
      const { point } = anchor;
      const distance = Math.hypot(end.x - point.x, end.y - point.y);
      const chord = Math.hypot(start.x - point.x, start.y - point.y);
      if (distance > Math.min(best, chord / 4) || (nearest && distance === best) ||
          !crossesSplitInterior(points, start, point)) continue;
      nearest = point;
      best = distance;
    }
    return nearest;
  }

  function perpendicularSplitLine(edge, depth, from, limit) {
    const { points, point, tx, ty } = edge;
    const end = { x: point.x - depth * ty, y: point.y + depth * tx };
    const range = polygonLineRange(points, point, end);
    if (!range || range.exit <= 0) return;
    const chord = range.exit * depth;
    const exit = { x: point.x - chord * ty, y: point.y + chord * tx };
    if (!crossesSplitInterior(points, point, exit)) return;
    const endAnchor = Math.abs(depth - chord) <= Math.min(limit, chord / 4) ? exit : undefined;
    return {
      start: { x: point.x - from * ty, y: point.y + from * tx },
      end: endAnchor || end, edge, endAnchor, locked: true
    };
  }

  function clipOutline(points, normalX, normalY, offset) {
    function distance(point) {
      const value = point.x * normalX + point.y * normalY - offset;
      return Math.abs(value) <= EPSILON ? 0 : value;
    }
    const result = [];
    let previous = points[points.length - 1];
    let from = distance(previous);
    for (const point of points) {
      const to = distance(point);
      if ((from < 0 && to > 0) || (from > 0 && to < 0)) {
        const fraction = from / (from - to);
        result.push({
          x: previous.x + fraction * (point.x - previous.x),
          y: previous.y + fraction * (point.y - previous.y)
        });
      }
      if (to >= 0) result.push(point);
      previous = point;
      from = to;
    }
    return result;
  }

  function polygonArea(points) {
    let doubledArea = 0;
    for (let i = 2; i < points.length; i++) doubledArea += sideOfEdge(points[0], points[i - 1], points[i]);
    return doubledArea / 2;
  }

  function splitPiece(tile, piece, start, end) {
    const radians = piece.angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localPoint = ({ x, y }) => ({
      x: (x - piece.x) * cos + (y - piece.y) * sin,
      y: (y - piece.y) * cos - (x - piece.x) * sin
    });
    const first = localPoint(start);
    const last = localPoint(end);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return;

    const points = piece.outline || (tile.shape === 'circle' ?
      ovalOutline.map(({ x, y }) => ({ x: x * tile.width / 2, y: y * tile.width / 2 })) : tileVertices(tile));
    const range = polygonLineRange(points, first, last);
    const tolerance = EPSILON / length;
    if (!range || range.entry < -tolerance || range.exit > 1 + tolerance ||
        range.exit - range.entry <= tolerance) return;

    const normalX = -dy / length;
    const normalY = dx / length;
    const offset = first.x * normalX + first.y * normalY;
    const { min, max } = projectionBounds(points, normalX, normalY);
    if (offset <= min + EPSILON || offset >= max - EPSILON) return;
    // Both fragments use the cut line as their shared boundary.
    const fragments = [];
    for (const side of [1, -1]) {
      const clipped = clipOutline(points, side * normalX, side * normalY, side * offset);
      if (clipped.length < 3) return {};
      const x = clipped.reduce((sum, point) => sum + point.x, 0) / clipped.length;
      const y = clipped.reduce((sum, point) => sum + point.y, 0) / clipped.length;
      const outline = convexHull(clipped.map(point => ({ x: point.x - x, y: point.y - y })));
      if (outline.length < 3 || outline.length > MAX_OUTLINE_VERTICES || polygonArea(outline) <= EPSILON) return {};
      fragments.push({
        tileId: piece.tileId, angle: piece.angle, outline,
        x: piece.x + x * cos - y * sin, y: piece.y + x * sin + y * cos
      });
    }
    return { fragments };
  }

  function projectionBounds(points, x, y) {
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      const value = x * point.x + y * point.y;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { min, max };
  }

  function overlapOnAxes(points, other) {
    return points.every((start, i) => {
      const end = points[(i + 1) % points.length];
      const dx = end.y - start.y;
      const dy = start.x - end.x;
      const first = projectionBounds(points, dx, dy);
      const second = projectionBounds(other, dx, dy);
      const tolerance = EPSILON * Math.hypot(dx, dy);
      return first.max > second.min + tolerance && second.max > first.min + tolerance;
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

  function convexHull(points) {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    function halfHull(sorted) {
      const hull = [];
      for (const point of sorted) {
        while (hull.length >= 2 && sideOfEdge(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
          hull.pop();
        }
        hull.push(point);
      }
      hull.pop();
      return hull;
    }
    return halfHull(points).concat(halfHull(points.reverse()));
  }

  function summedOutline(first, second) {
    if (second.length === 1) [first, second] = [second, first];
    if (first.length === 1) {
      return convexHull(second.map(point => ({ x: first[0].x + point.x, y: first[0].y + point.y })));
    }

    // Walking both convex outlines in edge angle order traces the boundary of their sum.
    const edges = [];
    function addEdges(points, source) {
      let lowest = points[0];
      for (let i = 0; i < points.length; i++) {
        const start = points[i];
        const end = points[(i + 1) % points.length];
        if (start.y < lowest.y || (start.y === lowest.y && start.x < lowest.x)) lowest = start;
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        edges.push({ end, source, angle: angle < 0 ? angle + TAU : angle });
      }
      return lowest;
    }

    const current = [addEdges(first, 0), addEdges(second, 1)];
    const vertices = [];
    edges.sort((a, b) => a.angle - b.angle);
    for (const { end, source } of edges) {
      current[source] = end;
      vertices.push({ x: current[0].x + current[1].x, y: current[0].y + current[1].y });
    }
    return convexHull(vertices);
  }

  function* tileContactParts(moving, fixed, gap) {
    const center = moving.piece;
    const radius = gap + (moving.radius || 0) + (fixed.radius || 0);
    if (moving.radius && fixed.radius) {
      yield { shape: 'circle', x: fixed.piece.x, y: fixed.piece.y, radius };
      return;
    }

    // The fixed outline plus the reversed moving outline bounds its center at contact.
    // Round the result by the grout gap and by either tile's circular radius.
    const offsets = moving.points ? moving.points.map(point => ({ x: center.x - point.x, y: center.y - point.y })) :
      [{ x: 0, y: 0 }];
    const outline = summedOutline(fixed.points || [fixed.piece], offsets);
    for (let i = 0; i < outline.length; i++) {
      const start = outline[i];
      const end = outline[(i + 1) % outline.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const offsetX = dy / length * radius;
      const offsetY = -dx / length * radius;
      yield linePart(start.x + offsetX, start.y + offsetY, end.x + offsetX, end.y + offsetY);
      if (radius) {
        const previous = outline[(i + outline.length - 1) % outline.length];
        yield { shape: 'circle', x: start.x, y: start.y, radius, previous, next: end };
      }
    }
  }

  function onContactPart(part, point) {
    if (part.inside) {
      return part.inside.every(circle => Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius + EPSILON);
    }
    if (!part.previous) return true;
    // The corner arc faces away from both incident edges.
    for (const neighbor of [part.previous, part.next]) {
      const dx = neighbor.x - part.x;
      const dy = neighbor.y - part.y;
      if ((point.x - part.x) * dx + (point.y - part.y) * dy > EPSILON * Math.hypot(dx, dy)) return false;
    }
    return true;
  }

  function contactBounds(part) {
    const { x, y, radius, previous, next } = part;
    if (part.shape === 'line') {
      return { minX: Math.min(x, part.endX), maxX: Math.max(x, part.endX),
        minY: Math.min(y, part.endY), maxY: Math.max(y, part.endY) };
    }
    if (!previous) return { minX: x - radius, maxX: x + radius, minY: y - radius, maxY: y + radius };

    // The corner arc runs between the normals of its two incident edges.
    const ax = x - previous.x;
    const ay = y - previous.y;
    const bx = next.x - x;
    const by = next.y - y;
    const a = radius / Math.hypot(ax, ay);
    const b = radius / Math.hypot(bx, by);
    return {
      minX: x + (ax <= 0 && bx >= 0 ? -radius : Math.min(a * ay, b * by)),
      maxX: x + (ax >= 0 && bx <= 0 ? radius : Math.max(a * ay, b * by)),
      minY: y + (ay <= 0 && by >= 0 ? -radius : Math.min(-a * ax, -b * bx)),
      maxY: y + (ay >= 0 && by <= 0 ? radius : Math.max(-a * ax, -b * bx))
    };
  }

  function* guideContactParts(geometry, guide, halfSeam) {
    if (guide.shape === 'line') {
      yield* tileContactParts(geometry, { points: [guide, { x: guide.endX, y: guide.endY }] }, halfSeam);
      return;
    }
    yield* tileContactParts(geometry, { piece: guide, radius: guide.radius }, halfSeam);

    const innerRadius = guide.radius - halfSeam;
    if (innerRadius < 0) return;
    if (geometry.radius) {
      const radius = innerRadius - geometry.radius;
      if (radius >= 0) yield { ...guide, radius };
      return;
    }

    // Each vertex must fit inside the circle reduced by half the grout width.
    // A point on the common boundary of the disks places the grout against the guide.
    const center = geometry.piece;
    const disks = geometry.points.map(vertex => ({
      shape: 'circle', x: guide.x + (center.x - vertex.x), y: guide.y + (center.y - vertex.y), radius: innerRadius
    }));
    for (let i = 0; i < disks.length; i++) {
      const part = { ...disks[i], inside: disks };
      yield part;
      for (let j = 0; j < i; j++) {
        for (const point of circleIntersections(part, disks[j])) {
          if (onContactPart(part, point)) yield { shape: 'circle', ...point, radius: 0 };
        }
      }
    }
  }

  function tileReach(geometry) {
    const { piece, points, radius } = geometry;
    return radius || Math.max(...points.map(vertex => Math.hypot(vertex.x - piece.x, vertex.y - piece.y)));
  }

  function nearbyGuideContacts({ board, grid, guides, seam }, geometry, limit) {
    const custom = [];
    const lattice = [];
    const halfSeam = seam / 2;
    const { piece, minX, minY, maxX, maxY } = geometry;
    if (grid.visible) {
      const origin = gridOrigin(grid);
      const halfWidth = board.width / 2;
      const halfHeight = board.height / 2;
      for (const edge of [minX - halfSeam, maxX + halfSeam]) {
        const target = gridLine(edge, grid.size, halfWidth, origin.x);
        if (target === undefined || Math.abs(target - edge) > limit) continue;
        const x = piece.x + (target - edge);
        lattice.push({ ...linePart(x, -halfHeight, x, halfHeight), gridX: target });
      }
      for (const edge of [minY - halfSeam, maxY + halfSeam]) {
        const target = gridLine(edge, grid.size, halfHeight, origin.y);
        if (target === undefined || Math.abs(target - edge) > limit) continue;
        const y = piece.y + (target - edge);
        lattice.push({ ...linePart(-halfWidth, y, halfWidth, y), gridY: target });
      }
    }
    if (grid.guidesVisible) {
      const reach = tileReach(geometry);
      for (const guide of guides) {
        const projected = projectOntoGuide(piece, guide);
        if (Math.hypot(projected.x - piece.x, projected.y - piece.y) > reach + halfSeam + limit + EPSILON) continue;
        for (const part of guideParts(guide)) {
          const contacts = [];
          for (const contact of guideContactParts(geometry, part, halfSeam)) {
            const target = projectOntoGuide(piece, contact);
            if (Math.hypot(target.x - piece.x, target.y - piece.y) <= limit + EPSILON) contacts.push(contact);
          }
          if (contacts.length) custom.push(contacts);
        }
      }
    }
    return { custom, lattice };
  }

  function guideSide(guide, point) {
    const dx = point.x - guide.x;
    const dy = point.y - guide.y;
    if (guide.shape === 'circle') return Math.hypot(dx, dy) - guide.radius;
    return (guide.endX - guide.x) * dy - (guide.endY - guide.y) * dx;
  }

  function nearbyGridLines({ board, grid }, piece, limit) {
    if (!grid.visible) return {};
    const origin = gridOrigin(grid);
    const x = gridLine(piece.x, grid.size, board.width / 2, origin.x);
    const y = gridLine(piece.y, grid.size, board.height / 2, origin.y);
    return { x: Math.abs(x - piece.x) <= limit ? x : undefined, y: Math.abs(y - piece.y) <= limit ? y : undefined };
  }

  function pointedGridContacts(project, geometry, limit) {
    const { piece, minX, minY, maxX, maxY } = geometry;
    const { board, grid, seam } = project;
    const corner = nearbyGridLines(project, piece, Math.min(limit, grid.size / 4));
    if (corner.x === undefined || corner.y === undefined || !pointInBoard(board, corner)) return;
    const halfWidth = board.width / 2;
    const halfHeight = board.height / 2;
    const halfSeam = seam / 2;
    const vertical = [minX - halfSeam, maxX + halfSeam].map(edge => {
      const x = corner.x + (piece.x - edge);
      return linePart(x, -halfHeight, x, halfHeight);
    });
    const horizontal = [minY - halfSeam, maxY + halfSeam].map(edge => {
      const y = corner.y + (piece.y - edge);
      return linePart(-halfWidth, y, halfWidth, y);
    });
    return { corner, vertical, horizontal };
  }

  function* aimedGridPoints(points, piece, corner, preferSide) {
    for (const point of points) {
      if (preferSide && ((piece.x - corner.x) * (point.x - corner.x) < -EPSILON ||
        (piece.y - corner.y) * (point.y - corner.y) < -EPSILON)) continue;
      yield point;
    }
  }

  function* pointedGuideCrossings(project, geometry, limit, reach, preferSide, aimedGrid) {
    const { board, grid, guides, seam } = project;
    const { piece } = geometry;
    const halfSeam = seam / 2;
    const custom = [];
    const lattice = [];
    for (const guide of grid.guidesVisible ? guides : []) {
      for (const part of guideParts(guide)) {
        const projected = projectOntoGuide(piece, part);
        if (Math.hypot(projected.x - piece.x, projected.y - piece.y) <= limit + EPSILON) custom.push([part]);
      }
    }
    if (aimedGrid) {
      const points = [];
      for (const { x } of aimedGrid.vertical) {
        for (const { y } of aimedGrid.horizontal) points.push({ x, y });
      }
      yield* aimedGridPoints(points, piece, aimedGrid.corner, preferSide);
    }
    const { x, y } = nearbyGridLines(project, piece, limit);
    if (x !== undefined) lattice.push(linePart(x, -board.height / 2, x, board.height / 2));
    if (y !== undefined) lattice.push(linePart(-board.width / 2, y, board.width / 2, y));

    function* nearCrossings(parts, earlier) {
      for (const part of parts) {
        for (const other of earlier) {
          const gridLineTarget = lattice.includes(other);
          const crossings = [...intersections(part, other)].filter(point =>
            Math.hypot(point.x - piece.x, point.y - piece.y) <= Math.SQRT2 * limit &&
            (!gridLineTarget || pointInBoard(board, point)));
          if (!crossings.length) continue;
          const first = [...guideContactParts(geometry, part, halfSeam)];
          const second = [...guideContactParts(geometry, other, halfSeam)];
          for (const point of contactCrossings(first, second)) {
            if (preferSide && (guideSide(part, piece) * guideSide(part, point) < -EPSILON ||
              guideSide(other, piece) * guideSide(other, point) < -EPSILON)) continue;
            if (crossings.some(crossing => Math.hypot(point.x - crossing.x, point.y - crossing.y) <= reach)) {
              yield point;
            }
          }
        }
      }
    }
    yield* guideCrossings({ custom, lattice }, nearCrossings);
  }

  function* contactProjections(parts, origin) {
    for (const part of parts) {
      const point = projectOntoGuide(origin, part);
      if (onContactPart(part, point)) yield point;
    }
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
    constructor(project, excludedIds) {
      this.board = project.board;
      this.worktable = worktableBounds(project.board, project.worktable);
      this.gap = project.seam;
      this.tileTypes = new Map(project.tiles.map(tile => [tile.id, tile]));
      this.cells = new Map();
      this.geometries = [];
      this.largeGeometries = [];
      for (const piece of project.pieces) {
        if (!excludedIds || !excludedIds.has(piece.id)) this.add(this.geometry(piece));
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

    nearby(bounds, margin = 0) {
      const keys = cellsInBounds(bounds, margin);
      if (!keys) return this.geometries;
      const neighbors = new Set(this.largeGeometries);
      for (const key of keys) {
        const cell = this.cells.get(key);
        if (cell) for (const other of cell) neighbors.add(other);
      }
      return neighbors;
    }

    accepts(geometry) {
      const table = this.worktable;
      const fits = isOnWorktable(table, geometry.piece) ?
        geometry.minX >= table.minX - EPSILON && geometry.maxX <= table.maxX + EPSILON &&
        geometry.minY >= table.minY - EPSILON && geometry.maxY <= table.maxY + EPSILON :
        fitsBoard(this.board, geometry);
      return fits && !this.hasConflict(geometry);
    }

    hasConflict(geometry) {
      const onTable = isOnWorktable(this.worktable, geometry.piece);
      for (const other of this.nearby(geometry, this.gap)) {
        const gap = onTable === isOnWorktable(this.worktable, other.piece) ? this.gap : 0;
        if (tooClose(geometry, other, gap)) return true;
      }
      return false;
    }

    closestPlacement(piece, limit, points, accepts) {
      let nearest;
      let bestDistance = limit;
      for (const { x, y } of points) {
        const distance = Math.hypot(x - piece.x, y - piece.y);
        if (distance > bestDistance || (nearest && distance === bestDistance)) continue;
        const candidate = this.geometry({ ...piece, x, y });
        if (!accepts(candidate)) continue;
        if (!distance) return candidate;
        nearest = candidate;
        bestDistance = distance;
      }
      return nearest;
    }

    nearbyTileContacts(geometry, limit) {
      const { piece, minX, minY, maxX, maxY } = geometry;
      const tiles = [];
      const margin = this.gap + limit;
      const onTable = isOnWorktable(this.worktable, piece);
      for (const other of this.nearby(geometry, margin)) {
        if (onTable !== isOnWorktable(this.worktable, other.piece)) continue;
        if (maxX + margin < other.minX || other.maxX + margin < minX ||
            maxY + margin < other.minY || other.maxY + margin < minY) continue;
        const parts = [];
        for (const part of tileContactParts(geometry, other, this.gap)) {
          const projected = projectOntoGuide(piece, part);
          if (Math.hypot(projected.x - piece.x, projected.y - piece.y) <= limit + EPSILON) {
            part.bounds = contactBounds(part);
            parts.push(part);
          }
        }
        if (parts.length) {
          tiles.push({
            fixed: other,
            parts,
            minX: other.minX - (maxX - piece.x) - this.gap,
            maxX: other.maxX + (piece.x - minX) + this.gap,
            minY: other.minY - (maxY - piece.y) - this.gap,
            maxY: other.maxY + (piece.y - minY) + this.gap
          });
        }
      }
      return tiles;
    }

    snapPlacement(project, piece, limit, accepts = candidate => this.accepts(candidate)) {
      const original = this.geometry(piece);
      const { grid } = project;
      const table = this.worktable;
      const onTable = isOnWorktable(table, piece);
      const snapGuides = grid.snap && !onTable;
      if (!snapGuides && !grid.snapTiles) return original;
      const acceptsOnSurface = candidate => isOnWorktable(table, candidate.piece) === onTable && accepts(candidate);

      const guides = snapGuides ? nearbyGuideContacts(project, original, limit) : { custom: [], lattice: [] };
      const custom = [].concat(...guides.custom);
      const tiles = grid.snapTiles ? this.nearbyTileContacts(original, limit) : [];
      // Each edge must be within the snap tolerance. Two corrections can add up diagonally.
      const pairLimit = Math.SQRT2 * limit;
      const gridAndTile = this.closestPlacement(piece, pairLimit, gridTileCrossings(tiles, guides.lattice), acceptsOnSurface);
      const guideRange = gridAndTile ? Math.hypot(gridAndTile.piece.x - piece.x, gridAndTile.piece.y - piece.y) : pairLimit;
      // When laying the next tile in a row, preserve its joint to the placed neighbor.
      const crossingPoints = alignedGuideCrossings(project, guides, piece, limit, !gridAndTile);
      const crossing = this.closestPlacement(piece, guideRange, crossingPoints, acceptsOnSurface) || gridAndTile;
      const crossingRange = crossing ? Math.hypot(crossing.piece.x - piece.x, crossing.piece.y - piece.y) : pairLimit;
      const contact = this.closestPlacement(piece, crossingRange, tileCrossings(tiles, custom, original, limit), acceptsOnSurface);
      if (crossing) return contact || crossing;

      if (snapGuides && (grid.visible || (grid.guidesVisible && project.guides.length))) {
        // Aiming at the visible crossing places the edge of the tile beside it.
        const reach = Math.SQRT2 * (tileReach(original) + project.seam / 2);
        const range = reach + pairLimit;
        const aimedGrid = pointedGridContacts(project, original, limit);
        if (grid.snapTiles && aimedGrid) {
          const aimedTiles = this.nearbyTileContacts(original, range);
          const gridEdges = aimedGrid.vertical.concat(aimedGrid.horizontal);
          const points = aimedGridPoints(gridTileCrossings(aimedTiles, gridEdges), piece, aimedGrid.corner, true);
          const joined = this.closestPlacement(piece, range, points, acceptsOnSurface);
          if (joined) return joined;
        }
        const pointed = this.closestPlacement(piece, range,
          pointedGuideCrossings(project, original, limit, reach, true, aimedGrid), acceptsOnSurface) ||
          this.closestPlacement(piece, range,
            pointedGuideCrossings(project, original, limit, reach, false, aimedGrid), acceptsOnSurface);
        if (pointed) return pointed;
      }
      if (contact) return contact;

      const guided = this.closestPlacement(piece, limit, contactProjections(guides.lattice.concat(custom), piece), acceptsOnSurface);
      const range = guided ? Math.hypot(guided.piece.x - piece.x, guided.piece.y - piece.y) : limit;
      const tileParts = [].concat(...tiles.map(tile => tile.parts));
      return this.closestPlacement(piece, range, contactProjections(tileParts, piece), acceptsOnSurface) || guided || original;
    }

    *piecesAlong(start, end) {
      const bounds = {
        minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y)
      };
      for (const geometry of this.nearby(bounds)) {
        if (segmentHits(geometry, start, end, bounds)) yield geometry.piece;
      }
    }

    nearestSplitStart(point, limit) {
      const bounds = { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
      let nearest;
      let hoveredCurve;
      let best = limit;
      for (const geometry of this.nearby(bounds, limit)) {
        const { piece, points, radius, curved, minX, maxX, minY, maxY } = geometry;
        if (point.x < minX - limit || point.x > maxX + limit ||
            point.y < minY - limit || point.y > maxY + limit) continue;
        if (radius || curved) {
          const target = curveSplitStart(geometry, point, limit);
          if (target.point) {
            const distance = Math.hypot(point.x - target.point.x, point.y - target.point.y);
            if (distance < best) {
              nearest = target;
              best = distance;
            }
          } else if (radius ? Math.hypot(point.x - piece.x, point.y - piece.y) < radius : pointInPolygon(point, points)) {
            hoveredCurve = target;
          }
          continue;
        }
        const reach = Math.min(best, (maxX - minX) / 4, (maxY - minY) / 4);
        for (let i = 0; i < points.length; i++) {
          const edge = splitEdge(points, i, point);
          if (!edge) continue;
          const distance = Math.hypot(point.x - edge.point.x, point.y - edge.point.y);
          if (distance > reach || distance >= best) continue;
          nearest = edge;
          best = distance;
        }
      }
      return nearest && !nearest.curve ? positionSplitEdge(nearest, nearest.along, limit) : nearest || hoveredCurve;
    }

    firstSplitBoundary(start, end, limit) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      let first;
      let best = 1;
      for (const piece of this.piecesAlong(start, end)) {
        const geometry = this.geometry(piece);
        const { points, radius, curved } = geometry;
        const range = radius ? circleLineRange(geometry, start, end) : polygonLineRange(points, start, end);
        if (!range || range.entry < 0 || range.entry >= best || range.exit <= range.entry) continue;
        const point = { x: start.x + dx * range.entry, y: start.y + dy * range.entry };
        if (radius || curved) {
          const curve = curveSplitStart(geometry, point, limit);
          first = curve.point ? curve : { ...curve, point, entry: true };
        } else {
          const edge = splitEdge(points, range.entryEdge, point);
          if (!edge) continue;
          first = edge;
        }
        best = range.entry;
      }
      return first;
    }

    splitLine(start, end, startTarget, limit = 0) {
      if (Math.hypot(end.x - start.x, end.y - start.y) <= EPSILON) return { start, end };
      const intoEdge = (edge, point) => (point.y - edge.first.y) * edge.tx - (point.x - edge.first.x) * edge.ty;
      const anchored = startTarget && startTarget.point && (startTarget.curve ?
        (end.x - startTarget.point.x) * (startTarget.curve.piece.x - startTarget.point.x) +
        (end.y - startTarget.point.y) * (startTarget.curve.piece.y - startTarget.point.y) > EPSILON :
        intoEdge(startTarget, end) > EPSILON);
      const edge = anchored ? startTarget : this.firstSplitBoundary(start, end, limit);
      if (!edge) return { start, end };
      if (edge.curve) return curveSplitLine(start, end, edge, limit, anchored);

      const { point, first, length, tx, ty } = edge;
      const depth = intoEdge(edge, end);
      const from = Math.min(0, intoEdge(edge, start));
      const alongEdge = (p, q) => (p.x - q.x) * tx + (p.y - q.y) * ty;
      let drift = Math.abs(alongEdge(end, point));
      if (anchored) drift = Math.min(drift, Math.abs(alongEdge(end, start)));
      const projected = alongEdge(start, first);
      const along = anchored ? edge.along : projected;
      if (along >= 0 && along <= length && drift <= depth * SPLIT_SNAP_SLOPE) {
        const aligned = positionSplitEdge(edge, along, limit);
        const perpendicular = perpendicularSplitLine(aligned, depth, from, limit);
        if (perpendicular) return perpendicular;

        // A corner snap can turn a perpendicular cut into a line along the tile's side.
        if (projected > EPSILON && projected < length - EPSILON && projected !== aligned.along) {
          const freeStart = positionSplitEdge(edge, projected, 0);
          const inside = perpendicularSplitLine(freeStart, depth, from, limit);
          if (inside) return inside;
        }
      }
      const aligned = anchored ? edge : positionSplitEdge(edge, edge.along, limit);
      const endAnchor = nearestSplitEnd(aligned, end, limit);
      const finish = endAnchor || end;
      if (anchored) return { start: point, end: finish, edge, endAnchor };
      if (aligned.fraction === undefined && !endAnchor) return { start, end, edge };
      const finishDepth = intoEdge(aligned, finish);
      if (finishDepth <= EPSILON) return { start, end, edge };
      const pivot = aligned.point;
      const extension = from / finishDepth;
      return {
        start: { x: pivot.x + extension * (finish.x - pivot.x), y: pivot.y + extension * (finish.y - pivot.y) },
        end: finish, edge: aligned, endAnchor
      };
    }

    *piecesWithin(bounds) {
      for (const geometry of this.nearby(bounds)) {
        if (geometry.minX >= bounds.minX && geometry.maxX <= bounds.maxX &&
            geometry.minY >= bounds.minY && geometry.maxY <= bounds.maxY) yield geometry.piece;
      }
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

  function lineSpacing(tile, gap, start, end, angle = 0) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!length || tile.shape === 'circle') return tile.width + gap;
    // Measure the stroke direction along the tile's own axes.
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const alongWidth = Math.abs(dx * cos + dy * sin);
    const alongHeight = Math.abs(dy * cos - dx * sin);
    return Math.min((tile.width + gap) * length / alongWidth, (tile.height + gap) * length / alongHeight);
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

  function blankProject(tiles, name = 'Nimetön mosaiikki') {
    return {
      version: 1,
      name,
      board: { shape: 'circle', width: 200, height: 200, radius: 18 },
      seam: 2,
      seamColor: DEFAULT_SEAM_COLOR,
      grid: { visible: true, size: 12, weight: 0.2, offsetX: 0, offsetY: 0, snap: false, snapTiles: false, guidesVisible: true },
      guides: [],
      tiles,
      pieces: [],
      references: []
    };
  }

  function demoProject(name = 'Kompassiruusu', names = {}) {
    const tileName = (key, fallback) => names[key] == null ? fallback : names[key];
    const project = blankProject([
      { id: 'spruce', name: tileName('spruce', 'Kuusenvihreä'), color: '#285b52' },
      { id: 'jade', name: tileName('jade', 'Salvia'), color: '#75a18a' },
      { id: 'sand', name: tileName('sand', 'Hiekka'), color: '#e5ca9e' },
      { id: 'clay', name: tileName('clay', 'Terrakotta'), color: '#bb684e' },
      { id: 'ivory', name: tileName('ivory', 'Luonnonvalkoinen'), color: '#f9f0d9' }
    ].map(tile => ({ ...tile, shape: 'rectangle', width: 10, height: 10 })), name);

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

  function colorFamilies(hex) {
    const rgb = Number.parseInt(hex.slice(1), 16);
    const red = ((rgb >> 16) & 255) / 255;
    const green = ((rgb >> 8) & 255) / 255;
    const blue = (rgb & 255) / 255;
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const chroma = high - low;
    const lightness = (high + low) / 2;
    const colors = new Set();

    if (low >= .83) colors.add('white');
    if (chroma <= .13 && high >= .22 && low <= .88) colors.add('gray');
    if (high <= .22) colors.add('black');
    if (chroma < .075) return colors;

    let sector;
    if (red === high) sector = (green - blue) / chroma;
    else if (green === high) sector = (blue - red) / chroma + 2;
    else sector = (red - green) / chroma + 4;
    const hue = (sector * 60 + 360) % 360;

    // Brown includes dark warm colors and muted ochre or sand shades.
    const warmBrown = hue >= 7 && hue <= 64 &&
      ((lightness <= .52 && chroma <= .75) || (lightness <= .84 && chroma <= .49));
    const redBrown = (hue >= 349 || hue < 7) && low >= .095 && lightness <= .51 && chroma <= .58;
    const brown = warmBrown || redBrown;
    if (brown) colors.add('brown');

    // The hue ranges overlap so shades near a boundary can match both families.
    if ((hue >= 346 || hue <= 16) && lightness <= .75) colors.add('red');
    if (hue >= 9 && hue <= 49 && (!brown || (lightness >= .42 && chroma >= .30))) colors.add('orange');
    if ((hue >= 40 && hue <= 75) || (hue >= 34 && hue < 40 && lightness >= .58)) colors.add('yellow');
    if (hue >= 67 && hue <= 165) colors.add('green');
    if (hue >= 154 && hue <= 195) colors.add('teal');
    if (hue >= 186 && hue <= 251) colors.add('blue');
    if (hue >= 241 && hue <= (lightness < .38 ? 346 : 307)) colors.add('purple');
    if ((hue >= 296 && hue <= 355 && lightness >= .38) ||
        ((hue >= 340 || hue <= 22) && lightness >= .65)) colors.add('pink');
    return colors;
  }

  function tileTagKey(tag) {
    return tag.toLocaleLowerCase('fi').normalize('NFC');
  }

  class ValidationError extends Error {}

  function normalizeTileTags(values) {
    if (!Array.isArray(values)) throw new ValidationError('invalidTagText');
    const tags = new Map();
    for (const value of values) {
      if (typeof value !== 'string') throw new ValidationError('invalidTagText');
      const tag = value.trim().replace(/\s+/gu, ' ').normalize('NFC');
      if (!tag) continue;
      if (tag.includes(',') || tag.length > 32) {
        throw new ValidationError('invalidTagLength');
      }
      const key = tileTagKey(tag);
      if (!tags.has(key)) tags.set(key, tag);
      if (tags.size > 12) throw new ValidationError('tooManyTags');
    }
    return [...tags.values()];
  }

  function referenceWidthLimit(pixelWidth, pixelHeight) {
    return Math.min(50000, 50000 * pixelWidth / pixelHeight);
  }

  function validReferenceDimensions(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) &&
      validNumber(width, 1, 32768) && validNumber(height, 1, 32768) && width * height <= 80000000;
  }

  function validReferenceSource(source) {
    if (typeof source !== 'string' || source.length > 4 * Math.ceil(MAX_REFERENCE_FILE / 3) + 23) return false;
    const png = 'data:image/png;base64,';
    const jpeg = 'data:image/jpeg;base64,';
    let data;
    if (source.startsWith(png + 'iVBORw0KGgo')) data = source.slice(png.length);
    else if (source.startsWith(jpeg + '/9j/')) data = source.slice(jpeg.length);
    else return false;
    return data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data);
  }

  function readReferences(values) {
    const error = 'invalidReferences';
    if (!Array.isArray(values) || values.length > MAX_REFERENCES) throw new ValidationError(error);
    const seen = new Set();
    let dataLength = 0;
    return values.map(reference => {
      if (!reference) throw new ValidationError(error);
      const { id, name, source, pixelWidth, pixelHeight, x, y, width, opacity, visible } = reference;
      if (!validText(id, 100) || seen.has(id) || !validText(name, 160) || !validReferenceSource(source) ||
          !validReferenceDimensions(pixelWidth, pixelHeight) ||
          !validNumber(x, -REFERENCE_POSITION_LIMIT, REFERENCE_POSITION_LIMIT) ||
          !validNumber(y, -REFERENCE_POSITION_LIMIT, REFERENCE_POSITION_LIMIT) ||
          !validNumber(width, .1, referenceWidthLimit(pixelWidth, pixelHeight)) ||
          !validNumber(opacity, 0, 1) || typeof visible !== 'boolean') throw new ValidationError(error);
      dataLength += source.length;
      if (dataLength > MAX_REFERENCE_DATA) throw new ValidationError('tooMuchReferenceData');
      seen.add(id);
      return { id, name, source, pixelWidth, pixelHeight, x, y, width, opacity, visible };
    });
  }

  function validColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  }

  function readPieceOutline(value) {
    if (!Array.isArray(value) || value.length < 3 || value.length > MAX_OUTLINE_VERTICES) {
      throw new ValidationError('invalidProject');
    }
    const points = value.map(point => {
      if (!point || !validNumber(point.x, -10000, 10000) || !validNumber(point.y, -10000, 10000)) {
        throw new ValidationError('invalidProject');
      }
      return { x: point.x, y: point.y };
    });
    const hull = convexHull(points.slice());
    const first = points.indexOf(hull[0]);
    if (hull.length !== points.length || !hull.every((point, i) => point === points[(first + i) % points.length]) ||
        polygonArea(hull) <= EPSILON || !pointInPolygon({ x: 0, y: 0 }, hull)) {
      throw new ValidationError('invalidProject');
    }
    return points;
  }

  function readProject(value) {
    const error = 'invalidProject';
    if (!value || value.version !== 1 || !validText(value.name, 80)) throw new ValidationError(error);
    const { board, grid, guides = [], tiles, pieces, worktable, seam, seamColor = DEFAULT_SEAM_COLOR } = value;
    if (!board || !boardShapes.includes(board.shape) ||
        !validNumber(board.width, 1, 10000) || !validNumber(board.height, 1, 10000) ||
        !validNumber(board.radius, 0, Math.min(board.width, board.height) / 2) ||
        (board.shape === 'circle' && board.width !== board.height) ||
        (worktable !== undefined && !validNumber(worktable, 1, 10000)) ||
        !validNumber(seam, 0, 100) || !validColor(seamColor) || !grid || typeof grid.visible !== 'boolean' ||
        typeof grid.snap !== 'boolean' || !validNumber(grid.size, .5, 1000) ||
        !validNumber(grid.weight, .1, 10) ||
        (grid.offsetX !== undefined && !validNumber(grid.offsetX, -GRID_OFFSET_LIMIT, GRID_OFFSET_LIMIT)) ||
        (grid.offsetY !== undefined && !validNumber(grid.offsetY, -GRID_OFFSET_LIMIT, GRID_OFFSET_LIMIT)) ||
        (grid.snapTiles !== undefined && typeof grid.snapTiles !== 'boolean') ||
        (grid.guidesVisible !== undefined && typeof grid.guidesVisible !== 'boolean')) throw new ValidationError(error);
    if (!Array.isArray(tiles) || tiles.length > MAX_TYPES ||
        !Array.isArray(pieces) || pieces.length > MAX_PIECES ||
        !Array.isArray(guides) || guides.length > MAX_GUIDES) throw new ValidationError(error);

    const tileTypes = new Map();
    for (const tile of tiles) {
      if (!tile || !validText(tile.id, 100) || tileTypes.has(tile.id) || !validText(tile.name, 60) ||
          !tileShapes.includes(tile.shape) || !validColor(tile.color) ||
          !validNumber(tile.width, .5, 10000) ||
          !validNumber(tile.height, tile.shape === 'triangle' ? MIN_TRIANGLE_HEIGHT :
            tile.shape === 'equilateral' ? triangleHeight(.5) : .5, 10000) ||
          (tile.archived !== undefined && typeof tile.archived !== 'boolean') ||
          (tile.shape === 'circle' && tile.width !== tile.height)) throw new ValidationError(error);
      const height = tile.shape === 'equilateral' ? triangleHeight(tile.width) : tile.height;
      if (Math.abs(height - tile.height) > EPSILON) throw new ValidationError(error);
      let tags;
      try {
        tags = tile.tags === undefined ? [] : normalizeTileTags(tile.tags);
      } catch (tagError) {
        throw new ValidationError(error);
      }
      tileTypes.set(tile.id, {
        id: tile.id, name: tile.name.trim(), shape: tile.shape, color: tile.color,
        width: tile.width, height, ...(tile.archived ? { archived: true } : {}),
        ...(tags.length ? { tags } : {})
      });
    }

    const ids = new Set();
    const restored = blankProject([...tileTypes.values()]);
    restored.name = value.name.trim();
    restored.board = { shape: board.shape, width: board.width, height: board.height, radius: board.radius };
    if (worktable !== undefined) restored.worktable = worktable;
    const { offsetX = 0, offsetY = 0 } = grid;
    restored.grid = {
      visible: grid.visible, size: grid.size, weight: grid.weight, offsetX, offsetY, snap: grid.snap,
      snapTiles: grid.snapTiles === true, guidesVisible: grid.guidesVisible !== false
    };
    for (const guide of guides) {
      const clean = readGuide(guide);
      if (!clean) throw new ValidationError(error);
      restored.guides.push(clean);
    }
    restored.seam = seam;
    restored.seamColor = seamColor.toLowerCase();
    if (value.references !== undefined) restored.references = readReferences(value.references);
    const index = new PlacementIndex({ ...restored, seam: 0 });
    const maxX = Math.max(5000, index.worktable ? index.worktable.maxX + EPSILON : 0);
    for (const piece of pieces) {
      if (!piece || !validText(piece.id, 100) || ids.has(piece.id) || !tileTypes.has(piece.tileId) ||
          !validNumber(piece.x, -5000, maxX) || !validNumber(piece.y, -5000, 5000) ||
          !validNumber(piece.angle, -360, 360)) throw new ValidationError(error);
      const clean = { id: piece.id, tileId: piece.tileId, x: piece.x, y: piece.y, angle: angleInDegrees(piece.angle) };
      if (piece.outline !== undefined) clean.outline = readPieceOutline(piece.outline);
      const geometry = index.geometry(clean);
      if (!index.accepts(geometry)) throw new ValidationError('invalidPlacements');
      index.add(geometry);
      ids.add(piece.id);
      restored.pieces.push(clean);
    }
    return restored;
  }

  const model = {
    MAX_PIECES, MAX_TYPES, MAX_STROKE, MAX_PROJECT_FILE, MAX_GUIDES, GRID_OFFSET_LIMIT, MAX_REFERENCES, MAX_REFERENCE_FILE, MAX_REFERENCE_DATA,
    REFERENCE_POSITION_LIMIT, MIN_TRIANGLE_HEIGHT, PlacementIndex, ValidationError, angleInDegrees, blankProject, boardGuideAnchors, colorFamilies, demoProject,
    fitsBoard, gridOrigin, guideFromDrag, isOnWorktable, lineSpacing, nearestGuide, nearestGuideAnchor, normalizeTileTags, outlinePath, pieceGeometry, pointInBoard, readProject,
    referenceWidthLimit, sampleOutline, sampleSegment, SPLIT_FRACTIONS, splitPiece, tileTagKey, tileVertices, triangleHeight, triangleHeightFromAngle, triangleApexAngle,
    validNumber, validReferenceDimensions, worktableBounds
  };

  if (typeof module === 'object') module.exports = model;
  else window.MosaicGeometry = model;
}());
