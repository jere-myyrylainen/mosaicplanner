(function () {
  'use strict';

  const Model = window.MosaicGeometry;
  const STORAGE_KEY = 'mosaic-planner.project.v1';
  const SVG = 'http://www.w3.org/2000/svg';
  const TOOLS = {
    select: ['Valitse', 'Rajaa palat vetämällä tyhjästä kohdasta tai valitse ne Shift-napsautuksilla. Siirrä valintaa vetämällä palasta.'],
    draw: ['Vapaa piirto', 'Aseta pala napsauttamalla. Piirrä vetämällä.'],
    line: ['Viiva', 'Vedä viivan alusta loppuun.'],
    shape: ['Muoto', 'Vedä muodon vastakkaisten kulmien välillä.'],
    fill: ['Täyttö', 'Napsauta tyhjää aluetta, jonka haluat täyttää.'],
    erase: ['Pyyhekumi', 'Poista pala napsauttamalla tai poista useita paloja vetämällä.'],
    pan: ['Siirrä näkymää', 'Siirrä näkymää vetämällä.']
  };
  const tileTools = new Set(['draw', 'line', 'shape', 'fill']);

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
  const pieceElements = new Map();

  let project = restoreProject();
  let activeTileId;
  let selectedIds = new Set();
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
    if (next.tiles.some(tile => tile.archived)) {
      const inUse = new Set(next.pieces.map(piece => piece.tileId));
      next = { ...next, tiles: next.tiles.filter(tile => !tile.archived || inUse.has(tile.id)) };
    }
    project = next;
    if (!project.tiles.some(tile => tile.id === activeTileId && !tile.archived)) {
      activeTileId = project.tiles.find(tile => !tile.archived)?.id;
    }
    if (selectedIds.size) {
      selectedIds = new Set(currentSelection().map(piece => piece.id));
    }
    placementIndex = new Model.PlacementIndex(project);
    renderTools();
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
    pieceElements.clear();
    for (const piece of project.pieces) {
      const tile = tileTypes.get(piece.tileId);
      const element = pieceShape(piece, tile, { class: 'piece-face', fill: tile.color, 'data-piece': piece.id });
      pieceElements.set(piece.id, element);
      fragment.append(element);
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
      if (tile.archived) continue;
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
        if (tool === 'select' || tool === 'pan' || tool === 'erase') setTool('draw');
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
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button remove-tile delete-button';
      remove.title = 'Poista palakirjastosta';
      remove.setAttribute('aria-label', 'Poista palakirjastosta ' + tile.name);
      remove.append(icon('delete'));
      remove.addEventListener('click', () => removeTileFromLibrary(tile));
      item.append(choice, edit, remove);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    byId('empty-library').hidden = list.childElementCount > 0;
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function removeTileFromLibrary(tile) {
    if (gesture) return;
    const tiles = project.tiles.map(entry => entry.id === tile.id ? { ...entry, archived: true } : entry);
    const inUse = project.pieces.some(piece => piece.tileId === tile.id);
    commit({ ...project, tiles });
    const nextControl = byId('tile-list').querySelector('.tile-row.active .tile-choice') || byId('add-tile-text');
    nextControl.focus({ preventScroll: true });
    notify(inUse ? 'Palatyyppi poistettiin kirjastosta. Asetetut palat ovat edelleen työssä.' :
      'Palatyyppi poistettiin kirjastosta.');
  }

  function currentSelection() {
    return selectedIds.size ? project.pieces.filter(piece => selectedIds.has(piece.id)) : [];
  }

  function singleSelectedPiece() {
    return selectedIds.size === 1 ? currentSelection()[0] : undefined;
  }

  function renderSelection() {
    const pieces = currentSelection();
    const fragment = document.createDocumentFragment();
    for (const piece of pieces) {
      const tile = placementIndex.tileTypes.get(piece.tileId);
      fragment.append(pieceShape(piece, tile, { class: 'selection-outline' }));
    }
    layers.selection.replaceChildren(fragment);
    byId('selected-panel').hidden = pieces.length === 0;
    if (!pieces.length) return;
    const single = pieces.length === 1;
    byId('selected-title').textContent = single ? 'Valittu pala' : 'Valitut palat';
    byId('selected-name').textContent = single ? placementIndex.tileTypes.get(pieces[0].tileId).name : pieceCount(pieces.length);
    byId('selected-angle-field').hidden = !single;
    byId('rotate').hidden = !single;
    byId('delete-piece-label').textContent = single ? 'Poista pala' : 'Poista valitut';
    if (single) byId('selected-angle').value = Math.round(pieces[0].angle * 10) / 10;
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
    if (gesture || (!activeTileId && tileTools.has(name))) return;
    tool = name;
    if (name !== 'select') {
      selectedIds.clear();
      renderSelection();
    }
    renderTools();
    layers.preview.replaceChildren();
  }

  function renderTools() {
    if (!activeTileId && tileTools.has(tool)) tool = 'select';
    stage.dataset.tool = tool;
    document.querySelectorAll('[data-tool].tool').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.tool === tool);
      button.disabled = !activeTileId && tileTools.has(button.dataset.tool);
    });
    byId('tool-name').textContent = TOOLS[tool][0];
    byId('tool-hint').textContent = TOOLS[tool][1];
    byId('outline-field').hidden = tool !== 'shape';
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
    const shouldStartDrawing = !activeTileId;
    activeTileId = tile.id;
    tileDialog.close();
    commit({ ...project, tiles });
    if (shouldStartDrawing && !selectedIds.size) setTool('draw');
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

  function applySelection(ids) {
    if (ids.size === selectedIds.size && [...ids].every(id => selectedIds.has(id))) return;
    selectedIds = ids;
    renderSelection();
  }

  function beginSelection(event, origin) {
    const id = event.target.closest('[data-piece]')?.dataset.piece;
    if (id && event.shiftKey) {
      const ids = new Set(selectedIds);
      if (!ids.delete(id)) ids.add(id);
      applySelection(ids);
      return;
    }

    if (id) {
      if (!selectedIds.has(id)) applySelection(new Set([id]));
      const pieces = currentSelection();
      return { kind: 'move', origin, pieces, anchor: pieces.find(piece => piece.id === id) };
    }

    const original = selectedIds;
    const base = event.shiftKey ? original : new Set();
    applySelection(base);
    return { kind: 'marquee', origin, original, base };
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
      gesture = beginSelection(event, point);
      if (!gesture) return;
    } else if (tool === 'erase') {
      gesture = { kind: 'erase', previous: point, erased: new Set() };
      const element = event.target.closest('[data-piece]');
      if (element) erasePiece(gesture, element.dataset.piece);
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

  function erasePiece(current, id) {
    if (current.erased.has(id)) return;
    current.erased.add(id);
    pieceElements.get(id)?.classList.add('erased-piece');
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

  function updateMarquee(current, point) {
    const { origin, base } = current;
    const minX = Math.min(origin.x, point.x);
    const minY = Math.min(origin.y, point.y);
    const maxX = Math.max(origin.x, point.x);
    const maxY = Math.max(origin.y, point.y);
    layers.preview.replaceChildren(svgElement('rect', {
      x: minX, y: minY, width: maxX - minX, height: maxY - minY, class: 'selection-marquee'
    }));
    const ids = new Set(base);
    for (const piece of placementIndex.piecesWithin({ minX, minY, maxX, maxY })) ids.add(piece.id);
    applySelection(ids);
  }

  function translatePiece(piece, { x, y }) {
    return { ...piece, x: piece.x + x, y: piece.y + y };
  }

  function previewMove(current, point) {
    const { anchor, origin, pieces } = current;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (!current.index && Math.hypot(dx, dy) < .4) return;
    if (!current.index) {
      current.index = new Model.PlacementIndex(project, selectedIds);
      for (const piece of pieces) pieceElements.get(piece.id).classList.add('moving-piece');
    }
    const position = snap({ x: anchor.x + dx, y: anchor.y + dy });
    const offset = { x: position.x - anchor.x, y: position.y - anchor.y };
    if (offset.x === current.offset?.x && offset.y === current.offset?.y) return;
    current.offset = offset;
    current.valid = (!offset.x && !offset.y) || pieces.every(piece =>
      current.index.accepts(current.index.geometry(translatePiece(piece, offset))));
    layers.selection.setAttribute('transform', 'translate(' + offset.x + ' ' + offset.y + ')');
    layers.selection.classList.toggle('invalid-selection', !current.valid);
  }

  function finishMove(current, released) {
    if (!current.index) return;
    layers.selection.removeAttribute('transform');
    layers.selection.classList.remove('invalid-selection');
    for (const piece of current.pieces) pieceElements.get(piece.id)?.classList.remove('moving-piece');
    if (!released || (!current.offset.x && !current.offset.y)) return;
    if (!current.valid) {
      notify(current.pieces.length === 1 ? 'Pala ei mahdu tähän kohtaan.' : 'Valitut palat eivät mahdu tähän kohtaan.');
      return;
    }
    const pieces = project.pieces.map(piece => selectedIds.has(piece.id) ? translatePiece(piece, current.offset) : piece);
    commit({ ...project, pieces });
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
      previewMove(current, point);
    } else if (current.kind === 'marquee') {
      updateMarquee(current, point);
    } else if (current.kind === 'erase') {
      if (point.x === current.previous.x && point.y === current.previous.y) return;
      for (const piece of placementIndex.piecesAlong(current.previous, point)) erasePiece(current, piece.id);
      current.previous = point;
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
      finishMove(current, event.type === 'pointerup');
      return;
    }
    if (current.kind === 'marquee') {
      if (event.type !== 'pointerup') applySelection(current.original);
      return;
    }
    if (current.kind === 'erase') {
      if (event.type === 'pointerup' && current.erased.size) {
        const pieces = project.pieces.filter(piece => !current.erased.has(piece.id));
        commit({ ...project, pieces });
      } else {
        for (const id of current.erased) pieceElements.get(id)?.classList.remove('erased-piece');
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
    const selected = singleSelectedPiece();
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
    const index = new Model.PlacementIndex(project, selectedIds);
    if (index.accepts(index.geometry(candidate))) updateSelected(candidate);
    else {
      notify('Pala ei mahdu kääntymään tässä kohdassa.');
      renderSelection();
    }
  }

  function removeSelected() {
    if (!selectedIds.size || gesture) return;
    const pieces = project.pieces.filter(piece => !selectedIds.has(piece.id));
    selectedIds.clear();
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
    selectedIds.clear();
    resetView();
    commit(restored);
    setTool('draw');
    notify('Työ avattu.');
  }

  function newProject() {
    selectedIds.clear();
    resetView();
    commit(Model.blankProject(project.tiles.filter(tile => !tile.archived)));
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
    const shortcuts = { v: 'select', b: 'draw', l: 'line', m: 'shape', g: 'fill', e: 'erase', h: 'pan' };
    if (shortcuts[key]) setTool(shortcuts[key]);
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      removeSelected();
    }
    if (key === 'r') rotateByStep();
    if (key === 'escape') {
      applySelection(new Set());
    }
  }

  function stopSpacePan() {
    spacePressed = false;
    stage.classList.remove('pan-ready');
  }

  function rotateByStep() {
    const selected = singleSelectedPiece();
    if (selected) rotateSelected(selected.angle + 15);
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
  byId('rotate').addEventListener('click', rotateByStep);
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
