(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const polygonPoints = new WeakMap();

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    return element;
  }

  function boardShape(board, attributes) {
    if (board.shape === 'circle') return svgElement('circle', { r: board.width / 2, ...attributes });
    return svgElement('rect', {
      x: -board.width / 2, y: -board.height / 2, width: board.width, height: board.height,
      rx: board.shape === 'rounded' ? board.radius : 0, ...attributes
    });
  }

  function pieceShape(piece, tile, attributes) {
    const halfWidth = tile.width / 2;
    const halfHeight = tile.height / 2;
    const transform = 'translate(' + piece.x + ' ' + piece.y + ') rotate(' + piece.angle + ')';
    const props = { transform, ...attributes };
    if (!piece.outline && tile.shape === 'circle') return svgElement('circle', { r: halfWidth, ...props });
    if (!piece.outline && tile.shape === 'rectangle') {
      return svgElement('rect', { x: -halfWidth, y: -halfHeight, width: tile.width, height: tile.height, ...props });
    }
    const key = piece.outline || tile;
    if (!polygonPoints.has(key)) {
      const vertices = piece.outline || window.MosaicGeometry.tileVertices(tile);
      polygonPoints.set(key, vertices.map(({ x, y }) => x + ',' + y).join(' '));
    }
    return svgElement('polygon', { points: polygonPoints.get(key), ...props });
  }

  function guideShape(guide, attributes) {
    const { x, y } = guide;
    const props = {
      fill: 'none', stroke: '#345794', 'stroke-width': 1.5, 'stroke-dasharray': '5 4',
      'vector-effect': 'non-scaling-stroke', ...attributes
    };
    if (guide.shape === 'line') return svgElement('line', { x1: x, y1: y, x2: guide.endX, y2: guide.endY, ...props });
    if (guide.shape === 'circle') return svgElement('circle', { cx: x, cy: y, r: guide.radius, ...props });
    return svgElement('rect', { x, y, width: guide.size, height: guide.size, ...props });
  }

  function renderGrout({ pieces, seam, seamColor }, tileTypes, layer, elements) {
    if (!layer) return;
    layer.textContent = '';
    if (!seam || !seamColor) return;

    // The two half-strokes outside adjacent faces make up one full-width joint.
    layer.setAttribute('fill', 'none');
    layer.setAttribute('stroke', seamColor);
    layer.setAttribute('stroke-width', seam);
    layer.setAttribute('stroke-linejoin', 'round');
    const fragment = document.createDocumentFragment();
    for (const piece of pieces) {
      const shape = pieceShape(piece, tileTypes.get(piece.tileId));
      if (elements) elements.set(piece.id, shape);
      fragment.appendChild(shape);
    }
    layer.appendChild(fragment);
  }

  function paintGridPosition(grid, pattern = document.getElementById('grid-pattern')) {
    const { x, y } = window.MosaicGeometry.gridOrigin(grid);
    pattern.setAttribute('x', x);
    pattern.setAttribute('y', y);
  }

  function renderBoard({ board, grid, guides, worktable }, layers) {
    const pattern = document.getElementById('grid-pattern');
    const lines = document.getElementById('grid-lines');
    const clip = document.getElementById('board-clip');
    paintGridPosition(grid, pattern);
    pattern.setAttribute('width', grid.size);
    pattern.setAttribute('height', grid.size);
    lines.setAttribute('d', 'M0 0V' + grid.size + 'H' + grid.size + 'V0H0Z');
    lines.setAttribute('stroke-width', grid.weight);

    layers.board.textContent = '';
    layers.board.appendChild(boardShape(board, { class: 'board-shadow', fill: '#fdfbf3' }));
    clip.textContent = '';
    clip.appendChild(boardShape(board, {}));
    layers.grid.textContent = '';
    if (grid.visible) layers.grid.appendChild(boardShape(board, { fill: 'url(#grid-pattern)' }));
    layers.grid.appendChild(boardShape(board, { class: 'board-outline', fill: 'none' }));
    if (layers.worktable) {
      layers.worktable.textContent = '';
      layers.worktableClip.textContent = '';
      const bounds = window.MosaicGeometry.worktableBounds(board, worktable);
      if (bounds) {
        const rect = { x: bounds.minX, y: bounds.minY, width: worktable, height: worktable };
        layers.worktable.appendChild(svgElement('rect', { ...rect, class: 'board-shadow board-outline', fill: '#e2ebe2' }));
        layers.worktableClip.appendChild(svgElement('rect', rect));
      }
    }
    layers.guides.textContent = '';
    if (grid.guidesVisible) {
      const fragment = document.createDocumentFragment();
      for (const guide of guides) fragment.appendChild(guideShape(guide));
      layers.guides.appendChild(fragment);
    }
  }

  function renderBoardRulers(layer, board, anchors, unitsPerPixel, format) {
    const fragment = document.createDocumentFragment();
    const left = -board.width / 2;
    const top = -board.height / 2;
    const rulerX = left - 8 * unitsPerPixel;
    const rulerY = top - 8 * unitsPerPixel;

    function addRuler(span, horizontal) {
      const start = horizontal ? left : top;
      const step = span / 10;
      const spacing = step / unitsPerPixel;
      const labels = Array.from({ length: 11 }, (_, index) => format(span * index / 10));
      const labelWidth = Math.max(...labels.map(label => label.length)) * 7;
      const rotate = horizontal && spacing < labelWidth + 4;
      const every = Math.ceil((horizontal && !rotate ? labelWidth + 4 : 12) / spacing);
      const rail = svgElement('g', { class: 'board-ruler' });
      rail.appendChild(svgElement('line', horizontal ?
        { x1: left, x2: -left, y1: rulerY, y2: rulerY } :
        { x1: rulerX, x2: rulerX, y1: top, y2: -top }));

      labels.forEach((label, index) => {
        const coordinate = index === 10 ? start + span : start + step * index;
        const x = horizontal ? coordinate : rulerX;
        const y = horizontal ? rulerY : coordinate;
        const tick = svgElement('g', { transform: 'translate(' + x + ' ' + y + ') scale(' + unitsPerPixel + ')' });
        tick.appendChild(svgElement('line', horizontal ? { y2: 4 } : { x2: 4 }));
        if (index === 10 || (index % every === 0 && index + every <= 10)) {
          const attributes = horizontal ? { y: -5, 'text-anchor': 'middle' } : { x: -5, y: 3.5, 'text-anchor': 'end' };
          const text = svgElement('text', rotate ? { transform: 'translate(3.5 -5) rotate(-90)' } : attributes);
          text.textContent = label;
          tick.appendChild(text);
        }
        rail.appendChild(tick);
      });
      fragment.appendChild(rail);
    }

    addRuler(board.width, true);
    addRuler(board.height, false);
    const unit = svgElement('text', {
      class: 'board-ruler', x: left - 14 * unitsPerPixel, y: rulerY - 5 * unitsPerPixel,
      'font-size': 11 * unitsPerPixel, 'text-anchor': 'end'
    });
    unit.textContent = 'mm';
    fragment.appendChild(unit);

    const marks = [];
    let lastMark;
    for (const { x, y } of anchors) {
      if (lastMark && Math.hypot(x - lastMark.x, y - lastMark.y) < 6 * unitsPerPixel) continue;
      marks.push('M' + x + ' ' + y + 'h0');
      lastMark = { x, y };
    }
    fragment.appendChild(svgElement('path', { class: 'guide-anchors', d: marks.join('') }));
    layer.textContent = '';
    layer.appendChild(fragment);
  }

  function paintReference(element, reference) {
    const height = reference.width * reference.pixelHeight / reference.pixelWidth;
    element.setAttribute('x', reference.x - reference.width / 2);
    element.setAttribute('y', reference.y - height / 2);
    element.setAttribute('width', reference.width);
    element.setAttribute('height', height);
    element.setAttribute('opacity', reference.opacity);
    element.setAttribute('visibility', reference.visible ? 'visible' : 'hidden');
  }

  window.MosaicBoard = { svgElement, pieceShape, guideShape, renderGrout, renderBoard, renderBoardRulers, paintGridPosition, paintReference };
}());
