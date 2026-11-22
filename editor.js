(function () {
  'use strict';

  const Model = window.MosaicGeometry;
  const STORAGE_KEY = 'mosaic-planner.project.v1';
  const SVG = 'http://www.w3.org/2000/svg';
  const TOOLS = {
    select: ['Valitse', 'Valitse pala napsauttamalla. Siirrä vetämällä.'],
    draw: ['Vapaa piirto', 'Aseta pala napsauttamalla. Piirrä vetämällä.'],
    line: ['Viiva', 'Vedä viivan alusta loppuun.'],
    shape: ['Muoto', 'Vedä muodon vastakkaisten kulmien välillä.'],
    fill: ['Täyttö', 'Napsauta tyhjää aluetta, jonka haluat täyttää.'],
    pan: ['Siirrä näkymää', 'Siirrä näkymää vetämällä.']
  };

  const byId = id => document.getElementById(id);
  const canvas = byId('canvas');
  const stage = byId('stage');
  const layers = {
    board: byId('board-layer'),
    pieces: byId('piece-layer'),
    preview: byId('preview-layer'),
    selection: byId('selection-layer')
  };
  const newDialog = byId('new-dialog');
  const tileDialog = byId('tile-dialog');
  const format = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 2 });
  const countFormat = new Intl.NumberFormat('fi-FI');
  const past = [];
  const future = [];

  let project = restoreProject();
  let activeTileId = project.tiles[0].id;
  let selectedId = null;
  let editingTileId = null;
  let tool = 'draw';
  let placementIndex;
  let gesture = null;
  let spacePressed = false;
  let feedbackTimer;
  let zoom = 1;
  let viewCenter = { x: 0, y: 0 };
  let idSequence = 0;

  function restoreProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return Model.readProject(JSON.parse(saved));
    } catch {
      // A demo remains available when browser storage is disabled or unreadable.
    }
    return Model.demoProject();
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      byId('save-status').textContent = 'Tallennettu tähän selaimeen';
    } catch {
      byId('save-status').textContent = 'Paikallinen tallennus ei onnistu. Tallenna työ tiedostoksi.';
    }
  }

  function commit(next) {
    if (next === project) return;
    past.push(project);
    if (past.length > 40) past.shift();
    future.length = 0;
    useProject(next);
  }

  function useProject(next) {
    project = next;
    if (!project.tiles.some(tile => tile.id === activeTileId)) activeTileId = project.tiles[0].id;
    if (!project.pieces.some(piece => piece.id === selectedId)) selectedId = null;
    placementIndex = new Model.PlacementIndex(project);
    renderAll();
    persist();
  }

  function undo() {
    if (!past.length || gesture) return;
    future.push(project);
    useProject(past.pop());
  }

  function redo() {
    if (!future.length || gesture) return;
    past.push(project);
    useProject(future.pop());
  }

  function notify(message) {
    const feedback = byId('feedback');
    feedback.textContent = message;
    feedback.hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 4200);
  }

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    return element;
  }

  function icon(name) {
    const element = svgElement('svg', { class: 'icon', 'aria-hidden': 'true' });
    element.append(svgElement('use', { href: '#i-' + name }));
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
    if (tile.shape === 'triangle') return svgElement('polygon', {
      points: '0,' + -halfHeight + ' ' + halfWidth + ',' + halfHeight + ' ' + -halfWidth + ',' + halfHeight,
      ...props
    });
    return svgElement('rect', { x: -halfWidth, y: -halfHeight, width: tile.width, height: tile.height, ...props });
  }

  function renderBoard() {
    const { board, grid } = project;
    const pattern = byId('grid-pattern');
    const lines = byId('grid-lines');
    const offset = -grid.size / 2;
    pattern.setAttribute('x', offset);
    pattern.setAttribute('y', offset);
    pattern.setAttribute('width', grid.size);
    pattern.setAttribute('height', grid.size);
    lines.setAttribute('d', 'M0 0V' + grid.size + 'H' + grid.size + 'V0H0Z');
    lines.setAttribute('stroke-width', grid.weight);

    layers.board.replaceChildren(boardShape(board, { class: 'board-shadow', fill: '#fdfbf3' }));
    if (grid.visible) layers.board.append(boardShape(board, { fill: 'url(#grid-pattern)' }));
    layers.board.append(boardShape(board, { class: 'board-outline', fill: 'none', 'pointer-events': 'none' }));
  }

  function renderPieces() {
    const tileTypes = new Map(project.tiles.map(tile => [tile.id, tile]));
    const fragment = document.createDocumentFragment();
    for (const piece of project.pieces) {
      const tile = tileTypes.get(piece.tileId);
      fragment.append(pieceShape(piece, tile, { class: 'piece-face', fill: tile.color, 'data-piece': piece.id }));
    }
    layers.pieces.replaceChildren(fragment);
    byId('work-count').textContent = projectSizeText() + ' · ' + pieceCount(project.pieces.length);
  }

  function pieceCount(number) {
    return countFormat.format(number) + (number === 1 ? ' pala' : ' palaa');
  }

  function projectSizeText() {
    const { board } = project;
    if (board.shape === 'circle') return 'Ø ' + format.format(board.width) + ' mm';
    return format.format(board.width) + ' × ' + format.format(board.height) + ' mm';
  }

  function renderSettings() {
    const { board, grid, name, seam } = project;
    byId('project-name').value = name;
    document.querySelectorAll('[name="board-shape"]').forEach(input => { input.checked = input.value === board.shape; });
    byId('board-width-label').textContent = board.shape === 'circle' ? 'Halkaisija' : 'Leveys';
    byId('board-width').value = board.width;
    byId('board-height-field').hidden = board.shape === 'circle';
    byId('board-height').value = board.height;
    byId('board-radius-field').hidden = board.shape !== 'rounded';
    byId('board-radius').max = Math.min(board.width, board.height) / 2;
    byId('board-radius').value = board.radius;
    byId('seam-width').value = seam;
    byId('grid-size').value = grid.size;
    byId('grid-weight').value = grid.weight;
    byId('grid-visible').checked = grid.visible;
    byId('grid-snap').checked = grid.snap;
  }

  function renderLibrary() {
    const list = byId('tile-list');
    const fragment = document.createDocumentFragment();
    const focusedTileId = list.contains(document.activeElement) ? document.activeElement.dataset.tileChoice : null;
    let focusTarget;
    for (const tile of project.tiles) {
      const item = document.createElement('li');
      item.className = 'tile-row';
      const active = tile.id === activeTileId;
      item.classList.toggle('active', active);

      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'tile-choice';
      choice.dataset.tileChoice = tile.id;
      choice.setAttribute('aria-pressed', active);
      choice.addEventListener('click', () => {
        activeTileId = tile.id;
        if (tool === 'select' || tool === 'pan') setTool('draw');
        renderLibrary();
      });
      if (tile.id === focusedTileId) focusTarget = choice;

      const swatch = document.createElement('span');
      swatch.className = 'tile-swatch ' + tile.shape;
      swatch.style.setProperty('--tile-color', tile.color);
      swatch.setAttribute('aria-hidden', 'true');

      const caption = document.createElement('span');
      caption.className = 'tile-caption';
      const name = document.createElement('strong');
      name.textContent = tile.name;
      const size = document.createElement('small');
      size.textContent = tile.shape === 'circle' ? 'Ø ' + format.format(tile.width) + ' mm' :
        format.format(tile.width) + ' × ' + format.format(tile.height) + ' mm';
      caption.append(name, size);
      choice.append(swatch, caption);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-button edit-tile';
      edit.title = 'Muokkaa palatyyppiä';
      edit.setAttribute('aria-label', 'Muokkaa palatyyppiä ' + tile.name);
      edit.append(icon('edit'));
      edit.addEventListener('click', () => openTileDialog(tile));
      item.append(choice, edit);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function currentSelection() {
    return project.pieces.find(piece => piece.id === selectedId);
  }

  function renderSelection(piece = currentSelection(), valid = true) {
    layers.selection.replaceChildren();
    byId('selected-panel').hidden = !piece;
    if (!piece) return;
    const tile = placementIndex.tileTypes.get(piece.tileId);
    const outline = pieceShape(piece, tile, { class: 'selection-outline' });
    if (!valid) outline.style.stroke = '#a34032';
    layers.selection.append(outline);
    byId('selected-name').textContent = tile.name;
    byId('selected-angle').value = Math.round(piece.angle * 10) / 10;
  }

  function renderView() {
    const { board } = project;
    const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    if (!aspect) return;
    const margin = Math.max(board.width, board.height) * .12;
    const width = Math.max(board.width + margin, (board.height + margin) * aspect) / zoom;
    const height = width / aspect;
    canvas.setAttribute('viewBox', [
      viewCenter.x - width / 2, viewCenter.y - height / 2, width, height
    ].join(' '));
    byId('zoom-level').textContent = Math.round(zoom * 100) + ' %';
    byId('zoom-in').disabled = zoom >= 12;
    byId('zoom-out').disabled = zoom <= .25;
  }

  function renderAll() {
    layers.preview.replaceChildren();
    renderSettings();
    renderBoard();
    renderPieces();
    renderLibrary();
    renderSelection();
    renderView();
    byId('undo').disabled = past.length === 0;
    byId('redo').disabled = future.length === 0;
  }

  function setTool(name) {
    if (gesture) return;
    tool = name;
    stage.dataset.tool = name;
    document.querySelectorAll('[data-tool].tool').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.tool === name);
    });
    byId('tool-name').textContent = TOOLS[name][0];
    byId('tool-hint').textContent = TOOLS[name][1];
    byId('outline-field').hidden = name !== 'shape';
    if (name !== 'select') {
      selectedId = null;
      renderSelection();
    }
    layers.preview.replaceChildren();
  }

  function changeBoard(changes) {
    const board = { ...project.board, ...changes };
    if (board.shape === 'circle') board.height = board.width;
    board.radius = Math.min(board.radius, board.width / 2, board.height / 2);
    if (Object.keys(board).every(key => board[key] === project.board[key])) return;
    if (project.pieces.some(piece => !Model.fitsBoard(board, placementIndex.geometry(piece)))) {
      renderSettings();
      notify('Osa paloista jäisi alustan ulkopuolelle. Siirrä tai poista ne ennen muutosta.');
      return;
    }
    if (board.width !== project.board.width || board.height !== project.board.height) resetView();
    commit({ ...project, board });
  }

  function numericChange(id, oldValue, action) {
    const input = byId(id);
    input.addEventListener('change', () => {
      const number = input.valueAsNumber;
      if (!Model.validNumber(number, Number(input.min), Number(input.max))) {
        input.value = oldValue();
        notify('Anna arvo väliltä ' + format.format(Number(input.min)) + '–' + format.format(Number(input.max)) + '.');
        return;
      }
      if (number !== oldValue()) action(number);
    });
  }

  function bindSettings() {
    for (const input of document.querySelectorAll('#project-name, .settings input[type="number"]')) {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
    }
    byId('project-name').addEventListener('change', event => {
      const name = event.target.value.trim() || 'Nimetön mosaiikki';
      if (name !== project.name) commit({ ...project, name });
      else event.target.value = project.name;
    });

    for (const radio of document.querySelectorAll('[name="board-shape"]')) {
      radio.addEventListener('change', () => changeBoard({ shape: radio.value }));
    }
    for (const key of ['width', 'height', 'radius']) {
      numericChange('board-' + key, () => project.board[key], value => changeBoard({ [key]: value }));
    }
    numericChange('seam-width', () => project.seam, seam => {
      commit({ ...project, seam });
      if (project.pieces.length) notify('Sauman leveys muuttui seuraavia asetteluja varten.');
    });
    function changeGrid(key, value) {
      commit({ ...project, grid: { ...project.grid, [key]: value } });
    }
    for (const key of ['size', 'weight']) {
      numericChange('grid-' + key, () => project.grid[key], value => changeGrid(key, value));
    }
    for (const key of ['visible', 'snap']) {
      const input = byId('grid-' + key);
      input.addEventListener('change', () => changeGrid(key, input.checked));
    }
  }

  function nextId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return crypto.randomUUID();
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + idSequence++;
  }

  function updateTileShape() {
    const circle = byId('tile-shape').value === 'circle';
    byId('tile-width-label').textContent = circle ? 'Halkaisija' : 'Leveys';
    byId('tile-height-field').hidden = circle;
    byId('tile-height').disabled = circle;
  }

  function openTileDialog(tile) {
    if (!tile && project.tiles.length >= Model.MAX_TYPES) {
      notify('Palakirjastossa voi olla enintään ' + Model.MAX_TYPES + ' palatyyppiä.');
      return;
    }
    editingTileId = tile ? tile.id : null;
    byId('tile-dialog-title').textContent = tile ? 'Muokkaa palatyyppiä' : 'Lisää palatyyppi';
    byId('tile-name').value = tile ? tile.name : '';
    byId('tile-shape').value = tile ? tile.shape : 'rectangle';
    byId('tile-color').value = tile ? tile.color : '#347e73';
    byId('tile-width').value = tile ? tile.width : 10;
    byId('tile-height').value = tile ? tile.height : 10;
    byId('tile-error').hidden = true;
    updateTileShape();
    tileDialog.showModal();
  }

  function saveTile(event) {
    event.preventDefault();
    const name = byId('tile-name').value.trim();
    const shape = byId('tile-shape').value;
    const color = byId('tile-color').value;
    const width = byId('tile-width').valueAsNumber;
    const height = shape === 'circle' ? width : byId('tile-height').valueAsNumber;
    const error = byId('tile-error');

    if (!name) {
      error.textContent = 'Anna palatyypille nimi.';
      error.hidden = false;
      return;
    }
    const tile = { id: editingTileId || nextId('tile'), name, shape, color, width, height };
    const tiles = editingTileId ? project.tiles.map(old => old.id === tile.id ? tile : old) : [...project.tiles, tile];

    const previous = placementIndex.tileTypes.get(editingTileId);
    if (previous && (previous.shape !== shape || previous.width !== width || previous.height !== height)) {
      const changed = project.pieces.filter(piece => piece.tileId === tile.id);
      const unchanged = project.pieces.filter(piece => piece.tileId !== tile.id);
      const index = new Model.PlacementIndex({ ...project, tiles, pieces: unchanged });
      for (const piece of changed) {
        const geometry = index.geometry(piece);
        if (!index.accepts(geometry)) {
          error.textContent = 'Tällä koolla tai muodolla asetetut palat eivät mahdu nykyisille paikoilleen.';
          error.hidden = false;
          return;
        }
        index.add(geometry);
      }
    }
    activeTileId = tile.id;
    tileDialog.close();
    commit({ ...project, tiles });
  }

  function surfacePoint(event) {
    const matrix = canvas.getScreenCTM();
    const point = canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function snap(point) {
    if (!project.grid.snap) return { x: point.x, y: point.y };
    const size = project.grid.size;
    return {
      x: (Math.round(point.x / size + .5) - .5) * size,
      y: (Math.round(point.y / size + .5) - .5) * size
    };
  }

  function pieceAt(center, tile) {
    return { tileId: tile.id, x: center.x, y: center.y, angle: 0 };
  }

  function placeCandidate(action, point, snapToGrid) {
    if (action.placed.length >= action.limit) return;
    const candidate = pieceAt(snapToGrid ? snap(point) : point, action.tile);
    const geometry = action.index.geometry(candidate);
    if (!action.index.accepts(geometry)) return;
    action.index.add(geometry);
    action.placed.push(candidate);
  }

  function placementAction(tile, limit = Model.MAX_STROKE) {
    return {
      tile,
      limit: Math.min(limit, Model.MAX_PIECES - project.pieces.length),
      index: new Model.PlacementIndex(project),
      placed: []
    };
  }

  function finishPlacement(action) {
    if (!action.placed.length) return;
    const pieces = action.placed.map(piece => ({ ...piece, id: nextId('piece') }));
    commit({ ...project, pieces: project.pieces.concat(pieces) });
    if (pieces.length >= action.limit) notify('Toiminnolla lisättiin ' + pieceCount(pieces.length) + '.');
  }

  function previewPieces(pieces, tile, path) {
    const fragment = document.createDocumentFragment();
    if (path && path.length > 1) {
      fragment.append(svgElement('polyline', {
        points: path.map(point => point.x + ',' + point.y).join(' '), class: 'guide'
      }));
    }
    for (const piece of pieces.slice(0, 350)) {
      fragment.append(pieceShape(piece, tile, { class: 'preview-piece piece-face', fill: tile.color }));
    }
    layers.preview.replaceChildren(fragment);
  }

  function hoverPlacement(point) {
    const tile = placementIndex.tileTypes.get(activeTileId);
    const piece = pieceAt(snap(point), tile);
    previewPieces(placementIndex.accepts(placementIndex.geometry(piece)) ? [piece] : [], tile);
  }

  function fillAt(point, tile) {
    const action = placementAction(tile);
    if (!action.limit) {
      notify('Työssä on jo enimmäismäärä paloja.');
      return;
    }
    const start = snap(point);
    const horizontal = tile.width + project.seam;
    const vertical = tile.height + project.seam;
    const queue = [[0, 0]];
    const seen = new Set(['0/0']);
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = 0; i < queue.length && action.placed.length < action.limit; i++) {
      const [column, row] = queue[i];
      const previousCount = action.placed.length;
      placeCandidate(action, { x: start.x + column * horizontal, y: start.y + row * vertical }, false);
      if (action.placed.length === previousCount) continue;
      for (const [dx, dy] of directions) {
        const neighbor = [column + dx, row + dy];
        const key = neighbor.join('/');
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(neighbor);
        }
      }
    }
    if (action.placed.length) finishPlacement(action);
    else notify('Valitse kohta, johon mahtuu kokonainen pala.');
  }

  function beginPointer(event) {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    if (tileDialog.open) return;
    const point = surfacePoint(event);
    const pan = tool === 'pan' || spacePressed || event.button === 1;
    const tile = placementIndex.tileTypes.get(activeTileId);
    layers.preview.replaceChildren();

    if (pan) {
      const screenMatrix = canvas.getScreenCTM();
      gesture = {
        kind: 'pan', screenX: event.clientX, screenY: event.clientY, viewCenter: { ...viewCenter },
        scaleX: screenMatrix.a, scaleY: screenMatrix.d
      };
      stage.classList.add('is-panning');
    } else if (tool === 'select') {
      const element = event.target.closest('[data-piece]');
      selectedId = element ? element.dataset.piece : null;
      renderSelection();
      const selected = currentSelection();
      if (!selected) return;
      gesture = {
        kind: 'move', origin: point, selected, element, index: new Model.PlacementIndex(project, selected.id)
      };
    } else if (tool === 'fill') {
      fillAt(point, tile);
      return;
    } else if (tool === 'draw') {
      const action = placementAction(tile);
      if (!action.limit) {
        notify('Työssä on jo enimmäismäärä paloja.');
        return;
      }
      placeCandidate(action, point, true);
      gesture = { kind: 'draw', previous: point, phase: 1, action };
      previewPieces(action.placed, tile);
    } else {
      gesture = { kind: tool, start: snap(point), lastPoint: point, tile };
    }
    gesture.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function drawingGuide(current, end) {
    const { start, tile } = current;
    if (current.kind === 'line') {
      const spacing = Model.lineSpacing(tile, project.seam, start, end);
      return { path: [start, end], points: Model.sampleSegment(start, end, spacing).points };
    }
    const path = Model.outlinePath(byId('outline-shape').value, start, end);
    return { path, points: Model.sampleOutline(tile, project.seam, path) };
  }

  function updateGesture(event) {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.kind === 'pan') {
      viewCenter.x = current.viewCenter.x - (event.clientX - current.screenX) / current.scaleX;
      viewCenter.y = current.viewCenter.y - (event.clientY - current.screenY) / current.scaleY;
      renderView();
      return;
    }
    const point = surfacePoint(event);
    if (current.kind === 'move') {
      const dx = point.x - current.origin.x;
      const dy = point.y - current.origin.y;
      if (!current.candidate && Math.hypot(dx, dy) < .4) return;
      const position = snap({ x: current.selected.x + dx, y: current.selected.y + dy });
      const candidate = { ...current.selected, ...position };
      current.candidate = candidate;
      current.valid = current.index.accepts(current.index.geometry(candidate));
      current.element.style.opacity = '.3';
      renderSelection(candidate, current.valid);
    } else if (current.kind === 'draw') {
      const { action, previous } = current;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1e-7) return;
      const spacing = Model.lineSpacing(action.tile, project.seam, previous, point);
      const sample = Model.sampleSegment(previous, point, spacing, spacing * current.phase);
      for (const center of sample.points) placeCandidate(action, center, true);
      current.previous = point;
      current.phase = sample.limited ? 1 : sample.nextDistance / spacing;
      previewPieces(action.placed, action.tile);
    } else {
      current.lastPoint = point;
      const guide = drawingGuide(current, snap(point));
      const action = placementAction(current.tile, 350);
      for (const center of guide.points) placeCandidate(action, center, true);
      previewPieces(action.placed, current.tile, guide.path);
    }
  }

  function movePointer(event) {
    if (gesture) updateGesture(event);
    else if (tool === 'draw' && !spacePressed) hoverPlacement(surfacePoint(event));
  }

  function endPointer(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = gesture;
    if (event.type === 'pointerup') updateGesture(event);
    gesture = null;
    stage.classList.remove('is-panning');
    layers.preview.replaceChildren();

    if (current.kind === 'move') {
      current.element.style.opacity = '';
      if (event.type === 'pointerup' && current.candidate && current.valid) {
        updateSelected(current.candidate);
      } else {
        if (event.type === 'pointerup' && current.candidate) notify('Pala ei mahdu tähän kohtaan.');
        renderSelection();
      }
      return;
    }
    if (event.type !== 'pointerup' || current.kind === 'pan') return;
    if (current.kind === 'draw') {
      if (current.action.placed.length) finishPlacement(current.action);
      else notify('Pala ei mahdu tähän kohtaan.');
      return;
    }
    const guide = drawingGuide(current, snap(current.lastPoint));
    const action = placementAction(current.tile);
    for (const point of guide.points) placeCandidate(action, point, true);
    if (action.placed.length) finishPlacement(action);
    else notify('Valitulle viivalle ei mahtunut paloja.');
  }

  function updateSelected(candidate) {
    const pieces = project.pieces.map(piece => piece.id === candidate.id ? candidate : piece);
    commit({ ...project, pieces });
  }

  function rotateSelected(angle) {
    const selected = currentSelection();
    if (!selected) return;
    if (!Number.isFinite(angle)) {
      renderSelection();
      return;
    }
    const candidate = { ...selected, angle: Model.angleInDegrees(angle) };
    if (candidate.angle === selected.angle) {
      renderSelection();
      return;
    }
    const index = new Model.PlacementIndex(project, selected.id);
    if (index.accepts(index.geometry(candidate))) updateSelected(candidate);
    else {
      notify('Pala ei mahdu kääntymään tässä kohdassa.');
      renderSelection();
    }
  }

  function removeSelected() {
    if (!currentSelection() || gesture) return;
    const pieces = project.pieces.filter(piece => piece.id !== selectedId);
    selectedId = null;
    commit({ ...project, pieces });
  }

  function resetView() {
    zoom = 1;
    viewCenter = { x: 0, y: 0 };
    renderView();
  }

  function changeZoom(factor, event) {
    const nextZoom = Math.min(12, Math.max(.25, zoom * factor));
    if (event && zoom !== nextZoom) {
      const point = surfacePoint(event);
      const ratio = zoom / nextZoom;
      viewCenter.x = point.x + (viewCenter.x - point.x) * ratio;
      viewCenter.y = point.y + (viewCenter.y - point.y) * ratio;
    }
    zoom = nextZoom;
    renderView();
    layers.preview.replaceChildren();
  }

  function exportProject() {
    const name = (byId('project-name').value.trim() || 'Nimetön mosaiikki').slice(0, 80);
    if (name !== project.name) commit({ ...project, name });
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = project.name.replace(/[^\p{L}\p{N} _-]/gu, '-').trim() + '.mosaic.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Työ tallennettiin JSON-tiedostoksi.');
  }

  async function importProject(event) {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      notify('Valitse enintään 8 Mt:n kokoinen Mosaic Planner -tiedosto.');
      return;
    }
    let restored;
    try {
      restored = Model.readProject(JSON.parse(await file.text()));
    } catch (error) {
      notify(error instanceof SyntaxError ? 'Tiedostoa ei voitu lukea JSON-muodossa.' : error.message);
      return;
    }
    if (gesture) {
      notify('Lopeta käynnissä oleva piirto ja avaa tiedosto uudelleen.');
      return;
    }
    selectedId = null;
    resetView();
    commit(restored);
    setTool('draw');
    notify('Työ avattu.');
  }

  function newProject() {
    selectedId = null;
    resetView();
    commit(Model.blankProject(project.tiles));
    setTool('draw');
    byId('project-name').focus();
    byId('project-name').select();
  }

  function onKeyDown(event) {
    if (tileDialog.open || newDialog.open) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 's') {
      event.preventDefault();
      exportProject();
      return;
    }
    if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (event.metaKey || event.ctrlKey) {
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        if (event.shiftKey || key === 'y') redo();
        else undo();
      }
      return;
    }
    if (gesture) return;
    if (event.code === 'Space') {
      if (event.target.closest('button')) return;
      event.preventDefault();
      spacePressed = true;
      stage.classList.add('pan-ready');
      layers.preview.replaceChildren();
      return;
    }
    const shortcuts = { v: 'select', b: 'draw', l: 'line', m: 'shape', g: 'fill', h: 'pan' };
    if (shortcuts[key]) setTool(shortcuts[key]);
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      removeSelected();
    }
    if (key === 'r' && currentSelection()) rotateSelected(currentSelection().angle + 15);
    if (key === 'escape') {
      selectedId = null;
      renderSelection();
    }
  }

  function stopSpacePan() {
    spacePressed = false;
    stage.classList.remove('pan-ready');
  }

  bindSettings();
  document.querySelectorAll('[data-tool].tool').forEach(button => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  byId('add-tile-text').addEventListener('click', () => openTileDialog());
  byId('close-dialog').addEventListener('click', () => tileDialog.close());
  byId('cancel-tile').addEventListener('click', () => tileDialog.close());
  byId('tile-shape').addEventListener('change', updateTileShape);
  byId('tile-form').addEventListener('submit', saveTile);
  byId('undo').addEventListener('click', undo);
  byId('redo').addEventListener('click', redo);
  byId('rotate').addEventListener('click', () => {
    const selected = currentSelection();
    if (selected) rotateSelected(selected.angle + 15);
  });
  byId('selected-angle').addEventListener('change', event => rotateSelected(event.target.valueAsNumber));
  byId('delete-piece').addEventListener('click', removeSelected);
  byId('zoom-in').addEventListener('click', () => changeZoom(1.25));
  byId('zoom-out').addEventListener('click', () => changeZoom(.8));
  byId('zoom-fit').addEventListener('click', resetView);
  byId('new-project').addEventListener('click', () => {
    if (project.pieces.length) {
      newDialog.returnValue = '';
      newDialog.showModal();
    } else newProject();
  });
  newDialog.addEventListener('close', () => {
    if (newDialog.returnValue === 'new') newProject();
  });
  byId('save-project').addEventListener('click', exportProject);
  byId('open-project').addEventListener('click', () => byId('import-file').click());
  byId('import-file').addEventListener('change', importProject);

  stage.addEventListener('wheel', event => {
    if (gesture || event.target.closest('.zoom-controls')) return;
    event.preventDefault();
    changeZoom(Math.exp(Math.min(.25, Math.max(-.25, -event.deltaY * .002))), event);
  }, { passive: false });
  canvas.addEventListener('pointerdown', beginPointer);
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (!gesture) layers.preview.replaceChildren();
  });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', event => {
    if (event.code === 'Space') stopSpacePan();
  });
  window.addEventListener('blur', stopSpacePan);
  new ResizeObserver(renderView).observe(stage);

  useProject(project);
  setTool('draw');
}());
