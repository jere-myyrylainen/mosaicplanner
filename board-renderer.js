(function () {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';

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
    if (tile.shape === 'circle') return svgElement('circle', { r: halfWidth, ...props });
    if (tile.shape === 'triangle' || tile.shape === 'equilateral') return svgElement('polygon', {
      points: '0,' + -halfHeight + ' ' + halfWidth + ',' + halfHeight + ' ' + -halfWidth + ',' + halfHeight,
      ...props
    });
    return svgElement('rect', { x: -halfWidth, y: -halfHeight, width: tile.width, height: tile.height, ...props });
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
    if (elements) elements.clear();
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

  function renderBoard({ board, grid, guides }, layers) {
    const pattern = document.getElementById('grid-pattern');
    const lines = document.getElementById('grid-lines');
    const clip = document.getElementById('board-clip');
    const offset = -grid.size / 2;
    pattern.setAttribute('x', offset);
    pattern.setAttribute('y', offset);
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
    layers.guides.textContent = '';
    if (grid.guidesVisible) {
      const fragment = document.createDocumentFragment();
      for (const guide of guides) fragment.appendChild(guideShape(guide));
      layers.guides.appendChild(fragment);
    }
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

  window.MosaicBoard = { svgElement, pieceShape, guideShape, renderGrout, renderBoard, paintReference };
}());
