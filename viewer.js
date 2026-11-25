(function () {
  'use strict';

  const Model = window.MosaicGeometry;
  const I18n = window.MosaicI18n;
  const { svgElement, pieceShape, renderGrout, renderBoard, paintReference } = window.MosaicBoard;
  const XLINK = 'http://www.w3.org/1999/xlink';
  const zoomLevels = [1, 1.5, 2, 3, 4];
  const byId = id => document.getElementById(id);
  const viewport = byId('viewer-viewport');
  const canvas = byId('viewer-board');
  const layers = {
    board: byId('board-layer'),
    references: byId('reference-layer'),
    grid: byId('grid-layer'),
    grout: byId('grout-layer'),
    pieces: byId('piece-layer'),
    guides: byId('guide-layer')
  };
  let project;
  let zoomStep = 0;
  let request = 0;
  let statusKey;

  function renderStatus() {
    const status = byId('viewer-status');
    status.textContent = statusKey ? I18n.text(statusKey) : '';
    if (statusKey && statusKey !== 'viewerLoading') status.setAttribute('data-error', '');
    else status.removeAttribute('data-error');
  }

  function renderLabels() {
    document.title = project ? project.name + ' · Mosaic Planner' : 'Mosaic Planner · ' + I18n.text('viewer');
    byId('zoom-level').textContent = I18n.percent(zoomLevels[zoomStep]);
    if (!project) return;
    const { board, pieces } = project;
    const width = I18n.number(board.width);
    const size = board.shape === 'circle' ? 'Ø ' + width : width + ' × ' + I18n.number(board.height);
    const pieceCount = I18n.text(pieces.length === 1 ? 'oneTile' : 'manyTiles', { count: pieces.length });
    byId('viewer-size').textContent = size + ' mm · ' + pieceCount;
  }

  function setZoom(step) {
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight;
    zoomStep = step;
    const scale = zoomLevels[step] * 100 + '%';
    canvas.style.width = scale;
    canvas.style.height = scale;
    viewport.scrollLeft = step ? centerX * viewport.scrollWidth - viewport.clientWidth / 2 : 0;
    viewport.scrollTop = step ? centerY * viewport.scrollHeight - viewport.clientHeight / 2 : 0;
    byId('zoom-level').textContent = I18n.percent(zoomLevels[step]);
    byId('zoom-out').disabled = step === 0;
    byId('zoom-in').disabled = step === zoomLevels.length - 1;
  }

  function showProject(next) {
    const images = document.createDocumentFragment();
    for (const reference of next.references) {
      if (!reference.visible || !reference.opacity) continue;
      const image = svgElement('image');
      // Safari 12.0 uses the SVG 1.1 name for the image source.
      image.setAttributeNS(XLINK, 'xlink:href', reference.source);
      paintReference(image, reference);
      images.appendChild(image);
    }
    const tileTypes = new Map(next.tiles.map(tile => [tile.id, tile]));
    const table = Model.worktableBounds(next.board, next.worktable);
    const mosaicPieces = next.pieces.filter(piece => !Model.isOnWorktable(table, piece));
    const pieces = document.createDocumentFragment();
    for (const piece of mosaicPieces) {
      const tile = tileTypes.get(piece.tileId);
      pieces.appendChild(pieceShape(piece, tile, { class: 'piece-face', fill: tile.color }));
    }

    renderBoard(next, layers);
    layers.references.textContent = '';
    layers.references.appendChild(images);
    if (renderGrout) renderGrout({ ...next, pieces: mosaicPieces }, tileTypes, layers.grout);
    layers.pieces.textContent = '';
    layers.pieces.appendChild(pieces);
    const { width, height } = next.board;
    const margin = Math.max(width, height) * .06;
    canvas.setAttribute('viewBox', [-width / 2 - margin, -height / 2 - margin,
      width + margin * 2, height + margin * 2].join(' '));
    project = { ...next, pieces: mosaicPieces };
    byId('viewer-name').textContent = project.name;
    byId('viewer-empty').hidden = true;
    byId('viewer-project').hidden = false;
    setZoom(0);
    renderLabels();
  }

  function readFile(file) {
    if (file.size > Model.MAX_PROJECT_FILE) throw new Model.ValidationError('projectFileTooLarge');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reader.onabort = () => reject(new Error('FileReader failed'));
      reader.readAsText(file);
    });
  }

  async function loadProject(readText) {
    const id = ++request;
    statusKey = 'viewerLoading';
    renderStatus();
    try {
      const source = await readText();
      if (id !== request) return;
      showProject(Model.readProject(JSON.parse(source)));
      statusKey = null;
    } catch (error) {
      if (id !== request) return;
      if (error instanceof SyntaxError) statusKey = 'invalidJson';
      else if (error instanceof Model.ValidationError) statusKey = error.message;
      else statusKey = 'viewerLoadFailed';
    }
    renderStatus();
  }

  async function readLinkedProject(path) {
    const url = new URL(path, window.location.href);
    if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin) {
      throw new Error('Expected a project on this site');
    }
    const response = await fetch(url.href, { mode: 'same-origin' });
    if (!response.ok) throw new Error('Project request failed');
    return readFile(await response.blob());
  }

  I18n.initialize();
  renderLabels();
  byId('language-select').addEventListener('change', event => {
    I18n.choose(event.target.value);
    renderLabels();
    renderStatus();
  });
  byId('project-file').addEventListener('change', event => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (file) loadProject(() => readFile(file));
  });
  byId('zoom-out').addEventListener('click', () => setZoom(zoomStep - 1));
  byId('zoom-in').addEventListener('click', () => setZoom(zoomStep + 1));
  byId('zoom-fit').addEventListener('click', () => setZoom(0));

  const path = new URLSearchParams(window.location.search).get('project');
  if (path) loadProject(() => readLinkedProject(path));
}());
