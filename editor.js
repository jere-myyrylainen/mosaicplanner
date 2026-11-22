(function () {
  'use strict';

  const Model = window.MosaicGeometry;
  const Storage = window.MosaicStorage;
  const I18n = window.MosaicI18n;
  const t = I18n.text;
  const MAX_PROJECT_FILE = 32 * 1024 * 1024;
  const LIBRARY_ORDER_KEY = 'mosaic-planner.library-order';
  const LIBRARY_WIDTH_KEY = 'mosaic-planner.library-width';
  const SVG = 'http://www.w3.org/2000/svg';
  const tileTools = new Set(['draw', 'line', 'shape', 'fill']);
  const colorFamilies = [
    'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'white', 'gray', 'black'
  ];

  const byId = id => document.getElementById(id);
  const editor = document.querySelector('.editor');
  const settings = document.querySelector('.settings');
  const canvas = byId('canvas');
  const stage = byId('stage');
  const layers = {
    board: byId('board-layer'),
    references: byId('reference-layer'),
    grid: byId('grid-layer'),
    pieces: byId('piece-layer'),
    preview: byId('preview-layer'),
    selection: byId('selection-layer')
  };
  const newDialog = byId('new-dialog');
  const tileDialog = byId('tile-dialog');
  const library = byId('tile-library');
  const libraryResizer = byId('library-resizer');
  const stackedLayout = window.matchMedia('(max-width: 760px)');
  const past = [];
  const future = [];
  const pieceElements = new Map();
  const referenceElements = new Map();
  const libraryFilters = { size: '', color: '', tags: new Set() };

  I18n.initialize();
  let project = Model.demoProject(t('demoProject'), {
    spruce: t('demoSpruce'), jade: t('demoJade'), sand: t('demoSand'),
    clay: t('demoClay'), ivory: t('demoIvory')
  });
  let projectGeneration = 0;
  let saveGeneration = 0;
  let saveStatus;
  let activeReferenceId;
  let renderedReferences;
  let addingReferences = false;
  let libraryOrder = restoreLibraryOrder();
  let libraryWidth = restoreLibraryWidth();
  let libraryResize = null;
  let librarySource;
  let availableTiles = [];
  let libraryTileColors = new Map();
  let activeTileId;
  let selectedIds = new Set();
  let editingTileId = null;
  let tool = 'draw';
  let placementIndex;
  let gesture = null;
  let spacePressed = false;
  let feedbackTimer;
  let feedbackMessages;
  let feedbackValues;
  let zoom = 1;
  let viewCenter = { x: 0, y: 0 };
  let idSequence = 0;

  function restoreLibraryOrder() {
    try {
      const order = localStorage.getItem(LIBRARY_ORDER_KEY);
      if (order === 'name-asc' || order === 'name-desc') return order;
    } catch {
      // The chosen order can still be used until the editor is closed.
    }
    return 'added';
  }

  function restoreLibraryWidth() {
    try {
      const width = Number(localStorage.getItem(LIBRARY_WIDTH_KEY));
      if (Number.isFinite(width) && width > 0) return width;
    } catch {
      // The width can still be adjusted for this session.
    }
    return null;
  }

  function persistLibraryWidth() {
    try {
      if (libraryWidth === null) localStorage.removeItem(LIBRARY_WIDTH_KEY);
      else localStorage.setItem(LIBRARY_WIDTH_KEY, libraryWidth);
    } catch {
      // The editor still uses the adjusted width when browser storage is unavailable.
    }
  }

  function libraryWidthLimits() {
    const stacked = stackedLayout.matches;
    const min = stacked ? 144 : 178;
    const reserved = stacked ? 144 : settings.offsetWidth + 330;
    const max = Math.max(min, Math.min(640, editor.clientWidth - reserved));
    return { min, max };
  }

  function clampLibraryWidth(width, { min, max }) {
    return Math.round(Math.max(min, Math.min(width, max)));
  }

  function renderLibraryWidth() {
    const limits = libraryWidthLimits();
    if (libraryWidth === null) editor.style.removeProperty('--library-width');
    else editor.style.setProperty('--library-width', clampLibraryWidth(libraryWidth, limits) + 'px');
    const actualWidth = library.offsetWidth;
    libraryResizer.setAttribute('aria-valuemin', limits.min);
    libraryResizer.setAttribute('aria-valuemax', limits.max);
    libraryResizer.setAttribute('aria-valuenow', actualWidth);
    libraryResizer.setAttribute('aria-valuetext', t('pixelWidth', { count: actualWidth }));
  }

  function moveLibraryResize(event) {
    if (libraryResize?.pointerId !== event.pointerId) return;
    const { startX, startWidth, previousWidth } = libraryResize;
    const width = clampLibraryWidth(startWidth + startX - event.clientX, libraryWidthLimits());
    libraryWidth = width === startWidth ? previousWidth : width;
    renderLibraryWidth();
  }

  function finishLibraryResize(keep) {
    if (!libraryResize) return;
    const { pointerId, previousWidth } = libraryResize;
    libraryResize = null;
    libraryResizer.classList.remove('is-resizing');
    if (libraryResizer.hasPointerCapture(pointerId)) libraryResizer.releasePointerCapture(pointerId);
    if (keep) {
      if (libraryWidth !== previousWidth) persistLibraryWidth();
    } else {
      libraryWidth = previousWidth;
      renderLibraryWidth();
    }
  }

  function bindLibraryResize() {
    libraryResizer.addEventListener('pointerdown', event => {
      if (event.button !== 0 || gesture || libraryResize) return;
      libraryResize = {
        pointerId: event.pointerId, startX: event.clientX, startWidth: library.offsetWidth, previousWidth: libraryWidth
      };
      libraryResizer.focus({ preventScroll: true });
      libraryResizer.classList.add('is-resizing');
      libraryResizer.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    libraryResizer.addEventListener('pointermove', moveLibraryResize);
    libraryResizer.addEventListener('pointerup', event => {
      if (libraryResize?.pointerId !== event.pointerId) return;
      moveLibraryResize(event);
      finishLibraryResize(true);
    });
    for (const name of ['pointercancel', 'lostpointercapture']) {
      libraryResizer.addEventListener(name, event => {
        if (libraryResize?.pointerId === event.pointerId) finishLibraryResize(false);
      });
    }
    libraryResizer.addEventListener('dblclick', () => {
      libraryWidth = null;
      renderLibraryWidth();
      persistLibraryWidth();
    });
    libraryResizer.addEventListener('keydown', event => {
      if (gesture || libraryResize) return;
      const limits = libraryWidthLimits();
      const step = event.shiftKey ? 48 : 16;
      const widths = {
        ArrowLeft: library.offsetWidth + step, ArrowRight: library.offsetWidth - step,
        Home: limits.min, End: limits.max
      };
      const width = widths[event.key];
      if (!Number.isFinite(width)) return;
      event.preventDefault();
      event.stopPropagation();
      libraryWidth = clampLibraryWidth(width, limits);
      renderLibraryWidth();
      persistLibraryWidth();
    });
    new ResizeObserver(renderLibraryWidth).observe(editor);
  }

  async function persist() {
    const generation = ++saveGeneration;
    setSaveStatus('saving');
    try {
      await Storage.save(project);
      if (generation === saveGeneration) setSaveStatus('saved');
    } catch {
      if (generation === saveGeneration) setSaveStatus('saveFailed');
    }
  }

  function commit(next) {
    if (next === project) return;
    past.push(project);
    if (past.length > 40) past.shift();
    future.length = 0;
    useProject(next);
  }

  function useProject(next, save = true) {
    if (next.tiles.some(tile => tile.archived)) {
      const inUse = new Set(next.pieces.map(piece => piece.tileId));
      const tiles = next.tiles.filter(tile => !tile.archived || inUse.has(tile.id));
      if (tiles.length !== next.tiles.length) next = { ...next, tiles };
    }
    project = next;
    if (!selectedReference()) activeReferenceId = project.references[0]?.id;
    if (!project.tiles.some(tile => tile.id === activeTileId && !tile.archived)) {
      activeTileId = project.tiles.find(tile => !tile.archived)?.id;
    }
    if (selectedIds.size) {
      selectedIds = new Set(currentSelection().map(piece => piece.id));
    }
    placementIndex = new Model.PlacementIndex(project);
    renderTools();
    renderAll();
    if (save) persist();
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

  function setSaveStatus(key) {
    saveStatus = key;
    byId('save-status').textContent = t(key);
  }

  function renderFeedback() {
    byId('feedback').textContent = feedbackMessages.map(key => t(key, feedbackValues)).join(' ');
  }

  function notify(keys, values) {
    const feedback = byId('feedback');
    feedbackMessages = [].concat(keys);
    feedbackValues = values;
    renderFeedback();
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
    byId('board-clip').replaceChildren(boardShape(board, {}));
    layers.grid.replaceChildren();
    if (grid.visible) layers.grid.append(boardShape(board, { fill: 'url(#grid-pattern)' }));
    layers.grid.append(boardShape(board, { class: 'board-outline', fill: 'none' }));
  }

  function selectedReference() {
    return project.references.find(reference => reference.id === activeReferenceId);
  }

  function paintReference(reference) {
    const element = referenceElements.get(reference.id);
    const height = reference.width * reference.pixelHeight / reference.pixelWidth;
    element.setAttribute('x', reference.x - reference.width / 2);
    element.setAttribute('y', reference.y - height / 2);
    element.setAttribute('width', reference.width);
    element.setAttribute('height', height);
    element.setAttribute('opacity', reference.opacity);
    element.setAttribute('visibility', reference.visible ? 'visible' : 'hidden');
  }

  function renderReferences() {
    if (renderedReferences !== project.references) {
      const previous = new Map(referenceElements);
      referenceElements.clear();
      const fragment = document.createDocumentFragment();
      for (const reference of project.references) {
        const element = previous.get(reference.id) || svgElement('image', { 'data-reference': reference.id });
        if (element.getAttribute('href') !== reference.source) element.setAttribute('href', reference.source);
        referenceElements.set(reference.id, element);
        paintReference(reference);
        fragment.append(element);
      }
      layers.references.replaceChildren(fragment);
      byId('reference-select').replaceChildren(
        ...project.references.map(reference => new Option(reference.name, reference.id))
      );
      renderedReferences = project.references;
    }
    renderReferenceControls();
  }

  function renderReferenceControls() {
    const selected = selectedReference();
    byId('reference-controls').hidden = !selected;
    byId('add-reference').disabled = addingReferences || project.references.length >= Model.MAX_REFERENCES;
    if (!selected) return;
    byId('reference-select').value = selected.id;
    const width = byId('reference-width');
    width.max = Model.referenceWidthLimit(selected.pixelWidth, selected.pixelHeight);
    width.value = Number(selected.width.toFixed(3));
    byId('reference-opacity').value = Math.round(selected.opacity * 100);
    byId('reference-opacity-value').textContent = I18n.percent(selected.opacity);
    byId('reference-visible').checked = selected.visible;
  }

  function fittedReference(reference) {
    const { board } = project;
    const ratio = reference.pixelWidth / reference.pixelHeight;
    const width = Math.min(board.width, board.height * ratio) * .92;
    return { x: 0, y: 0, width: Math.max(.1, width) };
  }

  function editReference(reference, changes) {
    if (!reference || gesture || Object.keys(changes).every(key => reference[key] === changes[key])) return;
    const references = project.references.map(image => image.id === reference.id ? { ...image, ...changes } : image);
    commit({ ...project, references });
  }

  function validationKey(error, fallback) {
    return error instanceof Model.ValidationError ? error.message : fallback;
  }

  async function readReferenceFile(file) {
    if (file.size > Model.MAX_REFERENCE_FILE) throw new Model.ValidationError('referenceFileTooLarge');
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    const png = pngSignature.every((byte, index) => bytes[index] === byte);
    if (!jpeg && !png) throw new Model.ValidationError('referenceFileType');

    const blob = new Blob([file], { type: jpeg ? 'image/jpeg' : 'image/png' });
    const url = URL.createObjectURL(blob);
    let dimensions;
    try {
      dimensions = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight });
        image.onerror = () => reject(new Model.ValidationError('referenceOpenFailed'));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!Model.validReferenceDimensions(dimensions.pixelWidth, dimensions.pixelHeight)) {
      throw new Model.ValidationError('referenceDimensions');
    }
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Model.ValidationError('referenceReadFailed'));
      reader.readAsDataURL(blob);
    });
    return { source, ...dimensions };
  }

  async function importReferences(event) {
    const input = event.target;
    const files = [...input.files];
    input.value = '';
    if (!files.length || addingReferences) return;

    const generation = projectGeneration;
    const images = [];
    const problems = [];
    addingReferences = true;
    renderReferenceControls();
    try {
      for (const file of files) {
        if (generation !== projectGeneration) return;
        if (project.references.length + images.length >= Model.MAX_REFERENCES) {
          problems.push('tooManyReferences');
          break;
        }
        try {
          images.push({ ...await readReferenceFile(file), name: file.name.trim().slice(0, 160) });
        } catch (error) {
          problems.push(validationKey(error, 'referenceReadFailed'));
        }
      }
      if (generation !== projectGeneration) return;
      if (gesture) {
        notify('referenceDragActive');
        return;
      }
      const references = [...project.references];
      let totalSize = references.reduce((size, reference) => size + reference.source.length, 0);
      for (const image of images) {
        if (totalSize + image.source.length > Model.MAX_REFERENCE_DATA) {
          problems.push('referenceStorageFull');
          continue;
        }
        totalSize += image.source.length;
        references.push({ ...image, name: image.name || t('referenceName'), id: nextId('reference'), ...fittedReference(image), opacity: .5, visible: true });
      }
      const added = references.length - project.references.length;
      if (added) {
        activeReferenceId = references[references.length - 1].id;
        commit({ ...project, references });
        byId('reference-controls').scrollIntoView({ block: 'nearest' });
      }
      const messages = [...new Set(problems)];
      if (added) messages.unshift(added === 1 ? 'referenceAdded' : 'referencesAdded');
      notify(messages, { count: added, maximum: Model.MAX_REFERENCES });
    } finally {
      addingReferences = false;
      renderReferenceControls();
    }
  }

  function bindReferences() {
    byId('add-reference').addEventListener('click', () => byId('reference-file').click());
    byId('reference-file').addEventListener('change', importReferences);
    byId('reference-select').addEventListener('change', event => {
      if (gesture) return;
      activeReferenceId = event.target.value;
      renderReferenceControls();
      renderTools();
    });
    numericChange('reference-width', () => selectedReference()?.width, width => editReference(selectedReference(), { width }));
    byId('reference-opacity').addEventListener('input', event => {
      const reference = selectedReference();
      if (!reference || gesture) return;
      const amount = event.target.valueAsNumber;
      paintReference({ ...reference, opacity: amount / 100 });
      byId('reference-opacity-value').textContent = I18n.percent(amount / 100);
    });
    byId('reference-opacity').addEventListener('change', event => {
      editReference(selectedReference(), { opacity: event.target.valueAsNumber / 100 });
    });
    byId('reference-visible').addEventListener('change', event => {
      editReference(selectedReference(), { visible: event.target.checked });
    });
    byId('fit-reference').addEventListener('click', () => {
      const reference = selectedReference();
      if (reference) editReference(reference, fittedReference(reference));
    });
    byId('remove-reference').addEventListener('click', () => {
      if (gesture || !selectedReference()) return;
      const references = project.references.filter(reference => reference.id !== activeReferenceId);
      commit({ ...project, references });
      byId(references.length ? 'reference-select' : 'add-reference').focus({ preventScroll: true });
      notify('referenceRemoved');
    });
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
    renderPieceSummary();
  }

  function renderPieceSummary() {
    const counts = new Map();
    for (const { tileId } of project.pieces) counts.set(tileId, (counts.get(tileId) || 0) + 1);
    byId('work-count').textContent = projectSizeText() + ' · ' + pieceCount(project.pieces.length);
    renderInventory(placementIndex.tileTypes, counts);
  }

  function tileSwatch(tile) {
    const swatch = document.createElement('span');
    swatch.className = 'tile-swatch ' + tile.shape;
    swatch.style.setProperty('--tile-color', tile.color);
    swatch.setAttribute('aria-hidden', 'true');
    return swatch;
  }

  function renderInventory(tileTypes, counts) {
    const tiles = [...counts.keys()].map(id => tileTypes.get(id));
    tiles.sort((a, b) => I18n.compare(a.name, b.name));
    const rows = document.createDocumentFragment();
    for (const tile of tiles) {
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      const label = document.createElement('span');
      label.className = 'inventory-tile';
      const name = document.createElement('span');
      name.className = 'inventory-name';
      name.textContent = tile.name;
      const size = document.createElement('small');
      size.className = 'inventory-size';
      size.textContent = tileSizeText(tile);
      name.append(size);
      label.append(tileSwatch(tile), name);
      heading.append(label);
      const count = document.createElement('td');
      count.textContent = I18n.count(counts.get(tile.id));
      row.append(heading, count);
      rows.append(row);
    }
    byId('inventory-rows').replaceChildren(rows);
    byId('inventory-table').hidden = counts.size === 0;
    byId('empty-inventory').hidden = counts.size > 0;
  }

  function pieceCount(number) {
    return t(number === 1 ? 'oneTile' : 'manyTiles', { count: number });
  }

  function projectSizeText() {
    const { board } = project;
    if (board.shape === 'circle') return 'Ø ' + I18n.number(board.width) + ' mm';
    return I18n.number(board.width) + ' × ' + I18n.number(board.height) + ' mm';
  }

  function renderSettings() {
    const { board, grid, name, seam } = project;
    byId('project-name').value = name;
    document.querySelectorAll('[name="board-shape"]').forEach(input => { input.checked = input.value === board.shape; });
    renderBoardWidthLabel();
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

  function renderBoardWidthLabel() {
    byId('board-width-label').textContent = t(project.board.shape === 'circle' ? 'diameter' : 'width');
  }

  function tileSizeText(tile) {
    if (tile.shape === 'circle') return 'Ø ' + I18n.number(tile.width) + ' mm';
    return I18n.number(tile.width) + ' × ' + I18n.number(tile.height) + ' mm';
  }

  function tileSizeKey(tile) {
    const dimensions = tile.shape === 'circle' ? 'diameter' : 'sides';
    return dimensions + '/' + tile.width + '/' + tile.height;
  }

  function filterChip(container, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip ' + className;
    container.append(button);
    return button;
  }

  function refreshLibraryOptions() {
    if (librarySource === project.tiles) return;
    librarySource = project.tiles;
    availableTiles = project.tiles.filter(tile => !tile.archived);
    byId('library-tools').hidden = availableTiles.length === 0;

    const sizes = new Map();
    const colors = new Set();
    const tags = new Map();
    libraryTileColors = new Map();
    for (const tile of availableTiles) {
      sizes.set(tileSizeKey(tile), tile);
      const families = Model.colorFamilies(tile.color);
      libraryTileColors.set(tile.id, families);
      for (const family of families) colors.add(family);
      for (const label of tile.tags || []) {
        const key = Model.tileTagKey(label);
        if (!tags.has(key)) tags.set(key, { key, label, count: 0 });
        tags.get(key).count++;
      }
    }

    if (!sizes.has(libraryFilters.size)) libraryFilters.size = '';
    if (!colors.has(libraryFilters.color)) libraryFilters.color = '';
    for (const key of libraryFilters.tags) {
      if (!tags.has(key)) libraryFilters.tags.delete(key);
    }

    const sizeSelect = byId('library-size');
    const sizeOptions = [...sizes].sort(([, a], [, b]) => a.width - b.width || a.height - b.height);
    sizeSelect.replaceChildren(
      new Option(t('allSizes'), ''),
      ...sizeOptions.map(([key, tile]) => new Option(tileSizeText(tile), key))
    );

    byId('library-color').replaceChildren(
      new Option(t('allColors'), ''),
      ...colorFamilies.filter(key => colors.has(key)).map(key => new Option(t(key), key))
    );

    const tagChips = byId('library-tags');
    const tagButtons = document.createDocumentFragment();
    const sortedTags = [...tags.values()].sort((a, b) => I18n.compare(a.label, b.label));
    const maxFrequency = Math.max(1, ...sortedTags.map(tag => tag.count));
    for (const { key, label, count } of sortedTags) {
      const button = filterChip(tagButtons, 'tag-chip');
      button.dataset.tagFilter = key;
      button.style.setProperty('--tag-size', (.8 + .18 * (count - 1) / Math.max(1, maxFrequency - 1)) + 'rem');
      button.textContent = label;
      const tally = document.createElement('span');
      tally.className = 'tag-count';
      tally.textContent = I18n.count(count);
      button.append(tally);
      button.setAttribute('aria-label', t(count === 1 ? 'tagOneTileType' : 'tagManyTileTypes', { tag: label, count }));
    }
    tagChips.replaceChildren(tagButtons);
    tagChips.hidden = tags.size === 0;
    byId('library-no-tags').hidden = tags.size > 0;
    syncLibraryFilters();
  }

  function libraryFilterCount() {
    return Number(Boolean(libraryFilters.size)) + Number(Boolean(libraryFilters.color)) + libraryFilters.tags.size;
  }

  function syncLibraryFilters() {
    byId('library-sort').value = libraryOrder;
    byId('library-size').value = libraryFilters.size;
    byId('library-color').value = libraryFilters.color;
    byId('library-tags').querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', libraryFilters.tags.has(button.dataset.tagFilter));
    });
    const count = libraryFilterCount();
    const badge = byId('library-filter-count');
    badge.hidden = count === 0;
    badge.textContent = I18n.count(count);
    badge.setAttribute('aria-label', t(count === 1 ? 'oneFilter' : 'manyFilters', { count }));
    byId('clear-library-filters').hidden = count === 0;
  }

  function clearLibraryFilters() {
    libraryFilters.size = '';
    libraryFilters.color = '';
    libraryFilters.tags.clear();
    syncLibraryFilters();
  }

  function filteredLibraryTiles() {
    const { size, color, tags } = libraryFilters;
    const tiles = availableTiles.filter(tile => {
      if (size && tileSizeKey(tile) !== size) return false;
      if (color && !libraryTileColors.get(tile.id).has(color)) return false;
      if (!tags.size) return true;
      const keys = new Set((tile.tags || []).map(Model.tileTagKey));
      return [...tags].every(tag => keys.has(tag));
    });
    if (libraryOrder !== 'added') {
      const direction = libraryOrder === 'name-asc' ? 1 : -1;
      tiles.sort((a, b) => direction * I18n.compare(a.name, b.name));
    }
    return tiles;
  }

  function renderLibrary() {
    refreshLibraryOptions();
    const visibleTiles = filteredLibraryTiles();
    const list = byId('tile-list');
    const fragment = document.createDocumentFragment();
    const focusedTileId = list.contains(document.activeElement) ? document.activeElement.dataset.tileChoice : null;
    let focusTarget;
    for (const tile of visibleTiles) {
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

      const caption = document.createElement('span');
      caption.className = 'tile-caption';
      const name = document.createElement('strong');
      name.textContent = tile.name;
      const size = document.createElement('small');
      size.textContent = tileSizeText(tile);
      caption.append(name, size);
      if (tile.tags?.length) {
        const tags = document.createElement('small');
        tags.className = 'tile-tags';
        tags.textContent = tile.tags.join(', ');
        tags.title = tags.textContent;
        caption.append(tags);
      }
      choice.append(tileSwatch(tile), caption);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-button edit-tile';
      edit.title = t('editTileType');
      edit.setAttribute('aria-label', t('editNamedTile', { name: tile.name }));
      edit.append(icon('edit'));
      edit.addEventListener('click', () => openTileDialog(tile));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button remove-tile delete-button';
      remove.title = t('removeTileType');
      remove.setAttribute('aria-label', t('removeNamedTile', { name: tile.name }));
      remove.append(icon('delete'));
      remove.addEventListener('click', () => removeTileFromLibrary(tile));
      item.append(choice, edit, remove);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    byId('empty-library').hidden = availableTiles.length > 0;
    const result = byId('library-result');
    result.hidden = libraryFilterCount() === 0;
    result.textContent = visibleTiles.length ?
      t('libraryResult', { visible: visibleTiles.length, total: availableTiles.length }) : t('noFilterMatches');
    const hiddenTile = visibleTiles.some(tile => tile.id === activeTileId) ? null :
      availableTiles.find(tile => tile.id === activeTileId);
    byId('hidden-drawing-tile').hidden = !hiddenTile;
    if (hiddenTile) byId('hidden-drawing-tile').textContent = t('hiddenDrawingTile', { name: hiddenTile.name });
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function bindLibraryFilters() {
    byId('library-sort').addEventListener('change', event => {
      libraryOrder = event.target.value;
      try {
        localStorage.setItem(LIBRARY_ORDER_KEY, libraryOrder);
      } catch {
        // Sorting remains available when browser storage is disabled.
      }
      renderLibrary();
    });
    byId('library-size').addEventListener('change', event => {
      libraryFilters.size = event.target.value;
      syncLibraryFilters();
      renderLibrary();
    });
    byId('library-color').addEventListener('change', event => {
      libraryFilters.color = event.target.value;
      syncLibraryFilters();
      renderLibrary();
    });
    byId('library-tags').addEventListener('click', event => {
      const button = event.target.closest('button[data-tag-filter]');
      if (!button) return;
      const key = button.dataset.tagFilter;
      if (!libraryFilters.tags.delete(key)) libraryFilters.tags.add(key);
      syncLibraryFilters();
      renderLibrary();
    });
    byId('clear-library-filters').addEventListener('click', () => {
      clearLibraryFilters();
      renderLibrary();
      byId('library-tools-summary').focus();
    });
  }

  function removeTileFromLibrary(tile) {
    if (gesture) return;
    const tiles = project.tiles.map(entry => entry.id === tile.id ? { ...entry, archived: true } : entry);
    const inUse = project.pieces.some(piece => piece.tileId === tile.id);
    commit({ ...project, tiles });
    const nextControl = byId('tile-list').querySelector('.tile-row.active .tile-choice') || byId('add-tile-text');
    nextControl.focus({ preventScroll: true });
    notify(inUse ? 'removedTileInUse' : 'removedTileType');
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
    byId('selected-title').textContent = t(single ? 'selectedTile' : 'selectedTiles');
    byId('selected-name').textContent = single ? placementIndex.tileTypes.get(pieces[0].tileId).name : pieceCount(pieces.length);
    byId('selected-angle-field').hidden = !single;
    byId('rotate').hidden = !single;
    byId('delete-piece-label').textContent = t(single ? 'deleteTile' : 'deleteSelectedTiles');
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
    byId('zoom-level').textContent = I18n.percent(zoom);
    byId('zoom-in').disabled = zoom >= 12;
    byId('zoom-out').disabled = zoom <= .25;
  }

  function renderAll() {
    layers.preview.replaceChildren();
    renderSettings();
    renderBoard();
    renderReferences();
    renderPieces();
    renderLibrary();
    renderSelection();
    renderView();
    byId('undo').disabled = past.length === 0;
    byId('redo').disabled = future.length === 0;
  }

  function setTool(name) {
    if (gesture || (!activeTileId && tileTools.has(name)) ||
        (name === 'reference' && !selectedReference()?.visible)) return;
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
    const canMoveReference = Boolean(selectedReference()?.visible);
    if (!canMoveReference && tool === 'reference') tool = 'select';
    stage.dataset.tool = tool;
    document.querySelectorAll('[data-tool].tool').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.tool === tool);
      button.disabled = (!activeTileId && tileTools.has(button.dataset.tool)) ||
        (!canMoveReference && button.dataset.tool === 'reference');
    });
    byId('tool-name').textContent = t(tool);
    byId('tool-hint').textContent = t(tool + 'Hint');
    byId('outline-field').hidden = tool !== 'shape';
  }

  function changeBoard(changes) {
    const board = { ...project.board, ...changes };
    if (board.shape === 'circle') board.height = board.width;
    board.radius = Math.min(board.radius, board.width / 2, board.height / 2);
    if (Object.keys(board).every(key => board[key] === project.board[key])) return;
    if (project.pieces.some(piece => !Model.fitsBoard(board, placementIndex.geometry(piece)))) {
      renderSettings();
      notify('boardChangeBlocked');
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
        notify('invalidNumber', { min: Number(input.min), max: Number(input.max) });
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
      const name = event.target.value.trim() || t('untitledProject');
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
      if (project.pieces.length) notify('seamChanged');
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
    byId('tile-width-label').textContent = t(circle ? 'diameter' : 'width');
    byId('tile-height-field').hidden = circle;
    byId('tile-height').disabled = circle;
  }

  function openTileDialog(tile) {
    if (!tile && project.tiles.length >= Model.MAX_TYPES) {
      notify('tooManyTileTypes', { count: Model.MAX_TYPES });
      return;
    }
    editingTileId = tile ? tile.id : null;
    byId('tile-dialog-title').textContent = t(tile ? 'editTileType' : 'addTileType');
    byId('tile-name').value = tile ? tile.name : '';
    byId('tile-shape').value = tile ? tile.shape : 'rectangle';
    byId('tile-color').value = tile ? tile.color : '#347e73';
    byId('tile-width').value = tile ? tile.width : 10;
    byId('tile-height').value = tile ? tile.height : 10;
    byId('tile-tags').value = (tile?.tags || []).join(', ');
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
      error.textContent = t('tileNameRequired');
      error.hidden = false;
      return;
    }
    const tagsInput = byId('tile-tags');
    let tags;
    try {
      tags = Model.normalizeTileTags(tagsInput.value.split(','));
    } catch (invalid) {
      error.textContent = t(validationKey(invalid, 'invalidTagText'));
      error.hidden = false;
      tagsInput.focus();
      return;
    }
    const tile = { id: editingTileId || nextId('tile'), name, shape, color, width, height, ...(tags.length ? { tags } : {}) };
    const tiles = editingTileId ? project.tiles.map(old => old.id === tile.id ? tile : old) : [...project.tiles, tile];

    const previous = placementIndex.tileTypes.get(editingTileId);
    if (previous && (previous.shape !== shape || previous.width !== width || previous.height !== height)) {
      const changed = project.pieces.filter(piece => piece.tileId === tile.id);
      const unchanged = project.pieces.filter(piece => piece.tileId !== tile.id);
      const index = new Model.PlacementIndex({ ...project, tiles, pieces: unchanged });
      for (const piece of changed) {
        const geometry = index.geometry(piece);
        if (!index.accepts(geometry)) {
          error.textContent = t('tileEditBlocked');
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
    if (pieces.length >= action.limit) notify(pieces.length === 1 ? 'addedOneTile' : 'addedManyTiles', { count: pieces.length });
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
      notify('tooManyTiles');
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
    else notify('fillStartBlocked');
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
    if (gesture || libraryResize || (event.button !== 0 && event.button !== 1)) return;
    if (tileDialog.open || newDialog.open) return;
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
    } else if (tool === 'reference') {
      gesture = { kind: 'reference', origin: point, reference: selectedReference() };
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
        notify('tooManyTiles');
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
      notify(current.pieces.length === 1 ? 'tilePlacementBlocked' : 'tilesPlacementBlocked');
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
    } else if (current.kind === 'reference') {
      const limit = Model.REFERENCE_POSITION_LIMIT;
      const { origin, reference } = current;
      const x = Math.max(-limit, Math.min(limit, reference.x + (point.x - origin.x)));
      const y = Math.max(-limit, Math.min(limit, reference.y + (point.y - origin.y)));
      current.position = { x, y };
      paintReference({ ...reference, ...current.position });
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
    if (current.kind === 'reference') {
      if (event.type === 'pointerup' && current.position) editReference(current.reference, current.position);
      else paintReference(current.reference);
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
      else notify('tilePlacementBlocked');
      return;
    }
    const guide = drawingGuide(current, snap(current.lastPoint));
    const action = placementAction(current.tile);
    for (const point of guide.points) placeCandidate(action, point, true);
    if (action.placed.length) finishPlacement(action);
    else notify('linePlacementBlocked');
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
      notify('rotationBlocked');
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
    const name = (byId('project-name').value.trim() || t('untitledProject')).slice(0, 80);
    if (name !== project.name) commit({ ...project, name });
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = project.name.replace(/[^\p{L}\p{N} _-]/gu, '-').trim() + '.mosaic.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('projectExported');
  }

  async function importProject(event) {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_PROJECT_FILE) {
      notify('projectFileTooLarge');
      return;
    }
    let restored;
    try {
      restored = Model.readProject(JSON.parse(await file.text()));
    } catch (error) {
      notify(error instanceof SyntaxError ? 'invalidJson' : validationKey(error, 'invalidProject'));
      return;
    }
    if (gesture) {
      notify('projectDragActive');
      return;
    }
    projectGeneration++;
    selectedIds.clear();
    clearLibraryFilters();
    resetView();
    commit(restored);
    setTool('draw');
    notify('projectOpened');
  }

  function newProject() {
    if (gesture) return;
    projectGeneration++;
    selectedIds.clear();
    clearLibraryFilters();
    resetView();
    commit(Model.blankProject(project.tiles.filter(tile => !tile.archived), t('untitledProject')));
    setTool('draw');
    byId('project-name').focus();
    byId('project-name').select();
  }

  function onKeyDown(event) {
    if (!placementIndex || tileDialog.open || newDialog.open) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      returnToSelection();
      return;
    }
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
  }

  function returnToSelection() {
    if (gesture) {
      const { pointerId } = gesture;
      endPointer({ type: 'pointercancel', pointerId });
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    }
    finishLibraryResize(false);
    stopSpacePan();
    const inventory = byId('piece-inventory');
    if (inventory.open) {
      inventory.open = false;
      byId('inventory-summary').focus();
    }
    applySelection(new Set());
    setTool('select');
  }

  function stopSpacePan() {
    spacePressed = false;
    stage.classList.remove('pan-ready');
  }

  function rotateByStep() {
    const selected = singleSelectedPiece();
    if (selected) rotateSelected(selected.angle + 15);
  }

  byId('language-select').addEventListener('change', event => {
    I18n.choose(event.target.value);
    renderBoardWidthLabel();
    renderTools();
    renderReferenceControls();
    renderPieceSummary();
    librarySource = undefined;
    renderLibrary();
    renderLibraryWidth();
    renderSelection();
    renderView();
    if (saveStatus) setSaveStatus(saveStatus);
    if (!byId('feedback').hidden) renderFeedback();
  });

  bindSettings();
  bindLibraryFilters();
  bindReferences();
  renderLibraryWidth();
  bindLibraryResize();
  document.querySelectorAll('[data-tool].tool').forEach(button => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  byId('add-tile-text').addEventListener('click', () => openTileDialog());
  byId('close-dialog').addEventListener('click', () => tileDialog.close());
  byId('cancel-tile').addEventListener('click', () => tileDialog.close());
  byId('tile-shape').addEventListener('change', updateTileShape);
  byId('tile-form').addEventListener('submit', saveTile);
  tileDialog.addEventListener('cancel', returnToSelection);
  byId('undo').addEventListener('click', undo);
  byId('redo').addEventListener('click', redo);
  byId('rotate').addEventListener('click', rotateByStep);
  byId('selected-angle').addEventListener('change', event => rotateSelected(event.target.valueAsNumber));
  byId('delete-piece').addEventListener('click', removeSelected);
  byId('zoom-in').addEventListener('click', () => changeZoom(1.25));
  byId('zoom-out').addEventListener('click', () => changeZoom(.8));
  byId('zoom-fit').addEventListener('click', resetView);
  byId('new-project').addEventListener('click', () => {
    if (project.pieces.length || project.references.length) {
      newDialog.returnValue = '';
      newDialog.showModal();
    } else newProject();
  });
  newDialog.addEventListener('close', () => {
    if (newDialog.returnValue === 'new') newProject();
  });
  newDialog.addEventListener('cancel', returnToSelection);
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

  async function initialize() {
    try {
      const saved = await Storage.load();
      useProject(saved ? Model.readProject(saved) : project);
    } catch {
      useProject(project, false);
      setSaveStatus('loadFailed');
    } finally {
      setTool('draw');
      document.body.removeAttribute('inert');
    }
  }

  initialize();
}());
