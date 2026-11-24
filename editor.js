(function () {
  'use strict';

  const Model = window.MosaicGeometry;
  const Storage = window.MosaicStorage;
  const I18n = window.MosaicI18n;
  const { svgElement, pieceShape, guideShape, renderGrout, renderBoard, renderBoardRulers, paintGridPosition, paintReference } = window.MosaicBoard;
  const t = I18n.text;
  const LIBRARY_ORDER_KEY = 'mosaic-planner.library-order';
  const tileTools = new Set(['draw', 'line', 'shape', 'fill']);
  const guideTools = new Map([['guideLine', 'line'], ['guideSquare', 'square'], ['guideCircle', 'circle']]);
  const gridNumbers = { size: 'grid-size', weight: 'grid-weight', offsetX: 'grid-offset-x', offsetY: 'grid-offset-y' };
  const gridChecks = { visible: 'grid-visible', guidesVisible: 'guides-visible', snap: 'grid-snap', snapTiles: 'tile-snap' };
  const SNAP_PIXELS = 8;
  const colorFamilies = [
    'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'white', 'gray', 'black'
  ];

  const byId = id => document.getElementById(id);
  const editor = document.querySelector('.editor');
  const canvas = byId('canvas');
  const stage = byId('stage');
  const layers = {
    board: byId('board-layer'),
    references: byId('reference-layer'),
    grid: byId('grid-layer'),
    grout: byId('grout-layer'),
    pieces: byId('piece-layer'),
    guides: byId('guide-layer'),
    rulers: byId('ruler-layer'),
    preview: byId('preview-layer'),
    selection: byId('selection-layer')
  };
  const newDialog = byId('new-dialog');
  const tileDialog = byId('tile-dialog');
  const tileShapeInput = byId('tile-shape');
  const tileWidthInput = byId('tile-width');
  const tileHeightInput = byId('tile-height');
  const triangleAngle = byId('tile-apex-angle');
  const drawRotation = byId('draw-rotation');
  const drawAngleInput = byId('draw-angle');
  const seamColorInput = byId('seam-color');
  const expandLibrary = byId('expand-library');
  const past = [];
  const future = [];
  const pieceElements = new Map();
  const groutElements = new Map();
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
  let librarySource;
  let availableTiles = [];
  let libraryTileColors = new Map();
  let activeTileId;
  let selectedIds = new Set();
  let editingTileId = null;
  let triangleUsesAngle = false;
  let tool = 'draw';
  let drawAngle = 0;
  let drawHover;
  let placementIndex;
  let gesture = null;
  let spacePressed = false;
  let feedbackTimer;
  let feedbackMessages;
  let feedbackValues;
  let zoom = 1;
  let snapDistance = 0;
  let rulerView;
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

  function icon(name) {
    const element = svgElement('svg', { class: 'icon', 'aria-hidden': 'true' });
    element.append(svgElement('use', { href: '#i-' + name }));
    return element;
  }

  function selectedReference() {
    return project.references.find(reference => reference.id === activeReferenceId);
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
        paintReference(element, reference);
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
      paintReference(referenceElements.get(reference.id), { ...reference, opacity: amount / 100 });
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
    const tileTypes = placementIndex.tileTypes;
    renderGrout?.(project, tileTypes, layers.grout, groutElements);
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

  function markPiece(id, className, active) {
    pieceElements.get(id)?.classList.toggle(className, active);
    groutElements.get(id)?.classList.toggle(className, active);
  }

  function renderPieceSummary() {
    const counts = new Map();
    for (const { tileId } of project.pieces) counts.set(tileId, (counts.get(tileId) || 0) + 1);
    byId('work-count').textContent = projectSizeText() + ' · ' + pieceCount(project.pieces.length);
    renderInventory(placementIndex.tileTypes, counts);
  }

  function tileSwatch(tile) {
    const viewSize = Math.max(tile.width, tile.height) * 1.1;
    const swatch = svgElement('svg', {
      class: 'tile-swatch', 'aria-hidden': 'true',
      viewBox: [-viewSize / 2, -viewSize / 2, viewSize, viewSize].join(' ')
    });
    swatch.append(pieceShape({ x: 0, y: 0, angle: 0 }, tile, { class: 'piece-face', fill: tile.color }));
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
    const { board, grid, name, seam, seamColor } = project;
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
    if (seamColorInput && seamColor) seamColorInput.value = seamColor;
    renderGridSettings(grid);
  }

  function renderGridSettings(grid) {
    for (const [key, id] of Object.entries(gridNumbers)) byId(id).value = grid[key];
    for (const [key, id] of Object.entries(gridChecks)) byId(id).checked = grid[key];
  }

  function renderBoardWidthLabel() {
    byId('board-width-label').textContent = t(project.board.shape === 'circle' ? 'diameter' : 'width');
  }

  function tileSizeText(tile) {
    if (tile.shape === 'circle') return 'Ø ' + I18n.number(tile.width) + ' mm';
    if (tile.shape === 'equilateral') return '△ ' + I18n.number(tile.width) + ' mm';
    return I18n.number(tile.width) + ' × ' + I18n.number(tile.height) + ' mm';
  }

  function tileSizeKey(tile) {
    if (tile.shape === 'equilateral') return 'side/' + tile.width;
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

  function toggleLibraryLayout() {
    if (gesture) return;
    const expanded = editor.classList.toggle('library-expanded');
    const label = expanded ? 'collapseLibrary' : 'expandLibrary';
    expandLibrary.setAttribute('aria-expanded', expanded);
    expandLibrary.dataset.title = label;
    expandLibrary.dataset.ariaLabel = label;
    expandLibrary.title = t(label);
    expandLibrary.setAttribute('aria-label', t(label));
    expandLibrary.querySelector('use').setAttribute('href', expanded ? '#i-collapse' : '#i-expand');
    drawHover = undefined;
    layers.preview.replaceChildren();
    renderView();
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
    const screenWidth = stage.clientWidth;
    const screenHeight = stage.clientHeight;
    if (!screenWidth || !screenHeight) return;
    const rulerGutter = 52;
    const fitWidth = Math.max(screenWidth - 2 * rulerGutter, screenWidth / 2);
    const fitHeight = Math.max(screenHeight - 2 * rulerGutter, screenHeight / 2);
    const margin = Math.max(board.width, board.height) * .12;
    const unitsPerPixel = Math.max((board.width + margin) / fitWidth, (board.height + margin) / fitHeight) / zoom;
    const width = screenWidth * unitsPerPixel;
    const height = screenHeight * unitsPerPixel;
    snapDistance = SNAP_PIXELS * unitsPerPixel;
    canvas.setAttribute('viewBox', [
      viewCenter.x - width / 2, viewCenter.y - height / 2, width, height
    ].join(' '));
    const language = document.documentElement.lang;
    if (rulerView?.board !== board || rulerView.unitsPerPixel !== unitsPerPixel || rulerView.language !== language) {
      const anchors = rulerView?.board === board ? rulerView.anchors : Model.boardGuideAnchors(board);
      renderBoardRulers(layers.rulers, board, anchors, unitsPerPixel, I18n.number);
      rulerView = { board, anchors, unitsPerPixel, language };
    }
    byId('zoom-level').textContent = I18n.percent(zoom);
    byId('zoom-in').disabled = zoom >= 12;
    byId('zoom-out').disabled = zoom <= .25;
  }

  function renderAll() {
    layers.preview.replaceChildren();
    renderSettings();
    renderBoard(project, layers);
    renderReferences();
    renderPieces();
    renderLibrary();
    renderSelection();
    renderView();
    byId('undo').disabled = past.length === 0;
    byId('redo').disabled = future.length === 0;
  }

  function toolAvailable(name) {
    if (tileTools.has(name)) return Boolean(activeTileId);
    if (guideTools.has(name)) return project.guides.length < Model.MAX_GUIDES;
    if (name === 'guideErase') return project.grid.guidesVisible && project.guides.length > 0;
    if (name === 'moveGrid') return project.grid.visible;
    if (name === 'reference') return Boolean(selectedReference()?.visible);
    return true;
  }

  function setTool(name) {
    if (gesture || !toolAvailable(name)) return;
    tool = name;
    drawHover = undefined;
    if (name !== 'select') {
      selectedIds.clear();
      renderSelection();
    }
    renderTools();
    layers.preview.replaceChildren();
  }

  function renderTools() {
    if (!toolAvailable(tool)) tool = 'select';
    stage.dataset.tool = tool;
    document.querySelectorAll('[data-tool].tool').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.tool === tool);
      button.disabled = !toolAvailable(button.dataset.tool);
    });
    byId('tool-name').textContent = t(tool);
    const showRotation = tool === 'draw' && Boolean(drawRotation);
    const hint = byId('tool-hint');
    hint.textContent = t(tool + 'Hint');
    hint.hidden = showRotation;
    if (drawRotation) drawRotation.hidden = !showRotation;
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

  function changeGrid(changes) {
    if (gesture) {
      renderGridSettings(project.grid);
      return;
    }
    if (Object.keys(changes).every(key => changes[key] === project.grid[key])) return;
    commit({ ...project, grid: { ...project.grid, ...changes } });
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
      if (gesture) {
        byId('seam-width').value = project.seam;
        return;
      }
      commit({ ...project, seam });
      if (project.pieces.length) notify('seamChanged');
    });
    seamColorInput?.addEventListener('change', () => {
      if (gesture) {
        seamColorInput.value = project.seamColor;
        return;
      }
      const seamColor = seamColorInput.value;
      if (seamColor !== project.seamColor) commit({ ...project, seamColor });
    });
    for (const key of ['offsetX', 'offsetY']) {
      const input = byId(gridNumbers[key]);
      input.min = -Model.GRID_OFFSET_LIMIT;
      input.max = Model.GRID_OFFSET_LIMIT;
    }
    for (const [key, id] of Object.entries(gridNumbers)) {
      numericChange(id, () => project.grid[key], value => changeGrid({ [key]: value }));
    }
    for (const [key, id] of Object.entries(gridChecks)) {
      const input = byId(id);
      input.addEventListener('change', () => changeGrid({ [key]: input.checked }));
    }
  }

  function nextId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return crypto.randomUUID();
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + idSequence++;
  }

  function updateTileShape() {
    const shape = tileShapeInput.value;
    const triangle = shape === 'triangle' && Boolean(triangleAngle);
    const hideHeight = shape === 'circle' || shape === 'equilateral';
    const widthLabel = byId('tile-width-label');
    widthLabel.textContent = t(shape === 'circle' ? 'diameter' : 'width');
    widthLabel.hidden = triangle;
    if (triangleAngle) {
      byId('tile-base-label').hidden = !triangle;
      byId('tile-apex-angle-field').hidden = !triangle;
      triangleAngle.disabled = !triangle;
      triangleAngle.required = false;
    }
    tileWidthInput.step = triangle || shape === 'equilateral' ? 'any' : '0.1';
    byId('tile-height-field').hidden = hideHeight;
    tileHeightInput.disabled = hideHeight;
    tileHeightInput.required = !hideHeight;
    tileHeightInput.min = triangle ? Model.MIN_TRIANGLE_HEIGHT : .5;
    tileHeightInput.step = triangle ? 'any' : '0.1';
    syncTriangleDimensions();
  }

  function syncTriangleDimensions() {
    if (!triangleAngle || triangleAngle.disabled) return;
    const width = tileWidthInput.valueAsNumber;
    tileHeightInput.required = !triangleUsesAngle;
    triangleAngle.required = triangleUsesAngle;
    if (triangleUsesAngle) {
      const height = Model.triangleHeightFromAngle(width, triangleAngle.valueAsNumber);
      tileHeightInput.value = Model.validNumber(height, Model.MIN_TRIANGLE_HEIGHT, 10000) ?
        Number(height.toPrecision(7)) : '';
    } else {
      const angle = Model.triangleApexAngle(width, tileHeightInput.valueAsNumber);
      triangleAngle.value = Number.isFinite(angle) ? Number(angle.toPrecision(7)) : '';
    }
    byId('tile-error').hidden = true;
  }

  function openTileDialog(tile) {
    if (!tile && project.tiles.length >= Model.MAX_TYPES) {
      notify('tooManyTileTypes', { count: Model.MAX_TYPES });
      return;
    }
    editingTileId = tile ? tile.id : null;
    byId('tile-dialog-title').textContent = t(tile ? 'editTileType' : 'addTileType');
    byId('tile-name').value = tile ? tile.name : '';
    const equilateral = tile?.shape === 'equilateral';
    tileShapeInput.value = triangleAngle && equilateral ? 'triangle' : (tile?.shape || 'rectangle');
    byId('tile-color').value = tile ? tile.color : '#347e73';
    tileWidthInput.value = tile ? tile.width : 10;
    tileHeightInput.value = tile ? tile.height : 10;
    triangleUsesAngle = equilateral;
    if (triangleAngle) triangleAngle.value = equilateral ? 60 : '';
    byId('tile-tags').value = (tile?.tags || []).join(', ');
    byId('tile-error').hidden = true;
    updateTileShape();
    tileDialog.showModal();
  }

  function saveTile(event) {
    event.preventDefault();
    const name = byId('tile-name').value.trim();
    let shape = tileShapeInput.value;
    const color = byId('tile-color').value;
    const width = tileWidthInput.valueAsNumber;
    const error = byId('tile-error');
    const previous = placementIndex.tileTypes.get(editingTileId);
    let height = tileHeightInput.valueAsNumber;
    if (shape === 'circle') height = width;
    else if (shape === 'equilateral') height = Model.triangleHeight(width);
    else if (shape === 'triangle' && triangleAngle && triangleUsesAngle) {
      const angle = triangleAngle.valueAsNumber;
      height = previous?.width === width && angle === Model.triangleApexAngle(width, previous.height) ?
        previous.height : Model.triangleHeightFromAngle(width, angle);
      if (!Model.validNumber(height, Model.MIN_TRIANGLE_HEIGHT, 10000)) {
        error.textContent = Number.isNaN(height) ? t('invalidApexAngle') :
          t('triangleHeightRange', { min: Model.MIN_TRIANGLE_HEIGHT, max: 10000 });
        error.hidden = false;
        triangleAngle.focus();
        return;
      }
    }
    if (previous?.shape === 'equilateral' && shape === 'triangle' && height === Model.triangleHeight(width)) {
      shape = 'equilateral';
    }

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
    if (editingTileId) {
      const nextControl = byId('tile-list').querySelector('.tile-row.active .edit-tile') || byId('add-tile-text');
      nextControl.focus({ preventScroll: true });
    }
    if (shouldStartDrawing && !selectedIds.size) setTool('draw');
  }

  function surfacePoint(event) {
    const matrix = canvas.getScreenCTM();
    const point = canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function guideAnchorAt(point) {
    return rulerView && Model.nearestGuideAnchor(rulerView.anchors, point, snapDistance);
  }

  function markGuideAnchor(anchor) {
    if (!anchor) return;
    layers.preview.append(svgElement('circle', {
      cx: anchor.x, cy: anchor.y, r: 4.5 * rulerView.unitsPerPixel, class: 'active-guide-anchor'
    }));
  }

  function snappedGeometry(piece, index = placementIndex, accepts = candidate => index.accepts(candidate)) {
    return index.snapPlacement(project, piece, snapDistance, accepts);
  }

  function pieceAt(center, tile, angle) {
    return { tileId: tile.id, x: center.x, y: center.y, angle };
  }

  function placeCandidate(action, point, useSnapping) {
    if (action.placed.length >= action.limit) return;
    const candidate = pieceAt(point, action.tile, action.angle);
    const geometry = useSnapping ?
      snappedGeometry(candidate, placementIndex, target => action.index.accepts(target)) : action.index.geometry(candidate);
    if (!action.index.accepts(geometry)) return;
    action.index.add(geometry);
    action.placed.push(geometry.piece);
  }

  function placementAction(tile, { angle = 0, limit = Model.MAX_STROKE } = {}) {
    return {
      tile,
      angle,
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

  function previewPieces(pieces, tile, { path, blocked } = {}) {
    const fragment = document.createDocumentFragment();
    if (path && path.length > 1) {
      fragment.append(svgElement('polyline', {
        points: path.map(point => point.x + ',' + point.y).join(' '), class: 'guide'
      }));
    }
    for (const piece of pieces.slice(0, 350)) {
      fragment.append(pieceShape(piece, tile, { class: 'preview-piece piece-face', fill: tile.color }));
    }
    if (blocked) fragment.append(pieceShape(blocked, tile, { class: 'blocked-preview' }));
    layers.preview.replaceChildren(fragment);
  }

  function previewDrawPlacement(point, action) {
    const tile = action?.tile ?? placementIndex.tileTypes.get(activeTileId);
    const index = action?.index ?? placementIndex;
    const last = action && action.placed[action.placed.length - 1];
    const accepts = geometry => (last && Math.hypot(geometry.piece.x - last.x, geometry.piece.y - last.y) < 1e-7) ||
      index.accepts(geometry);
    const geometry = snappedGeometry(pieceAt(point, tile, action?.angle ?? drawAngle), placementIndex, accepts);
    const blocked = !accepts(geometry);
    const pieces = action?.placed ?? (blocked ? [] : [geometry.piece]);
    previewPieces(pieces, tile, { blocked: blocked ? geometry.piece : undefined });
  }

  function previewDrawHover(event) {
    drawHover = { clientX: event.clientX, clientY: event.clientY };
    previewDrawPlacement(surfacePoint(drawHover));
  }

  function fillAt(point, tile) {
    const action = placementAction(tile);
    if (!action.limit) {
      notify('tooManyTiles');
      return;
    }
    const start = snappedGeometry(pieceAt(point, tile, action.angle)).piece;
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
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    if (tileDialog.open || newDialog.open) return;
    if (drawAngleInput && document.activeElement === drawAngleInput) drawAngleInput.blur();
    drawHover = undefined;
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
    } else if (tool === 'moveGrid') {
      gesture = { kind: 'moveGrid', origin: point, grid: project.grid };
    } else if (guideTools.has(tool)) {
      const shape = guideTools.get(tool);
      const anchor = shape === 'line' ? guideAnchorAt(point) : undefined;
      gesture = { kind: 'guide', start: anchor || point, anchor, shape };
      markGuideAnchor(anchor);
    } else if (tool === 'guideErase') {
      const nearest = Model.nearestGuide(project.guides, point, snapDistance);
      if (nearest) {
        const guides = project.guides.filter((guide, index) => index !== nearest.index);
        commit({ ...project, guides });
      }
      return;
    } else if (tool === 'erase') {
      gesture = { kind: 'erase', previous: point, erased: new Set() };
      const element = event.target.closest('[data-piece]');
      if (element) erasePiece(gesture, element.dataset.piece);
    } else if (tool === 'fill') {
      fillAt(point, tile);
      return;
    } else if (tool === 'draw') {
      const action = placementAction(tile, { angle: drawAngle });
      if (!action.limit) {
        notify('tooManyTiles');
        return;
      }
      placeCandidate(action, point, true);
      gesture = { kind: 'draw', previous: point, phase: 1, action };
      previewDrawPlacement(point, action);
    } else {
      gesture = { kind: tool, start: snappedGeometry(pieceAt(point, tile, 0)).piece, lastPoint: point, tile };
    }
    gesture.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function erasePiece(current, id) {
    if (current.erased.has(id)) return;
    current.erased.add(id);
    markPiece(id, 'erased-piece', true);
  }

  function drawingGuide(current, point) {
    const { start, tile } = current;
    const end = snappedGeometry(pieceAt(point, tile, 0)).piece;
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

  function selectionAcceptsPlacement({ anchor, pieces, index }, candidate) {
    const offset = { x: candidate.piece.x - anchor.x, y: candidate.piece.y - anchor.y };
    if (!offset.x && !offset.y) return true;
    return index.accepts(candidate) && pieces.every(piece => piece.id === anchor.id ||
      index.accepts(index.geometry(translatePiece(piece, offset))));
  }

  function previewMove(current, point) {
    const { anchor, origin, pieces } = current;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (!current.index && Math.hypot(dx, dy) < .4) return;
    if (!current.index) {
      current.index = new Model.PlacementIndex(project, selectedIds);
      for (const piece of pieces) markPiece(piece.id, 'moving-piece', true);
    }
    const accepts = candidate => selectionAcceptsPlacement(current, candidate);
    const candidate = snappedGeometry(translatePiece(anchor, { x: dx, y: dy }), current.index, accepts);
    const position = candidate.piece;
    const offset = { x: position.x - anchor.x, y: position.y - anchor.y };
    if (offset.x === current.offset?.x && offset.y === current.offset?.y) return;
    current.offset = offset;
    current.valid = accepts(candidate);
    layers.selection.setAttribute('transform', 'translate(' + offset.x + ' ' + offset.y + ')');
    layers.selection.classList.toggle('invalid-selection', !current.valid);
  }

  function finishMove(current, released) {
    if (!current.index) return;
    layers.selection.removeAttribute('transform');
    layers.selection.classList.remove('invalid-selection');
    for (const piece of current.pieces) markPiece(piece.id, 'moving-piece', false);
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
    } else if (current.kind === 'guide') {
      const anchor = current.shape === 'line' ? guideAnchorAt(point) : undefined;
      current.guide = Model.guideFromDrag(current.shape, current.start, anchor || point);
      layers.preview.replaceChildren();
      if (current.guide) layers.preview.append(guideShape(current.guide, { 'stroke-opacity': .65 }));
      markGuideAnchor(current.anchor);
      if (anchor !== current.anchor) markGuideAnchor(anchor);
    } else if (current.kind === 'reference') {
      const limit = Model.REFERENCE_POSITION_LIMIT;
      const { origin, reference } = current;
      const x = Math.max(-limit, Math.min(limit, reference.x + (point.x - origin.x)));
      const y = Math.max(-limit, Math.min(limit, reference.y + (point.y - origin.y)));
      current.position = { x, y };
      paintReference(referenceElements.get(reference.id), { ...reference, ...current.position });
    } else if (current.kind === 'moveGrid') {
      const { grid, origin } = current;
      const limit = Model.GRID_OFFSET_LIMIT;
      const moveOffset = (value, delta) => delta ?
        Number(Math.max(-limit, Math.min(limit, value + delta)).toFixed(3)) : value;
      current.position = {
        offsetX: moveOffset(grid.offsetX, point.x - origin.x),
        offsetY: moveOffset(grid.offsetY, point.y - origin.y)
      };
      paintGridPosition({ ...grid, ...current.position });
    } else if (current.kind === 'erase') {
      if (point.x === current.previous.x && point.y === current.previous.y) return;
      for (const piece of placementIndex.piecesAlong(current.previous, point)) erasePiece(current, piece.id);
      current.previous = point;
    } else if (current.kind === 'draw') {
      const { action, previous } = current;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1e-7) return;
      const spacing = Model.lineSpacing(action.tile, project.seam, previous, point, action.angle);
      const sample = Model.sampleSegment(previous, point, spacing, spacing * current.phase);
      for (const center of sample.points) placeCandidate(action, center, true);
      current.previous = point;
      current.phase = sample.limited ? 1 : sample.nextDistance / spacing;
      previewDrawPlacement(point, action);
    } else {
      current.lastPoint = point;
      const guide = drawingGuide(current, point);
      const action = placementAction(current.tile, { limit: 350 });
      for (const center of guide.points) placeCandidate(action, center, true);
      previewPieces(action.placed, current.tile, { path: guide.path });
    }
  }

  function movePointer(event) {
    if (gesture) updateGesture(event);
    else if (tool === 'draw' && !spacePressed) previewDrawHover(event);
    else if (tool === 'guideLine' && !spacePressed) {
      layers.preview.replaceChildren();
      markGuideAnchor(guideAnchorAt(surfacePoint(event)));
    } else if (tool === 'guideErase' && !spacePressed) {
      const nearest = Model.nearestGuide(project.guides, surfacePoint(event), snapDistance);
      layers.preview.replaceChildren();
      if (nearest) layers.preview.append(guideShape(project.guides[nearest.index], { stroke: '#a34032' }));
    }
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
      else paintReference(referenceElements.get(current.reference.id), current.reference);
      return;
    }
    if (current.kind === 'moveGrid') {
      if (event.type === 'pointerup') changeGrid(current.position);
      else paintGridPosition(project.grid);
      return;
    }
    if (current.kind === 'erase') {
      if (event.type === 'pointerup' && current.erased.size) {
        const pieces = project.pieces.filter(piece => !current.erased.has(piece.id));
        commit({ ...project, pieces });
      } else {
        for (const id of current.erased) markPiece(id, 'erased-piece', false);
      }
      return;
    }
    if (event.type !== 'pointerup' || current.kind === 'pan') return;
    if (current.kind === 'guide') {
      if (current.guide) commit({
        ...project,
        grid: { ...project.grid, guidesVisible: true },
        guides: [...project.guides, current.guide]
      });
      return;
    }
    if (current.kind === 'draw') {
      if (current.action.placed.length) finishPlacement(current.action);
      else {
        notify('tilePlacementBlocked');
        if (event.pointerType !== 'touch') previewDrawHover(event);
      }
      return;
    }
    const guide = drawingGuide(current, current.lastPoint);
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
    if (file.size > Model.MAX_PROJECT_FILE) {
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
      drawHover = undefined;
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

  function changeDrawAngle(angle) {
    if (gesture || !Number.isFinite(angle)) return;
    drawAngle = (Math.round(Model.angleInDegrees(angle) * 10) % 3600) / 10;
    if (tool === 'draw' && drawHover && !spacePressed) previewDrawPlacement(surfacePoint(drawHover));
  }

  function rotateByStep() {
    if (tool === 'draw') {
      changeDrawAngle(drawAngle + 15);
      if (drawAngleInput) drawAngleInput.value = drawAngle;
      return;
    }
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
    renderSelection();
    renderView();
    if (saveStatus) setSaveStatus(saveStatus);
    if (!byId('feedback').hidden) renderFeedback();
  });

  bindSettings();
  bindLibraryFilters();
  byId('library-resizer')?.remove();
  expandLibrary?.addEventListener('click', toggleLibraryLayout);
  bindReferences();
  document.querySelectorAll('[data-tool].tool').forEach(button => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  byId('add-tile-text').addEventListener('click', () => openTileDialog());
  byId('close-dialog').addEventListener('click', () => tileDialog.close());
  byId('cancel-tile').addEventListener('click', () => tileDialog.close());
  tileShapeInput.addEventListener('change', updateTileShape);
  tileWidthInput.addEventListener('input', syncTriangleDimensions);
  tileHeightInput.addEventListener('input', () => {
    triangleUsesAngle = false;
    syncTriangleDimensions();
  });
  triangleAngle?.addEventListener('input', () => {
    triangleUsesAngle = true;
    syncTriangleDimensions();
  });
  byId('tile-form').addEventListener('submit', saveTile);
  tileDialog.addEventListener('cancel', returnToSelection);
  byId('undo').addEventListener('click', undo);
  byId('redo').addEventListener('click', redo);
  if (drawAngleInput) {
    byId('rotate-draw').addEventListener('click', rotateByStep);
    drawAngleInput.addEventListener('input', () => changeDrawAngle(drawAngleInput.valueAsNumber));
    drawAngleInput.addEventListener('blur', () => { drawAngleInput.value = drawAngle; });
    drawAngleInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        drawAngleInput.blur();
      }
    });
  }
  byId('rotate').addEventListener('click', rotateByStep);
  byId('selected-angle').addEventListener('change', event => rotateSelected(event.target.valueAsNumber));
  byId('delete-piece').addEventListener('click', removeSelected);
  byId('zoom-in').addEventListener('click', () => changeZoom(1.25));
  byId('zoom-out').addEventListener('click', () => changeZoom(.8));
  byId('zoom-fit').addEventListener('click', resetView);
  byId('new-project').addEventListener('click', () => {
    if (project.pieces.length || project.references.length || project.guides.length) {
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
    drawHover = undefined;
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
