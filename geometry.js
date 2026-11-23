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
  const DEFAULT_SEAM_COLOR = '#a9a49b';
  const MIN_TRIANGLE_HEIGHT = .1;
  const boardShapes = ['rectangle', 'circle', 'rounded'];
  const tileShapes = ['rectangle', 'circle', 'triangle', 'equilateral'];

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
    if (tile.shape === 'triangle' || tile.shape === 'equilateral') {
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
    // Coincident edges or arcs have a continuous set of shared positions.
    const projected = projectOntoGuide(origin, other);
    const onOther = projectOntoGuide(contact, other);
    const onPart = projectOntoGuide(projected, part);
    if (Math.hypot(contact.x - onOther.x, contact.y - onOther.y) <= EPSILON) yield contact;
    if (Math.hypot(projected.x - onPart.x, projected.y - onPart.y) <= EPSILON) yield projected;
    yield* intersections(part, other);
  }

  function* contactCrossings(first, second, origin) {
    if (!second.length) return;
    for (const part of first) {
      const projected = origin && projectOntoGuide(origin, part);
      for (const other of second) {
        const points = origin ? sharedContactPoints(part, other, origin, projected) : intersections(part, other);
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

  function* alignedGuideCrossings({ board, grid }, guides, piece, limit) {
    yield* guideCrossings(guides);

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

  function* tileCrossings(tiles, guides, origin) {
    for (const tile of tiles) yield* contactCrossings(tile.parts, guides, origin);

    // Check each pair of distinct neighbors whose contact bounds overlap.
    const sorted = tiles.slice().sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < sorted.length; i++) {
      const first = sorted[i];
      for (let j = i + 1; j < sorted.length && sorted[j].minX <= first.maxX + EPSILON; j++) {
        const second = sorted[j];
        if (first.maxY + EPSILON < second.minY || second.maxY + EPSILON < first.minY) continue;
        yield* contactCrossings(first.parts, second.parts, origin);
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

    // Clip the segment to the inside of each edge of the convex tile.
    let entry = 0;
    let exit = 1;
    const points = geometry.points;
    for (let i = 0; i < points.length; i++) {
      const edgeStart = points[i];
      const edgeEnd = points[(i + 1) % points.length];
      const from = sideOfEdge(edgeStart, edgeEnd, start);
      const to = sideOfEdge(edgeStart, edgeEnd, end);
      if (from < 0 && to < 0) return false;
      if (from < 0) entry = Math.max(entry, from / (from - to));
      if (to < 0) exit = Math.min(exit, from / (from - to));
      if (entry > exit) return false;
    }
    return true;
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

  function* tileContactParts(moving, fixed, gap) {
    const center = moving.piece;
    const radius = gap + (moving.radius || 0) + (fixed.radius || 0);
    if (moving.radius && fixed.radius) {
      yield { shape: 'circle', x: fixed.piece.x, y: fixed.piece.y, radius };
      return;
    }

    // The hull of the vertex differences bounds the moving center at contact.
    // Round that outline by the grout gap and by either tile's circular radius.
    const differences = [];
    for (const a of fixed.points || [fixed.piece]) {
      for (const b of moving.points || [center]) {
        differences.push({ x: a.x + (center.x - b.x), y: a.y + (center.y - b.y) });
      }
    }
    const outline = convexHull(differences);
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
        const contacts = [];
        for (const part of guideParts(guide)) {
          for (const contact of guideContactParts(geometry, part, halfSeam)) {
            const target = projectOntoGuide(piece, contact);
            if (Math.hypot(target.x - piece.x, target.y - piece.y) <= limit + EPSILON) contacts.push(contact);
          }
        }
        if (contacts.length) custom.push(contacts);
      }
    }
    return { custom, lattice };
  }

  function* pointedGuideCrossings({ board, grid, guides, seam }, geometry, limit, reach) {
    const { piece, minX, minY, maxX, maxY } = geometry;
    const halfSeam = seam / 2;
    const custom = [];
    const lattice = [];
    for (const guide of grid.guidesVisible ? guides : []) {
      const parts = guideParts(guide).filter(part => {
        const projected = projectOntoGuide(piece, part);
        return Math.hypot(projected.x - piece.x, projected.y - piece.y) <= limit + EPSILON;
      });
      if (parts.length) custom.push(parts);
    }
    if (grid.visible) {
      const origin = gridOrigin(grid);
      const halfWidth = board.width / 2;
      const halfHeight = board.height / 2;
      const x = gridLine(piece.x, grid.size, halfWidth, origin.x);
      const y = gridLine(piece.y, grid.size, halfHeight, origin.y);
      const range = Math.min(limit, grid.size / 4);
      if (Math.abs(x - piece.x) <= range && Math.abs(y - piece.y) <= range && pointInBoard(board, { x, y })) {
        for (const edgeX of [minX - halfSeam, maxX + halfSeam]) {
          for (const edgeY of [minY - halfSeam, maxY + halfSeam]) {
            yield { x: x + (piece.x - edgeX), y: y + (piece.y - edgeY) };
          }
        }
      }
      if (Math.abs(x - piece.x) <= limit) lattice.push(linePart(x, -halfHeight, x, halfHeight));
      if (Math.abs(y - piece.y) <= limit) lattice.push(linePart(-halfWidth, y, halfWidth, y));
    }

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
      if (!fitsBoard(this.board, geometry)) return false;
      for (const other of this.nearby(geometry, this.gap)) {
        if (tooClose(geometry, other, this.gap)) return false;
      }
      return true;
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
      for (const other of this.nearby(geometry, margin)) {
        if (maxX + margin < other.minX || other.maxX + margin < minX ||
            maxY + margin < other.minY || other.maxY + margin < minY) continue;
        const parts = [];
        for (const part of tileContactParts(geometry, other, this.gap)) {
          const projected = projectOntoGuide(piece, part);
          if (Math.hypot(projected.x - piece.x, projected.y - piece.y) <= limit + EPSILON) parts.push(part);
        }
        if (parts.length) {
          tiles.push({
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
      if (!grid.snap && !grid.snapTiles) return original;

      const guides = grid.snap ? nearbyGuideContacts(project, original, limit) : { custom: [], lattice: [] };
      const parts = guides.lattice.concat(...guides.custom);
      // Each guide must be within the snap tolerance. Two corrections can add up diagonally.
      const crossingPoints = alignedGuideCrossings(project, guides, piece, limit);
      const crossing = this.closestPlacement(piece, Math.SQRT2 * limit, crossingPoints, accepts);
      const tiles = grid.snapTiles ? this.nearbyTileContacts(original, limit) : [];
      const crossingRange = crossing ? Math.min(limit, Math.hypot(crossing.piece.x - piece.x, crossing.piece.y - piece.y)) : limit;
      const contact = this.closestPlacement(piece, crossingRange, tileCrossings(tiles, parts, piece), accepts);
      if (crossing) return contact || crossing;

      if (grid.snap && (grid.visible || (grid.guidesVisible && project.guides.length))) {
        // Aiming at the visible crossing places the edge of the tile beside it.
        const reach = Math.SQRT2 * (tileReach(original) + project.seam / 2);
        const points = pointedGuideCrossings(project, original, limit, reach);
        const pointed = this.closestPlacement(piece, reach + Math.SQRT2 * limit, points, accepts);
        if (pointed) return pointed;
      }
      if (contact) return contact;

      const guided = this.closestPlacement(piece, limit, contactProjections(parts, piece), accepts);
      const range = guided ? Math.hypot(guided.piece.x - piece.x, guided.piece.y - piece.y) : limit;
      const tileParts = [].concat(...tiles.map(tile => tile.parts));
      return this.closestPlacement(piece, range, contactProjections(tileParts, piece), accepts) || guided || original;
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

  function readProject(value) {
    const error = 'invalidProject';
    if (!value || value.version !== 1 || !validText(value.name, 80)) throw new ValidationError(error);
    const { board, grid, guides = [], tiles, pieces, seam, seamColor = DEFAULT_SEAM_COLOR } = value;
    if (!board || !boardShapes.includes(board.shape) ||
        !validNumber(board.width, 1, 10000) || !validNumber(board.height, 1, 10000) ||
        !validNumber(board.radius, 0, Math.min(board.width, board.height) / 2) ||
        (board.shape === 'circle' && board.width !== board.height) ||
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
    for (const piece of pieces) {
      if (!piece || !validText(piece.id, 100) || ids.has(piece.id) || !tileTypes.has(piece.tileId) ||
          !validNumber(piece.x, -5000, 5000) || !validNumber(piece.y, -5000, 5000) ||
          !validNumber(piece.angle, -360, 360)) throw new ValidationError(error);
      const clean = { id: piece.id, tileId: piece.tileId, x: piece.x, y: piece.y, angle: angleInDegrees(piece.angle) };
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
    fitsBoard, gridOrigin, guideFromDrag, lineSpacing, nearestGuide, nearestGuideAnchor, normalizeTileTags, outlinePath, pieceGeometry, pointInBoard, readProject,
    referenceWidthLimit, sampleOutline, sampleSegment, tileTagKey, triangleHeight, triangleHeightFromAngle, triangleApexAngle,
    validNumber, validReferenceDimensions
  };

  if (typeof module === 'object') module.exports = model;
  else window.MosaicGeometry = model;
}());
