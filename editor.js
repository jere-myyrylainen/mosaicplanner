(function () {
  'use strict';

  const Model = window.MosaicGeometry;
  const Storage = window.MosaicStorage;
  const I18n = window.MosaicI18n;
  const { svgElement, pieceShape, guideShape, renderGrout, renderBoard, renderWorktable, renderBoardRulers, paintGridPosition, paintReference } = window.MosaicBoard;
  const t = I18n.text;
  const LIBRARY_ORDER_KEY = 'mosaic-planner.library-order';
  const tileTools = new Set(['draw', 'line', 'shape', 'fill']);
  const guideTools = new Map([['guideLine', 'line'], ['guideSquare', 'square'], ['guideCircle', 'circle']]);
  const guideModes = [...guideTools.keys(), 'guideErase'];
  const gridNumbers = { size: 'grid-size', weight: 'grid-weight', offsetX: 'grid-offset-x', offsetY: 'grid-offset-y' };
  const gridChecks = { guidesVisible: 'guides-visible', snap: 'grid-snap', snapTiles: 'tile-snap' };
  const editableFields = 'input, select, textarea, [contenteditable="true"]';
  const boardOnlyTools = new Set([...guideModes, 'moveGrid', 'reference']);
  const SNAP_PIXELS = 8;
  const colorFamilies = [
    'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'white', 'gray', 'black'
  ];

  const byId = id => document.getElementById(id);
  const editor = document.querySelector('.editor');
  const outlineButtons = [...document.querySelectorAll('[data-outline-shape]')];
  const canvas = byId('canvas');
  const stage = byId('stage');
  const layers = {
    board: byId('board-layer'),
    worktable: byId('worktable-layer'),
    worktableClip: byId('worktable-clip'),
    references: byId('reference-layer'),
    grid: byId('grid-layer'),
    grout: byId('grout-layer'),
    worktableGrout: byId('worktable-grout-layer'),
    guides: byId('guide-layer'),
    rulers: byId('ruler-layer'),
    preview: byId('preview-layer')
  };
  const boardView = {
    canvas, stage, pieces: byId('piece-layer'), selection: byId('selection-layer'),
    zoom: 1, center: { x: 0, y: 0 }, unitsPerPixel: 1, zoomId: 'zoom'
  };
  const tableView = {
    canvas: byId('worktable-canvas'), stage: byId('worktable-stage'),
    pieces: byId('worktable-piece-layer'), selection: byId('worktable-selection-layer'),
    zoom: 1, fitZoom: 1, fitted: false, center: { x: 0, y: 0 }, unitsPerPixel: 1, zoomId: 'worktable-zoom'
  };
  const views = [boardView, tableView];
  const worktablePanel = byId('worktable-panel');
  const boardDialog = byId('board-dialog');
  const gridDialog = byId('grid-dialog');
  const boardShapeInput = byId('board-shape');
  const boardRadiusInput = byId('board-radius');
  const gridForm = byId('grid-form');
  const tileDialog = byId('tile-dialog');
  const dialogs = [boardDialog, gridDialog, tileDialog];
  const disclosures = [...document.querySelectorAll('.app-menu, .status-popover')];
  const tileShapeInput = byId('tile-shape');
  const tileWidthInput = byId('tile-width');
  const tileHeightInput = byId('tile-height');
  const triangleAngle = byId('tile-apex-angle');
  const drawRotation = byId('draw-rotation');
  const drawAngleInput = byId('draw-angle');
  const selectedAngleInput = byId('selected-angle');
  const seamColorInput = byId('seam-color');
  const expandLibrary = byId('expand-library');
  const copyTilesButton = byId('copy-tiles');
  const pasteTilesButton = byId('paste-tiles');
  const cancelPasteButton = byId('cancel-paste');
  const worktableButton = byId('toggle-worktable');
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
  let copiedPieces = [];
  let pendingPaste;
  let tileDraft;
  let triangleUsesAngle = false;
  let tool = 'draw';
  let outlineShape = 'rectangle';
  let guideMode = 'guideLine';
  let creatingProject = false;
  let drawAngle = 0;
  let drawHover;
  let pointerHover;
  let previewView = boardView;
  let worktableVisible = false;
  let placementIndex;
  let gesture = null;
  let pendingDrawing;
  let spacePressed = false;
  let feedbackTimer;
  let feedbackMessages;
  let feedbackValues;
  let rulerView;
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
    useProject(retainWorktableHeight(next));
  }

  function retainWorktableHeight(next) {
    // The panel can add temporary space. Save only the height needed by the tiles.
    const table = placementIndex?.worktable;
    if (!table || next.worktable !== project.worktable || next.board !== project.board ||
        (next.pieces === project.pieces && next.tiles === project.tiles)) return next;
    const storedHeight = next.worktableHeight ?? next.worktable;
    const types = next.tiles === project.tiles ? placementIndex.tileTypes : new Map(next.tiles.map(tile => [tile.id, tile]));
    let height = storedHeight;
    for (const piece of next.pieces) {
      if (!Model.isOnWorktable(table, piece)) continue;
      const { minY, maxY } = Model.pieceGeometry(types.get(piece.tileId), piece);
      height = Math.max(height, -2 * minY, 2 * maxY);
    }
    return height > storedHeight ? { ...next, worktableHeight: Math.min(10000, height) } : next;
  }

  function editingIndex(snapshot = project, excludedIds) {
    const index = new Model.PlacementIndex(snapshot, excludedIds);
    index.worktable = placementIndex.worktable;
    return index;
  }

  function useProject(next, save = true) {
    cancelPendingDrawing();
    if (next.tiles.some(tile => tile.archived)) {
      const inUse = new Set(next.pieces.map(piece => piece.tileId));
      const tiles = next.tiles.filter(tile => !tile.archived || inUse.has(tile.id));
      if (tiles.length !== next.tiles.length) next = { ...next, tiles };
    }
    if (pendingPaste && next.tiles !== project.tiles) {
      pendingPaste = undefined;
      tool = 'select';
    }
    if (next.worktable !== project.worktable) {
      worktableVisible = next.worktable !== undefined;
      tableView.zoom = 1;
      tableView.fitted = false;
      tableView.center = { x: 0, y: 0 };
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
    byId('empty-references').hidden = Boolean(selected);
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
        showDockPanel('references');
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
    byId('add-reference').addEventListener('click', () => {
      if (gesture) return;
      showDockPanel('references');
      byId('reference-file').click();
    });
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
    const { tileTypes, worktable } = placementIndex;
    const mosaicPieces = [];
    const tablePieces = [];
    const mosaicFragment = document.createDocumentFragment();
    const tableFragment = document.createDocumentFragment();
    pieceElements.clear();
    groutElements.clear();
    for (const piece of project.pieces) {
      const onTable = Model.isOnWorktable(worktable, piece);
      (onTable ? tablePieces : mosaicPieces).push(piece);
      const tile = tileTypes.get(piece.tileId);
      const classes = piece.outline ? 'piece-face cut-piece-face' : 'piece-face';
      const element = pieceShape(piece, tile, { class: classes, fill: tile.color, 'data-piece': piece.id });
      pieceElements.set(piece.id, element);
      (onTable ? tableFragment : mosaicFragment).append(element);
    }
    renderGrout?.({ ...project, pieces: mosaicPieces }, tileTypes, layers.grout, groutElements);
    renderGrout?.({ ...project, pieces: tablePieces }, tileTypes, layers.worktableGrout, groutElements);
    boardView.pieces.replaceChildren(mosaicFragment);
    tableView.pieces.replaceChildren(tableFragment);
    renderPieceSummary();
  }

  function markPiece(id, className, active) {
    pieceElements.get(id)?.classList.toggle(className, active);
    groutElements.get(id)?.classList.toggle(className, active);
  }

  function renderPieceSummary() {
    const counts = new Map();
    let atTable = 0;
    for (const piece of project.pieces) {
      if (Model.isOnWorktable(placementIndex.worktable, piece)) {
        atTable++;
        continue;
      }
      const { tileId, outline } = piece;
      if (!counts.has(tileId)) counts.set(tileId, { total: 0, cut: 0 });
      const count = counts.get(tileId);
      count.total++;
      if (outline) count.cut++;
    }
    const summary = [projectSizeText()];
    if (atTable) summary.push(t('worktableCount', { count: atTable }));
    byId('work-count').textContent = summary.join(' · ');
    const count = project.pieces.length - atTable;
    byId('inventory-count').textContent = I18n.count(count);
    byId('inventory-summary').setAttribute('aria-label', t('tileInventoryCount', { count }));
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
      const { total, cut } = counts.get(tile.id);
      count.textContent = cut ? t('cutTileCount', { total, cut }) : I18n.count(total);
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
    const { grid, name, seam, seamColor } = project;
    byId('project-name').value = name;
    byId('seam-width').value = seam;
    if (seamColorInput && seamColor) seamColorInput.value = seamColor;
    renderGridSettings(grid);
  }

  function renderGridSettings(grid) {
    for (const [key, id] of Object.entries(gridChecks)) byId(id).checked = grid[key];
    byId('snap-summary').classList.toggle('snapping-active', grid.snap || grid.snapTiles);
  }

  function updateBoardShape() {
    const circle = boardShapeInput.value === 'circle';
    const rounded = boardShapeInput.value === 'rounded';
    byId('board-width-label').textContent = t(circle ? 'diameter' : 'width');
    byId('board-height-field').hidden = byId('board-height').disabled = circle;
    byId('board-radius-field').hidden = boardRadiusInput.disabled = !rounded;
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
        if (tile.id !== activeTileId) cancelPendingDrawing();
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
      const clone = document.createElement('button');
      clone.type = 'button';
      clone.className = 'icon-button clone-tile';
      clone.title = t('cloneTileType');
      clone.setAttribute('aria-label', t('cloneNamedTile', { name: tile.name }));
      clone.append(icon('copy'));
      clone.addEventListener('click', () => openTileDialog(tile, { clone: true }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button remove-tile delete-button';
      remove.title = t('removeTileType');
      remove.setAttribute('aria-label', t('removeNamedTile', { name: tile.name }));
      remove.append(icon('delete'));
      remove.addEventListener('click', () => removeTileFromLibrary(tile));
      const actions = document.createElement('div');
      actions.className = 'tile-actions';
      actions.append(edit, clone, remove);
      item.append(choice, actions);
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

  function showDockPanel(name) {
    const references = name === 'references';
    editor.classList.toggle('references-open', references);
    byId('library-panel').hidden = references;
    byId('reference-panel').hidden = !references;
    byId('tiles-tab').setAttribute('aria-pressed', String(!references));
    byId('references-tab').setAttribute('aria-pressed', String(references));
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

  function renderSelection() {
    const pieces = currentSelection();
    paintSelection(pieces);
    renderClipboardControls();
    const showPanel = pieces.length > 0 && !pendingPaste;
    byId('selected-panel').hidden = !showPanel;
    if (!showPanel) return;
    const single = pieces.length === 1;
    const title = single ? (pieces[0].outline ? 'selectedCutTile' : 'selectedTile') : 'selectedTiles';
    byId('selected-title').textContent = t(title);
    byId('selected-name').textContent = single ? placementIndex.tileTypes.get(pieces[0].tileId).name : pieceCount(pieces.length);
    byId('selected-angle-label').textContent = t(single ? 'rotation' : 'rotateSelectionBy');
    selectedAngleInput.setAttribute('aria-label', t(single ? 'tileAngle' : 'rotateSelectionBy'));
    selectedAngleInput.value = single ? Math.round(pieces[0].angle * 10) / 10 : 0;
    byId('delete-piece-label').textContent = t(single ? 'deleteTile' : 'deleteSelectedTiles');
  }

  function paintSelection(pieces, invalid = false) {
    const mosaic = document.createDocumentFragment();
    const table = document.createDocumentFragment();
    for (const piece of pieces) {
      const tile = placementIndex.tileTypes.get(piece.tileId);
      const target = belongsToView(piece, tableView) ? table : mosaic;
      target.append(pieceShape(piece, tile, { class: 'selection-outline' }));
    }
    boardView.selection.replaceChildren(mosaic);
    tableView.selection.replaceChildren(table);
    for (const view of views) view.selection.classList.toggle('invalid-selection', invalid);
  }

  function renderView() {
    const { board, worktable, worktableHeight = worktable ?? 0 } = project;
    renderSurfaceView(boardView, board.width, board.height);
    const width = tableView.canvas.clientWidth;
    const height = tableView.canvas.clientHeight;
    const visibleHeight = worktableVisible && width ? Math.min(10000, worktable * height / width) : 0;
    const table = Model.worktableBounds(board, worktable, Math.max(worktableHeight, visibleHeight));
    if (placementIndex) placementIndex.worktable = table;
    const previous = tableView.bounds;
    if (table?.minX !== previous?.minX || table?.maxX !== previous?.maxX || table?.maxY !== previous?.maxY) {
      renderWorktable(table, layers.worktable, layers.worktableClip);
      tableView.bounds = table;
    }
    if (table && worktableVisible) {
      renderSurfaceView(tableView, worktable, table.maxY - table.minY, (table.minX + table.maxX) / 2);
    }
  }

  function renderSurfaceView(view, surfaceWidth, surfaceHeight, centerX = 0) {
    const screenWidth = view.canvas.clientWidth;
    const screenHeight = view.canvas.clientHeight;
    if (!screenWidth || !screenHeight) return;
    let baseScale;
    if (view === tableView) {
      const horizontal = surfaceWidth / screenWidth;
      const vertical = surfaceHeight / screenHeight;
      baseScale = horizontal;
      view.fitZoom = baseScale / Math.max(horizontal, vertical);
      if (view.fitted) view.zoom = view.fitZoom;
    } else {
      const gutter = Math.min(52, screenWidth / 8);
      const margin = Math.max(surfaceWidth, surfaceHeight) * .12;
      baseScale = Math.max((surfaceWidth + margin) / (screenWidth - 2 * gutter),
        (surfaceHeight + margin) / Math.max(screenHeight - 2 * gutter, screenHeight / 2));
    }
    const unitsPerPixel = baseScale / view.zoom;
    const width = screenWidth * unitsPerPixel;
    const height = screenHeight * unitsPerPixel;
    view.unitsPerPixel = unitsPerPixel;
    view.canvas.setAttribute('viewBox', [
      view.center.x + centerX - width / 2, view.center.y - height / 2, width, height
    ].join(' '));
    byId(view.zoomId + '-level').textContent = I18n.percent(view.zoom);
    byId(view.zoomId + '-in').disabled = view.zoom >= 12;
    byId(view.zoomId + '-out').disabled = view.zoom <= minimumZoom(view);
    if (view !== boardView) return;

    const { board } = project;
    const language = document.documentElement.lang;
    if (rulerView?.board === board && rulerView.unitsPerPixel === unitsPerPixel && rulerView.language === language) return;
    const anchors = rulerView?.board === board ? rulerView.anchors : Model.boardGuideAnchors(board);
    renderBoardRulers(layers.rulers, board, anchors, unitsPerPixel, I18n.number);
    rulerView = { board, anchors, unitsPerPixel, language };
  }

  function renderAll() {
    layers.preview.replaceChildren();
    renderSettings();
    renderBoard(project, layers);
    renderReferences();
    renderPieces();
    renderLibrary();
    renderSelection();
    renderWorktablePanel();
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
    cancelPendingDrawing();
    tool = name;
    drawHover = undefined;
    if (name !== 'paste') pendingPaste = undefined;
    if (name !== 'select' && name !== 'paste') selectedIds.clear();
    renderSelection();
    renderTools();
    layers.preview.replaceChildren();
  }

  function renderTools() {
    if (!toolAvailable(tool)) tool = (guideModes.includes(tool) && guideModes.find(toolAvailable)) || 'select';
    for (const view of views) view.stage.dataset.tool = tool;
    document.querySelectorAll('[data-tool].tool').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.tool === tool);
      button.disabled = !toolAvailable(button.dataset.tool);
    });
    const usingGuides = guideModes.includes(tool);
    if (usingGuides) guideMode = tool;
    byId('guide-tool').setAttribute('aria-pressed', String(usingGuides));
    byId('guide-tool').disabled = !guideModes.some(toolAvailable);
    renderSubtoolRail('guide', usingGuides);
    renderSubtoolRail('shape', tool === 'shape');
    for (const button of outlineButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.outlineShape === outlineShape));
    }
    byId('tool-name').textContent = t(tool);
    const showRotation = tool === 'draw' && Boolean(drawRotation);
    const hint = byId('tool-hint');
    hint.textContent = t(tool + 'Hint');
    hint.hidden = showRotation;
    if (drawRotation) drawRotation.hidden = !showRotation;
    renderClipboardControls();
  }

  function renderSubtoolRail(name, visible) {
    const button = byId(name + '-tool');
    const rail = byId(name + '-tools');
    if (!visible && rail.contains(document.activeElement)) {
      const target = button.disabled ? document.querySelector('.tool-rail [data-tool="select"]') : button;
      target.focus({ preventScroll: true });
    }
    button.setAttribute('aria-expanded', String(visible));
    rail.hidden = !visible;
  }

  function renderClipboardControls() {
    byId('clipboard-tools').hidden = tool !== 'select' && tool !== 'paste';
    if (copyTilesButton) copyTilesButton.disabled = !selectedIds.size || Boolean(pendingPaste);
    if (pasteTilesButton) {
      pasteTilesButton.disabled = !copiedPieces.length;
      pasteTilesButton.setAttribute('aria-pressed', String(Boolean(pendingPaste)));
    }
    if (cancelPasteButton) cancelPasteButton.hidden = !pendingPaste;
  }

  function toggleWorktable() {
    if (gesture) return;
    if (!placementIndex.worktable) {
      const worktable = Math.max(48, Math.round(Math.min(project.board.width, project.board.height) * .42));
      commit({ ...project, worktable });
      return;
    }
    worktableVisible = !worktableVisible;
    if (!worktableVisible) {
      if (pendingDrawing?.view === tableView) cancelPendingDrawing();
      applySelection(new Set(currentSelection().filter(piece => belongsToView(piece, boardView)).map(piece => piece.id)));
    }
    drawHover = pointerHover = undefined;
    setPreviewView(boardView);
    layers.preview.replaceChildren();
    renderWorktablePanel();
    renderView();
  }

  function renderWorktablePanel() {
    const label = worktableVisible ? 'hideWorktable' : 'showWorktable';
    if (!worktableVisible) {
      if (previewView === tableView) setPreviewView(boardView);
      if (pointerHover?.view === tableView) pointerHover = undefined;
      if (drawHover?.view === tableView) drawHover = undefined;
    }
    worktablePanel.hidden = !worktableVisible;
    editor.classList.toggle('worktable-open', worktableVisible);
    worktableButton.setAttribute('aria-expanded', String(worktableVisible));
    worktableButton.dataset.title = worktableButton.dataset.ariaLabel = label;
    worktableButton.title = t(label);
    worktableButton.setAttribute('aria-label', t(label));
  }

  function changeBoard(board) {
    if (gesture) return false;
    if (Object.keys(board).every(key => board[key] === project.board[key])) return true;
    const table = placementIndex.worktable;
    if (project.pieces.some(piece => !Model.isOnWorktable(table, piece) &&
      !Model.fitsBoard(board, placementIndex.geometry(piece)))) {
      return false;
    }
    const nextTable = Model.worktableBounds(board, project.worktable, project.worktableHeight);
    const offsetX = table ? nextTable.minX - table.minX : 0;
    const pieces = offsetX ? project.pieces.map(piece => Model.isOnWorktable(table, piece) ?
      { ...piece, x: piece.x + offsetX } : piece) : project.pieces;
    if (board.width !== project.board.width || board.height !== project.board.height) resetView();
    commit({ ...project, board, pieces });
    return true;
  }

  function openBoardSettings(create) {
    if (gesture) return;
    closeDisclosures(true);
    creatingProject = create;
    const { board } = create ? Model.blankProject([]) : project;
    byId('board-dialog-title').textContent = t(create ? 'startProject' : 'boardSettings');
    byId('save-board').textContent = t(create ? 'createProject' : 'applySettings');
    const showDescription = create && Boolean(project.pieces.length || project.references.length || project.guides.length);
    byId('new-project-description').hidden = !showDescription;
    if (showDescription) boardDialog.setAttribute('aria-describedby', 'new-project-description');
    else boardDialog.removeAttribute('aria-describedby');
    byId('new-project-name-field').hidden = !create;
    byId('new-project-name').value = '';
    byId('board-error').hidden = true;
    boardShapeInput.value = board.shape;
    byId('board-width').value = board.width;
    byId('board-height').value = board.height;
    boardRadiusInput.defaultValue = boardRadiusInput.value = board.radius;
    updateBoardShape();
    boardDialog.showModal();
  }

  function submitBoardSettings(event) {
    event.preventDefault();
    const shape = boardShapeInput.value;
    const width = byId('board-width').valueAsNumber;
    const height = shape === 'circle' ? width : byId('board-height').valueAsNumber;
    const radius = boardRadiusInput.disabled ? Number(boardRadiusInput.defaultValue) : boardRadiusInput.valueAsNumber;
    const board = { shape, width, height, radius: Math.min(radius, width / 2, height / 2) };
    if (creatingProject) {
      const name = byId('new-project-name').value.trim() || t('untitledProject');
      boardDialog.close();
      newProject(board, name);
    } else if (changeBoard(board)) {
      boardDialog.close();
    } else {
      byId('board-error').hidden = false;
    }
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
    for (const input of [byId('project-name'), byId('seam-width')]) {
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

    boardShapeInput.addEventListener('change', updateBoardShape);
    byId('board-form').addEventListener('input', () => { byId('board-error').hidden = true; });
    byId('board-form').addEventListener('submit', submitBoardSettings);
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
    for (const [key, id] of Object.entries(gridChecks)) {
      const input = byId(id);
      input.addEventListener('change', () => changeGrid({ [key]: input.checked }));
    }
    byId('grid-visible').addEventListener('change', event => { byId('move-grid').disabled = !event.target.checked; });
    gridForm.addEventListener('submit', event => {
      event.preventDefault();
      applyGridSettings();
    });
    byId('move-grid').addEventListener('click', () => {
      if (gridForm.reportValidity()) {
        applyGridSettings();
        setTool('moveGrid');
      }
    });
  }

  function openGridSettings() {
    if (gesture) return;
    closeDisclosures(true);
    const { grid } = project;
    byId('grid-visible').checked = grid.visible;
    for (const [key, id] of Object.entries(gridNumbers)) byId(id).value = grid[key];
    byId('move-grid').disabled = !grid.visible;
    gridDialog.showModal();
  }

  function applyGridSettings() {
    const grid = { visible: byId('grid-visible').checked };
    for (const [key, id] of Object.entries(gridNumbers)) grid[key] = byId(id).valueAsNumber;
    gridDialog.close();
    changeGrid(grid);
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
    if (tileDraft?.source) {
      // Imported dimensions can be finer than the regular 0.1 mm input step.
      if (tileWidthInput.validity.stepMismatch) tileWidthInput.step = 'any';
      if (tileHeightInput.validity.stepMismatch) tileHeightInput.step = 'any';
    }
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

  function openTileDialog(tile, { clone = false } = {}) {
    const editing = Boolean(tile && !clone);
    if (!editing && project.tiles.length >= Model.MAX_TYPES) {
      notify('tooManyTileTypes', { count: Model.MAX_TYPES });
      return;
    }
    tileDraft = { source: tile, editing };
    const title = byId('tile-dialog-title');
    title.dataset.text = clone ? 'cloneTileType' : editing ? 'editTileType' : 'addTileType';
    title.textContent = t(title.dataset.text);
    const nameInput = byId('tile-name');
    nameInput.value = tile ? tile.name : '';
    if (clone) {
      const suffix = t('tileCloneNameSuffix');
      const base = tile.name.slice(0, nameInput.maxLength - suffix.length).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
      nameInput.value = base + suffix;
    }
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
    if (clone) nameInput.select();
  }

  function saveTile(event) {
    event.preventDefault();
    if (!tileDialog.open) return;
    const name = byId('tile-name').value.trim();
    let shape = tileShapeInput.value;
    const color = byId('tile-color').value;
    const width = tileWidthInput.valueAsNumber;
    const error = byId('tile-error');
    const { source, editing } = tileDraft;
    const previous = editing ? placementIndex.tileTypes.get(source.id) : undefined;
    const original = previous || source;
    if (!editing && project.tiles.length >= Model.MAX_TYPES) {
      error.textContent = t('tooManyTileTypes', { count: Model.MAX_TYPES });
      error.hidden = false;
      return;
    }
    let height = tileHeightInput.valueAsNumber;
    if (shape === 'circle') height = width;
    else if (shape === 'equilateral') height = Model.triangleHeight(width);
    else if (shape === 'triangle' && triangleAngle && triangleUsesAngle) {
      const angle = triangleAngle.valueAsNumber;
      height = original?.width === width && angle === Model.triangleApexAngle(width, original.height) ?
        original.height : Model.triangleHeightFromAngle(width, angle);
      if (!Model.validNumber(height, Model.MIN_TRIANGLE_HEIGHT, 10000)) {
        error.textContent = Number.isNaN(height) ? t('invalidApexAngle') :
          t('triangleHeightRange', { min: Model.MIN_TRIANGLE_HEIGHT, max: 10000 });
        error.hidden = false;
        triangleAngle.focus();
        return;
      }
    }
    if (original?.shape === 'equilateral' && shape === 'triangle' && height === Model.triangleHeight(width)) {
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
    const tile = { id: editing ? source.id : nextId('tile'), name, shape, color, width, height, ...(tags.length ? { tags } : {}) };
    const tiles = editing ? project.tiles.map(old => old.id === tile.id ? tile : old) : [...project.tiles, tile];

    if (previous && (previous.shape !== shape || previous.width !== width || previous.height !== height)) {
      const changed = project.pieces.filter(piece => piece.tileId === tile.id && !piece.outline);
      const unchanged = project.pieces.filter(piece => piece.tileId !== tile.id || piece.outline);
      const index = editingIndex({ ...project, tiles, pieces: unchanged });
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
    if (source) {
      const action = editing ? '.edit-tile' : '.tile-choice';
      const nextControl = byId('tile-list').querySelector('.tile-row.active ' + action) || byId('add-tile-text');
      nextControl.focus({ preventScroll: true });
    }
    if (shouldStartDrawing && !selectedIds.size) setTool('draw');
  }

  function belongsToView(point, view) {
    return Model.isOnWorktable(placementIndex.worktable, point) === (view === tableView);
  }

  function setPreviewView(view) {
    if (view === previewView) return;
    layers.preview.replaceChildren();
    view.canvas.insertBefore(layers.preview, view.selection);
    previewView = view;
  }

  function viewUnderPointer(event) {
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.drawing-canvas');
    return views.find(view => view.canvas === hit);
  }

  function surfacePoint(event, view = previewView) {
    const matrix = view.canvas.getScreenCTM();
    const point = view.canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function snapDistance() {
    return SNAP_PIXELS * previewView.unitsPerPixel;
  }

  function guideAnchorAt(point) {
    return rulerView && Model.nearestGuideAnchor(rulerView.anchors, point, snapDistance());
  }

  function markGuideAnchor(anchor) {
    if (!anchor) return;
    layers.preview.append(svgElement('circle', {
      cx: anchor.x, cy: anchor.y, r: 4.5 * rulerView.unitsPerPixel, class: 'active-guide-anchor'
    }));
  }

  function snappedGeometry(piece, index = placementIndex, accepts = candidate => index.accepts(candidate)) {
    return index.snapPlacement(project, piece, snapDistance(), accepts);
  }

  function pieceAt(center, tile, angle) {
    return { tileId: tile.id, x: center.x, y: center.y, angle };
  }

  function placeCandidate(action, point, useSnapping) {
    if (action.placed.length >= action.limit || !belongsToView(point, previewView)) return;
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
      index: editingIndex(),
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
    const accepts = geometry => belongsToView(geometry.piece, previewView) &&
      ((last && Math.hypot(geometry.piece.x - last.x, geometry.piece.y - last.y) < 1e-7) || index.accepts(geometry));
    const geometry = snappedGeometry(pieceAt(point, tile, action?.angle ?? drawAngle), placementIndex, accepts);
    const blocked = !accepts(geometry);
    const pieces = action?.placed ?? (blocked ? [] : [geometry.piece]);
    previewPieces(pieces, tile, { blocked: blocked ? geometry.piece : undefined });
  }

  function previewDrawHover(event, view = previewView) {
    drawHover = { clientX: event.clientX, clientY: event.clientY, view };
    setPreviewView(view);
    previewDrawPlacement(surfacePoint(drawHover, view));
  }

  function fillAt(point, tile) {
    const action = placementAction(tile);
    if (!action.limit) {
      notify('tooManyTiles');
      return;
    }
    const start = snappedGeometry(pieceAt(point, tile, action.angle)).piece;
    if (!belongsToView(start, previewView)) {
      notify('fillStartBlocked');
      return;
    }
    const horizontal = tile.width + project.seam;
    const vertical = tile.height + project.seam;
    const queue = [[0, 0]];
    const seen = new Set(['0/0']);
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = 0; i < queue.length && action.placed.length < action.limit; i++) {
      const [column, row] = queue[i];
      const previousCount = action.placed.length;
      const candidate = { x: start.x + column * horizontal, y: start.y + row * vertical };
      placeCandidate(action, candidate, false);
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

  function beginPointer(event, view) {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    if (dialogs.some(dialog => dialog.open)) return;
    const pan = tool === 'pan' || spacePressed || event.button === 1;
    if (view === tableView && !pan && boardOnlyTools.has(tool)) return;
    if (!pan && event.pointerType === 'mouse' && pendingDrawing && pendingDrawing.view !== view) return;
    const focused = document.activeElement;
    if ((drawAngleInput && focused === drawAngleInput) ||
        ((tool === 'select' || tool === 'split' || pendingPaste) && focused?.closest(editableFields))) focused.blur();
    drawHover = undefined;
    setPreviewView(view);
    const point = surfacePoint(event, view);
    const tile = placementIndex.tileTypes.get(activeTileId);
    layers.preview.replaceChildren();

    if (pan) {
      const screenMatrix = view.canvas.getScreenCTM();
      gesture = {
        kind: 'pan', screenX: event.clientX, screenY: event.clientY, center: { ...view.center },
        scaleX: screenMatrix.a, scaleY: screenMatrix.d
      };
      view.stage.classList.add('is-panning');
    } else if (tool === 'select') {
      gesture = beginSelection(event, point);
      if (!gesture) return;
    } else if (pendingPaste) {
      gesture = { kind: 'paste', placement: previewPaste(point) };
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
      const nearest = Model.nearestGuide(project.guides, point, snapDistance());
      if (nearest) {
        const guides = project.guides.filter((guide, index) => index !== nearest.index);
        commit({ ...project, guides });
      }
      return;
    } else if (tool === 'erase') {
      gesture = { kind: 'erase', previous: point, erased: new Set() };
      const element = event.target.closest('[data-piece]');
      if (element) erasePiece(gesture, element.dataset.piece);
    } else if (tool === 'split') {
      const startTarget = placementIndex.nearestSplitStart(point, snapDistance(), piece => belongsToView(piece, view));
      gesture = { kind: 'split', start: point, startTarget };
      renderSplitStart(startTarget);
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
    } else if (event.pointerType === 'mouse') {
      if (pendingDrawing) {
        const current = pendingDrawing;
        pendingDrawing = undefined;
        finishPathDrawing(current, point);
      } else {
        pendingDrawing = startPathDrawing(view, point, tile);
        previewPathDrawing(pendingDrawing, point);
      }
      event.preventDefault();
      return;
    } else {
      cancelPendingDrawing();
      gesture = startPathDrawing(view, point, tile);
    }
    gesture.view = view;
    gesture.screenX = event.clientX;
    gesture.screenY = event.clientY;
    gesture.pointerId = event.pointerId;
    view.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function erasePiece(current, id) {
    if (current.erased.has(id)) return;
    current.erased.add(id);
    markPiece(id, 'erased-piece', true);
  }

  function startPathDrawing(view, point, tile) {
    return { kind: tool, view, start: snappedGeometry(pieceAt(point, tile, 0)).piece, tile };
  }

  function cancelPendingDrawing() {
    if (!pendingDrawing) return false;
    pendingDrawing = undefined;
    layers.preview.replaceChildren();
    return true;
  }

  function drawingGuide(current, point) {
    const { start, tile } = current;
    const end = snappedGeometry(pieceAt(point, tile, 0)).piece;
    if (current.kind === 'line') {
      const spacing = Model.lineSpacing(tile, project.seam, start, end);
      return { path: [start, end], points: Model.sampleSegment(start, end, spacing).points };
    }
    const path = Model.outlinePath(outlineShape, start, end);
    return { path, points: Model.sampleOutline(tile, project.seam, path) };
  }

  function pathPlacement(current, point, limit) {
    const { path, points } = drawingGuide(current, point);
    const action = placementAction(current.tile, { limit });
    for (const center of points) placeCandidate(action, center, true);
    return { path, action };
  }

  function previewPathDrawing(current, point) {
    const { path, action } = pathPlacement(current, point, 350);
    previewPieces(action.placed, current.tile, { path });
  }

  function finishPathDrawing(current, point) {
    const { action } = pathPlacement(current, point);
    if (action.placed.length) finishPlacement(action);
    else notify('linePlacementBlocked');
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
    for (const piece of placementIndex.piecesWithin({ minX, minY, maxX, maxY })) {
      if (belongsToView(piece, current.view)) ids.add(piece.id);
    }
    applySelection(ids);
  }

  function translatePiece(piece, { x, y }) {
    return { ...piece, x: piece.x + x, y: piece.y + y };
  }

  function groupPlacement({ anchor, pieces }, index, desiredOffset, canStay = false) {
    const offsetFromAnchor = point => ({ x: point.x - anchor.x, y: point.y - anchor.y });
    const accepts = candidate => {
      if (!belongsToView(candidate.piece, previewView)) return false;
      const offset = offsetFromAnchor(candidate.piece);
      if (canStay && !offset.x && !offset.y) return true;
      return index.accepts(candidate) && pieces.every(piece => piece === anchor ||
        index.accepts(index.geometry(translatePiece(piece, offset))));
    };
    const candidate = snappedGeometry(translatePiece(anchor, desiredOffset), index, accepts);
    return { offset: offsetFromAnchor(candidate.piece), valid: accepts(candidate) };
  }

  function previewMove(current, point) {
    const { origin, pieces } = current;
    if (!point) {
      if (current.index) {
        current.valid = false;
        paintSelection([]);
      }
      return;
    }
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (!current.index && Math.hypot(dx, dy) < .4) return;
    if (!current.index) {
      current.index = editingIndex(project, selectedIds);
      for (const piece of pieces) markPiece(piece.id, 'moving-piece', true);
    }
    const { offset, valid } = groupPlacement(current, current.index, { x: dx, y: dy }, true);
    if (offset.x === current.offset?.x && offset.y === current.offset?.y && valid === current.valid) return;
    current.offset = offset;
    current.valid = valid;
    paintSelection(pieces.map(piece => translatePiece(piece, offset)), !valid);
  }

  function finishMove(current, released) {
    if (!current.index) return;
    for (const piece of current.pieces) markPiece(piece.id, 'moving-piece', false);
    if (!released || !current.valid || (!current.offset.x && !current.offset.y)) {
      paintSelection(current.pieces);
      if (released && !current.valid) notify(current.pieces.length === 1 ? 'tilePlacementBlocked' : 'tilesPlacementBlocked');
      return;
    }
    const pieces = project.pieces.map(piece => selectedIds.has(piece.id) ? translatePiece(piece, current.offset) : piece);
    commit({ ...project, pieces });
  }

  function copySelection() {
    if (gesture || pendingPaste || !selectedIds.size) return false;
    copiedPieces = currentSelection();
    renderClipboardControls();
    notify(copiedPieces.length === 1 ? 'copiedOneTile' : 'copiedManyTiles', { count: copiedPieces.length });
    return true;
  }

  function beginPaste() {
    if (gesture || !copiedPieces.length) return false;
    if (pendingPaste) return true;
    if (project.pieces.length + copiedPieces.length > Model.MAX_PIECES) {
      notify('pasteTileLimit');
      return true;
    }
    const error = preparePaste();
    if (error) notify(error);
    else {
      setTool('paste');
      if (pointerHover && !spacePressed) {
        setPreviewView(pointerHover.view);
        previewPaste(surfacePoint(pointerHover));
      }
    }
    return true;
  }

  function preparePaste() {
    // Preserve the copied spacing. Only a physical overlap inside the group invalidates it.
    const index = editingIndex({ ...project, seam: 0, pieces: [] });
    const preview = svgElement('g', { class: 'paste-preview' });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const piece of copiedPieces) {
      const tile = index.tileTypes.get(piece.tileId);
      if (!tile) return 'pasteMissingTileTypes';
      const geometry = index.geometry(piece);
      if (index.hasConflict(geometry)) return 'pasteOverlap';
      index.add(geometry);
      minX = Math.min(minX, geometry.minX);
      minY = Math.min(minY, geometry.minY);
      maxX = Math.max(maxX, geometry.maxX);
      maxY = Math.max(maxY, geometry.maxY);
      preview.append(pieceShape(piece, tile, { class: 'piece-face', fill: tile.color }));
    }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const distance = piece => (piece.x - center.x) ** 2 + (piece.y - center.y) ** 2;
    const anchor = copiedPieces.reduce((nearest, piece) => distance(piece) < distance(nearest) ? piece : nearest);
    pendingPaste = { anchor, center, pieces: copiedPieces, preview };
  }

  function previewPaste(point) {
    const { center, preview } = pendingPaste;
    const placement = groupPlacement(pendingPaste, placementIndex, { x: point.x - center.x, y: point.y - center.y });
    const { offset, valid } = placement;
    preview.setAttribute('transform', 'translate(' + offset.x + ' ' + offset.y + ')');
    preview.classList.toggle('invalid-paste', !valid);
    if (preview.parentNode !== layers.preview) layers.preview.replaceChildren(preview);
    return placement;
  }

  function finishPaste(placement) {
    if (!pendingPaste) return;
    if (!placement?.valid) {
      notify('pastePlacementBlocked');
      return;
    }
    if (project.pieces.length + pendingPaste.pieces.length > Model.MAX_PIECES) {
      notify('pasteTileLimit');
      return;
    }
    const copies = pendingPaste.pieces.map(piece => ({ ...translatePiece(piece, placement.offset), id: nextId('piece') }));
    selectedIds = new Set(copies.map(piece => piece.id));
    pendingPaste = undefined;
    tool = 'select';
    commit({ ...project, pieces: project.pieces.concat(copies) });
  }

  function renderSplitMeasurement(layer, { edge, locked }) {
    if (!edge) return;
    const scale = previewView.unitsPerPixel;
    const { first, along, length, tx, ty, point, fraction } = edge;
    const at = (distance, offset) => [
      first.x + distance * tx + offset * ty, first.y + distance * ty - offset * tx
    ];
    const pathPoint = (command, distance, offset) => command + at(distance, offset).join(' ');
    const baseline = 12 * scale;
    const after = length - along;
    const segment = pathPoint('M', 0, baseline) + pathPoint('L', length, baseline);
    const ticks = [0, along, length].map(distance =>
      pathPoint('M', distance, 2 * scale) + pathPoint('L', distance, baseline + 3 * scale));
    layer.append(svgElement('path', { d: segment + ticks.join(''), class: 'split-dimension-line' }));
    const marks = Model.SPLIT_FRACTIONS.filter(mark => mark > 0 && mark < 1 && mark !== fraction).map(mark =>
      pathPoint('M', length * mark, baseline - 3 * scale) + pathPoint('L', length * mark, baseline + 3 * scale));
    layer.append(svgElement('path', { d: marks.join(''), class: 'split-snap-marks' }));

    const labels = [
      { length: along, distance: Math.min(along / 2, along - 35 * scale) },
      { length: after, distance: Math.max(length - after / 2, along + 35 * scale) }
    ];
    for (const label of labels) {
      const [x, y] = at(label.distance, baseline + 10 * scale);
      const text = svgElement('text', {
        x, y, 'font-size': 12 * scale, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'split-dimension-label'
      });
      text.textContent = I18n.number(label.length) + ' mm';
      layer.append(text);
    }
    const snapped = fraction !== undefined;
    layer.append(svgElement('circle', {
      cx: point.x, cy: point.y, r: (snapped ? 3.7 : 2.5) * scale,
      class: snapped ? 'split-anchor snapped-split-anchor' : 'split-anchor'
    }));
    if (locked) {
      const size = Math.min(8 * scale, Math.max(along, after) / 2);
      const side = along > after ? -1 : 1;
      const d = pathPoint('M', along + size * side, 0) + pathPoint('L', along + size * side, -size) +
        pathPoint('L', along, -size);
      layer.append(svgElement('path', { d, class: 'split-right-angle' }));
    }
  }

  function renderCurveSplitMarks(layer, { curve, marks, point, entry }, locked) {
    const scale = previewView.unitsPerPixel;
    for (const mark of marks) {
      layer.append(svgElement('circle', {
        cx: mark.x, cy: mark.y, r: 3 * scale, class: 'split-curve-mark'
      }));
    }
    if (point) layer.append(svgElement('circle', {
      cx: point.x, cy: point.y, r: (entry ? 2.5 : 3.7) * scale,
      class: entry ? 'split-anchor' : 'split-anchor snapped-split-anchor'
    }));
    if (locked) layer.append(svgElement('circle', {
      cx: curve.piece.x, cy: curve.piece.y, r: 2.4 * scale, class: 'split-curve-center'
    }));
  }

  function renderSplitStart(target) {
    if (target?.curve) renderCurveSplitMarks(layers.preview, target);
    else renderSplitMeasurement(layers.preview, { edge: target });
  }

  function previewSplitHover(point) {
    layers.preview.replaceChildren();
    renderSplitStart(placementIndex.nearestSplitStart(point, snapDistance(), piece => belongsToView(piece, previewView)));
  }

  function previewSplit(current, pointer) {
    current.end = pointer;
    const acceptsPiece = piece => belongsToView(piece, current.view);
    const line = placementIndex.splitLine(current.start, pointer, current.startTarget, snapDistance(), acceptsPiece);
    const { start, end, endAnchor } = line;
    let target;
    let fragments;
    let error = 'splitAcrossTile';
    for (const piece of placementIndex.piecesAlong(start, end)) {
      if (!acceptsPiece(piece)) continue;
      const tile = placementIndex.tileTypes.get(piece.tileId);
      const cut = Model.splitPiece(tile, piece, start, end);
      if (!cut) continue;
      if (target) {
        fragments = undefined;
        error = 'splitOneTile';
        break;
      }
      target = piece;
      fragments = cut.fragments;
      error = 'splitNoRoom';
    }
    if (fragments && project.pieces.length >= Model.MAX_PIECES) {
      fragments = undefined;
      error = 'tooManyTiles';
    }
    current.target = target;
    current.fragments = fragments;
    current.error = error;

    const preview = document.createDocumentFragment();
    if (fragments) {
      const tile = placementIndex.tileTypes.get(target.tileId);
      for (const piece of fragments) preview.append(pieceShape(piece, tile, { class: 'split-outline' }));
    }
    const cutLine = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    preview.append(
      svgElement('line', { ...cutLine, class: 'split-line-halo' }),
      svgElement('line', { ...cutLine, class: fragments ? 'split-line' : 'split-line invalid-split' })
    );
    if (line.curveTarget) renderCurveSplitMarks(preview, line.curveTarget, line.locked);
    else renderSplitMeasurement(preview, line);
    if (endAnchor) preview.append(svgElement('circle', {
      cx: endAnchor.x, cy: endAnchor.y, r: 4 * previewView.unitsPerPixel, class: 'split-end-anchor'
    }));
    layers.preview.replaceChildren(preview);
  }

  function finishSplit({ target, fragments, error }) {
    if (!fragments) {
      notify(error);
      return;
    }
    const halves = fragments.map(fragment => ({ ...fragment, id: nextId('piece') }));
    const pieces = project.pieces.flatMap(piece => piece.id === target.id ? halves : [piece]);
    commit({ ...project, pieces });
  }

  function updateGesture(event) {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.kind === 'pan') {
      current.view.center.x = current.center.x - (event.clientX - current.screenX) / current.scaleX;
      current.view.center.y = current.center.y - (event.clientY - current.screenY) / current.scaleY;
      renderView();
      return;
    }
    if (current.kind === 'move' || current.kind === 'paste') {
      if (current.kind === 'move' && !current.index &&
          Math.hypot(event.clientX - current.screenX, event.clientY - current.screenY) < 2) return;
      const destination = viewUnderPointer(event);
      if (destination) setPreviewView(destination);
      const point = destination && surfacePoint(event, destination);
      if (current.kind === 'move') previewMove(current, point);
      else if (pendingPaste) {
        current.placement = point ? previewPaste(point) : undefined;
        if (!point) layers.preview.replaceChildren();
      }
      return;
    }
    const point = surfacePoint(event, current.view);
    if (current.kind === 'marquee') {
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
      for (const piece of placementIndex.piecesAlong(current.previous, point)) {
        if (belongsToView(piece, current.view)) erasePiece(current, piece.id);
      }
      current.previous = point;
    } else if (current.kind === 'split') {
      previewSplit(current, point);
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
      previewPathDrawing(current, point);
    }
  }

  function movePointer(event, view) {
    if (gesture) {
      updateGesture(event);
      return;
    }
    if (event.pointerType !== 'touch') pointerHover = { clientX: event.clientX, clientY: event.clientY, view };
    if (spacePressed || (view === tableView && boardOnlyTools.has(tool))) return;
    if (pendingDrawing) {
      if (view === pendingDrawing.view && event.pointerType === 'mouse') {
        setPreviewView(view);
        previewPathDrawing(pendingDrawing, surfacePoint(event, view));
      }
      return;
    }
    setPreviewView(view);
    if (pendingPaste) previewPaste(surfacePoint(event));
    else if (tool === 'draw') previewDrawHover(event, view);
    else if (tool === 'split' && event.pointerType !== 'touch') previewSplitHover(surfacePoint(event));
    else if (tool === 'guideLine') {
      layers.preview.replaceChildren();
      markGuideAnchor(guideAnchorAt(surfacePoint(event)));
    } else if (tool === 'guideErase') {
      const nearest = Model.nearestGuide(project.guides, surfacePoint(event), snapDistance());
      layers.preview.replaceChildren();
      if (nearest) layers.preview.append(guideShape(project.guides[nearest.index], { class: 'board-guide-erase' }));
    }
  }

  function endPointer(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = gesture;
    if (event.type === 'pointerup') updateGesture(event);
    gesture = null;
    current.view.stage.classList.remove('is-panning');
    if (current.kind === 'paste' && event.type === 'pointerup') {
      finishPaste(current.placement);
      return;
    }
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
    if (current.kind === 'split') {
      finishSplit(current);
      return;
    }
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
        if (event.pointerType !== 'touch') previewDrawHover(event, current.view);
      }
      return;
    }
    finishPathDrawing(current, current.lastPoint);
  }

  function rotateSelected(angle, { absolute = false } = {}) {
    if (gesture || pendingPaste || !selectedIds.size) return;
    const selected = currentSelection();
    const degrees = absolute ? Model.angleInDegrees(angle) - selected[0].angle : angle % 360;
    if (!degrees) {
      renderSelection();
      return;
    }
    // The rotation preserves the spacing within the selection, including shared cut edges.
    const rotated = Model.rotatePieces(selected, degrees);
    const index = editingIndex(project, selectedIds);
    if (!rotated.every(piece => index.accepts(index.geometry(piece)))) {
      notify(selected.length === 1 ? 'rotationBlocked' : 'groupRotationBlocked');
      renderSelection();
      return;
    }
    const replacements = new Map(rotated.map(piece => [piece.id, piece]));
    const pieces = project.pieces.map(piece => replacements.get(piece.id) || piece);
    commit({ ...project, pieces });
  }

  function removeSelected() {
    if (!selectedIds.size || gesture || pendingPaste) return;
    const pieces = project.pieces.filter(piece => !selectedIds.has(piece.id));
    selectedIds.clear();
    commit({ ...project, pieces });
  }

  function minimumZoom(view) {
    return view === tableView ? Math.min(.25, view.fitZoom) : .25;
  }

  function resetView(view = boardView, fit = false) {
    if (gesture) return;
    if (view === tableView) view.fitted = fit;
    view.zoom = 1;
    view.center = { x: 0, y: 0 };
    renderView();
    if (view === previewView) layers.preview.replaceChildren();
  }

  function fitSavedWorktable() {
    if (worktableVisible && project.pieces.some(piece => belongsToView(piece, tableView))) resetView(tableView, true);
  }

  function changeZoom(view, factor, event) {
    if (gesture) return;
    const { zoom } = view;
    const nextZoom = Math.min(12, Math.max(minimumZoom(view), zoom * factor));
    if (event && zoom !== nextZoom) {
      const point = surfacePoint(event, view);
      const ratio = zoom / nextZoom;
      const { x, y, width, height } = view.canvas.viewBox.baseVal;
      view.center.x += (point.x - (x + width / 2)) * (1 - ratio);
      view.center.y += (point.y - (y + height / 2)) * (1 - ratio);
    }
    if (view === tableView) view.fitted = false;
    view.zoom = nextZoom;
    renderView();
    if (view === previewView) layers.preview.replaceChildren();
    if (event && !spacePressed && (pendingPaste || tool === 'split')) {
      setPreviewView(view);
      if (pendingPaste) previewPaste(surfacePoint(event));
      else previewSplitHover(surfacePoint(event));
    }
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
    for (const dialog of dialogs) if (dialog.open) dialog.close();
    projectGeneration++;
    copiedPieces = [];
    selectedIds.clear();
    clearLibraryFilters();
    resetView();
    resetView(tableView);
    worktableVisible = restored.worktable !== undefined;
    commit(restored);
    fitSavedWorktable();
    setTool('draw');
    notify('projectOpened');
  }

  function newProject(board, name) {
    if (gesture) return;
    projectGeneration++;
    copiedPieces = [];
    selectedIds.clear();
    clearLibraryFilters();
    resetView();
    const empty = Model.blankProject(project.tiles.filter(tile => !tile.archived), name);
    commit({ ...empty, board });
    setTool('draw');
    showDockPanel('tiles');
    byId('project-name').focus();
    byId('project-name').select();
  }

  function onKeyDown(event) {
    if (!placementIndex || dialogs.some(dialog => dialog.open)) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      if (cancelPendingDrawing()) return;
      if (!closeDisclosures(true)) returnToSelection();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === 's') {
      event.preventDefault();
      exportProject();
      return;
    }
    if (event.target.closest(editableFields)) return;
    if (event.metaKey || event.ctrlKey) {
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        if (event.shiftKey || key === 'y') redo();
        else undo();
      } else if (key === 'c' && !event.repeat && document.getSelection()?.isCollapsed !== false) {
        if (copySelection()) event.preventDefault();
      } else if (key === 'v' && beginPaste()) {
        event.preventDefault();
      }
      return;
    }
    if (gesture) return;
    if (event.code === 'Space') {
      if (event.target.closest('button, summary')) return;
      event.preventDefault();
      spacePressed = true;
      drawHover = undefined;
      for (const view of views) view.stage.classList.add('pan-ready');
      layers.preview.replaceChildren();
      return;
    }
    const shortcuts = { v: 'select', b: 'draw', l: 'line', m: 'shape', g: 'fill', e: 'erase', x: 'split', h: 'pan' };
    if (shortcuts[key]) setTool(shortcuts[key]);
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      removeSelected();
    }
    if (key === 'r') rotateByStep();
  }

  function returnToSelection() {
    if (gesture) {
      const { pointerId, view } = gesture;
      endPointer({ type: 'pointercancel', pointerId });
      if (view.canvas.hasPointerCapture(pointerId)) view.canvas.releasePointerCapture(pointerId);
    }
    stopSpacePan();
    if (pendingPaste) {
      setTool('select');
      return;
    }
    applySelection(new Set());
    setTool('select');
  }

  function stopSpacePan() {
    spacePressed = false;
    for (const view of views) view.stage.classList.remove('pan-ready');
  }

  function changeDrawAngle(angle) {
    if (gesture || !Number.isFinite(angle)) return;
    drawAngle = (Math.round(Model.angleInDegrees(angle) * 10) % 3600) / 10;
    if (tool === 'draw' && drawHover && !spacePressed) previewDrawHover(drawHover, drawHover.view);
  }

  function rotateByStep() {
    if (tool === 'draw') {
      changeDrawAngle(drawAngle + 15);
      if (drawAngleInput) drawAngleInput.value = drawAngle;
      return;
    }
    rotateSelected(15);
  }

  byId('language-select').addEventListener('change', event => {
    I18n.choose(event.target.value);
    renderTools();
    renderReferenceControls();
    renderPieceSummary();
    librarySource = undefined;
    renderLibrary();
    renderSelection();
    renderView();
    if (gesture?.kind === 'split' && gesture.end) previewSplit(gesture, gesture.end);
    else if (tool === 'split' && pointerHover && !spacePressed) {
      setPreviewView(pointerHover.view);
      previewSplitHover(surfacePoint(pointerHover));
    }
    if (saveStatus) setSaveStatus(saveStatus);
    if (!byId('feedback').hidden) renderFeedback();
  });

  bindSettings();
  bindLibraryFilters();
  byId('library-resizer')?.remove();
  expandLibrary?.addEventListener('click', toggleLibraryLayout);
  bindReferences();
  document.querySelectorAll('[data-dock-panel]').forEach(button => {
    button.addEventListener('click', () => {
      if (!gesture) showDockPanel(button.dataset.dockPanel);
    });
  });
  byId('guide-tool').addEventListener('click', () => {
    const next = toolAvailable(guideMode) ? guideMode : guideModes.find(toolAvailable);
    if (next) setTool(next);
  });
  for (const button of outlineButtons) {
    button.addEventListener('click', () => {
      if (gesture || !toolAvailable('shape')) return;
      outlineShape = button.dataset.outlineShape;
      setTool('shape');
    });
  }
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
  worktableButton.addEventListener('click', toggleWorktable);
  copyTilesButton?.addEventListener('click', copySelection);
  pasteTilesButton?.addEventListener('click', () => {
    if (pendingPaste) setTool('select');
    else beginPaste();
  });
  cancelPasteButton?.addEventListener('click', () => setTool('select'));
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
  selectedAngleInput.addEventListener('change', () => {
    rotateSelected(selectedAngleInput.valueAsNumber, { absolute: selectedIds.size === 1 });
  });
  selectedAngleInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectedAngleInput.blur();
    }
  });
  byId('delete-piece').addEventListener('click', removeSelected);
  byId('new-project').addEventListener('click', () => openBoardSettings(true));
  byId('edit-board').addEventListener('click', () => openBoardSettings(false));
  byId('edit-grid').addEventListener('click', openGridSettings);
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  byId('save-project').addEventListener('click', () => {
    closeDisclosures(true);
    exportProject();
  });
  byId('open-project').addEventListener('click', () => {
    closeDisclosures(true);
    byId('import-file').click();
  });
  byId('import-file').addEventListener('change', importProject);

  function closeDisclosures(restoreFocus = false, keep) {
    let closed = false;
    for (const disclosure of disclosures) {
      if (!disclosure.open || disclosure === keep) continue;
      const summary = disclosure.querySelector('summary');
      disclosure.open = false;
      if (restoreFocus) summary.focus({ preventScroll: true });
      closed = true;
    }
    return closed;
  }

  document.addEventListener('click', event => {
    closeDisclosures(false, event.target.closest('.app-menu, .status-popover'));
  });

  const viewObserver = new ResizeObserver(renderView);
  for (const view of views) {
    byId(view.zoomId + '-in').addEventListener('click', () => changeZoom(view, 1.25));
    byId(view.zoomId + '-out').addEventListener('click', () => changeZoom(view, .8));
    byId(view.zoomId + '-fit').addEventListener('click', () => resetView(view, true));
    view.stage.addEventListener('wheel', event => {
      if (gesture || event.target.closest('.zoom-controls')) return;
      event.preventDefault();
      changeZoom(view, Math.exp(Math.min(.25, Math.max(-.25, -event.deltaY * .002))), event);
    }, { passive: false });
    view.canvas.addEventListener('pointerdown', event => beginPointer(event, view));
    view.canvas.addEventListener('pointermove', event => movePointer(event, view));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      view.canvas.addEventListener(type, endPointer);
    }
    view.canvas.addEventListener('pointerleave', () => {
      if (drawHover?.view === view) drawHover = undefined;
      if (pointerHover?.view === view) pointerHover = undefined;
      if (!gesture && previewView === view) layers.preview.replaceChildren();
    });
    viewObserver.observe(view.stage);
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', event => {
    if (event.code === 'Space') stopSpacePan();
  });
  window.addEventListener('blur', stopSpacePan);

  async function initialize() {
    try {
      const saved = await Storage.load();
      useProject(saved ? Model.readProject(saved) : project);
      fitSavedWorktable();
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
