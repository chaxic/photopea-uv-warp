import {
  buildBuildingMesh,
  buildGridMesh,
  clonePoints,
  mapMeshToRect,
  validateProjectMesh,
} from "./mesh.js";
import {
  captureSource,
  createOutputLayerScript,
  isEmbeddedInPhotopea,
  parsePhotopeaMessage,
  postPhotopeaScript,
  requestSelectedLayer,
  scanSavedWarps,
  toggleSavedOutput,
} from "./photopea.js";
import { drawWarpedMesh, meshWarnings } from "./warp.js";

const elements = {
  shell: document.querySelector(".app-shell"),
  layerName: document.querySelector("#layer-name"),
  layerMeta: document.querySelector("#layer-meta"),
  captureSource: document.querySelector("#capture-source"),
  refreshProjects: document.querySelector("#refresh-projects"),
  savedBar: document.querySelector("#saved-bar"),
  savedProjects: document.querySelector("#saved-projects"),
  loadProject: document.querySelector("#load-project"),
  toggleOutput: document.querySelector("#toggle-output"),
  workspaceCard: document.querySelector("#workspace-card"),
  modeLayout: document.querySelector("#mode-layout"),
  modeWarp: document.querySelector("#mode-warp"),
  previewToggle: document.querySelector("#preview-toggle"),
  meshToggle: document.querySelector("#mesh-toggle"),
  focusToggle: document.querySelector("#focus-toggle"),
  editorWrap: document.querySelector("#editor-wrap"),
  canvas: document.querySelector("#warp-canvas"),
  emptyState: document.querySelector("#empty-state"),
  canvasBadge: document.querySelector("#canvas-badge"),
  selectionHint: document.querySelector("#selection-hint"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  controlsCard: document.querySelector("#controls-card"),
  preset: document.querySelector("#preset"),
  divisions: document.querySelector("#divisions"),
  orientation: document.querySelector("#orientation"),
  columns: document.querySelector("#columns"),
  rows: document.querySelector("#rows"),
  divisionsField: document.querySelector("#divisions-field"),
  orientationField: document.querySelector("#orientation-field"),
  columnsField: document.querySelector("#columns-field"),
  rowsField: document.querySelector("#rows-field"),
  viewPadding: document.querySelector("#view-padding"),
  referenceOpacity: document.querySelector("#reference-opacity"),
  referenceOpacityValue: document.querySelector("#reference-opacity-value"),
  resetLayout: document.querySelector("#reset-layout"),
  resetWarp: document.querySelector("#reset-warp"),
  createOutput: document.querySelector("#create-output"),
  statusCard: document.querySelector("#status-card"),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
};

const state = {
  mode: "layout",
  preview: true,
  meshVisible: true,
  focus: false,
  busy: false,
  project: null,
  captureMeta: null,
  sourceImage: null,
  backdropImage: null,
  captureBuffers: [],
  captureInProgress: false,
  pendingSavedProject: null,
  savedProjects: [],
  selectedPoints: new Set(),
  drag: null,
  undo: [],
  redo: [],
  renderFrame: 0,
};

function setStatus(tone, title, message) {
  elements.statusCard.dataset.tone = tone;
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
}

function setBusy(busy) {
  state.busy = busy;
  elements.captureSource.disabled = busy;
  elements.refreshProjects.disabled = busy;
  elements.loadProject.disabled = busy;
  elements.toggleOutput.disabled = busy;
  elements.createOutput.disabled = busy || !state.project;
  elements.resetLayout.disabled = busy || !state.project;
  elements.resetWarp.disabled = busy || !state.project;
}

function setToggle(button, active) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPoint(point) {
  return {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
  };
}

function numberValue(input, min, max) {
  const value = clamp(Math.round(Number(input.value) || min), min, max);
  input.value = String(value);
  return value;
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function randomProjectId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `uvwp-${Date.now().toString(36)}-${random}`;
}

function shortProjectId(projectId) {
  return projectId.replace(/^uvwp-/, "").slice(-8);
}

function safeLayerLabel(value) {
  return String(value || "Layer").replace(/[\r\n[\]]+/g, " ").trim().slice(0, 54);
}

function meshFromControls() {
  const preset = elements.preset.value;
  if (preset === "building") {
    return buildBuildingMesh(
      Number(elements.divisions.value),
      elements.orientation.value,
      0,
    );
  }
  if (preset === "single") return buildGridMesh(1, 1, 0);
  if (preset === "grid-2") return buildGridMesh(2, 2, 0);
  if (preset === "grid-3") return buildGridMesh(3, 3, 0);
  if (preset === "grid-4") return buildGridMesh(4, 4, 0);
  return buildGridMesh(
    numberValue(elements.columns, 1, 10),
    numberValue(elements.rows, 1, 10),
    0,
  );
}

function normalizedSourceBounds() {
  const bounds = state.captureMeta.bounds;
  const left = clamp(Math.min(bounds.left, bounds.right), 0, 1);
  const top = clamp(Math.min(bounds.top, bounds.bottom), 0, 1);
  const right = clamp(Math.max(bounds.left, bounds.right), 0, 1);
  const bottom = clamp(Math.max(bounds.top, bounds.bottom), 0, 1);
  if (!(right - left > 0.0001 && bottom - top > 0.0001)) {
    throw new Error("The visible part of this layer has no usable bounds.");
  }
  return { left, top, right, bottom };
}

function snapshotMesh() {
  if (!state.project) return null;
  return {
    name: state.project.mesh.name,
    warpLinked: Boolean(state.project.mesh.warpLinked),
    quads: state.project.mesh.quads.map((quad) => [...quad]),
    sourceVertices: clonePoints(state.project.mesh.sourceVertices),
    warpVertices: clonePoints(state.project.mesh.warpVertices),
  };
}

function restoreMesh(snapshot) {
  state.project.mesh = {
    name: snapshot.name,
    warpLinked: Boolean(snapshot.warpLinked),
    quads: snapshot.quads.map((quad) => [...quad]),
    sourceVertices: clonePoints(snapshot.sourceVertices),
    warpVertices: clonePoints(snapshot.warpVertices),
  };
  state.selectedPoints.clear();
  scheduleRender();
}

function pushUndo(previous) {
  if (!previous) return;
  state.undo.push(previous);
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  elements.undo.disabled = state.busy || state.undo.length === 0;
  elements.redo.disabled = state.busy || state.redo.length === 0;
}

function undo() {
  if (!state.project || !state.undo.length || state.busy) return;
  state.redo.push(snapshotMesh());
  restoreMesh(state.undo.pop());
  updateHistoryButtons();
}

function redo() {
  if (!state.project || !state.redo.length || state.busy) return;
  state.undo.push(snapshotMesh());
  restoreMesh(state.redo.pop());
  updateHistoryButtons();
}

function rebuildMesh({ recordHistory = true } = {}) {
  if (!state.captureMeta || !state.project) return;
  const previous = recordHistory ? snapshotMesh() : null;
  const localMesh = meshFromControls();
  const documentMesh = mapMeshToRect(localMesh, normalizedSourceBounds());
  state.project.mesh = {
    name: documentMesh.name,
    warpLinked: true,
    quads: documentMesh.quads,
    sourceVertices: documentMesh.vertices,
    warpVertices: clonePoints(documentMesh.vertices),
  };
  state.selectedPoints.clear();
  if (previous) pushUndo(previous);
  setMode("layout");
  scheduleRender();
  setStatus(
    "success",
    "Layout rebuilt",
    `${documentMesh.quads.length} connected ${documentMesh.quads.length === 1 ? "quad" : "quads"} created over the source.`,
  );
}

function resetWarp() {
  if (!state.project || state.busy) return;
  const previous = snapshotMesh();
  state.project.mesh.warpVertices = clonePoints(state.project.mesh.sourceVertices);
  state.project.mesh.warpLinked = true;
  state.selectedPoints.clear();
  pushUndo(previous);
  setMode("warp");
  scheduleRender();
  setStatus("info", "Warp reset", "The warp points now match the source layout again.");
}

function updateConditionalControls() {
  const building = elements.preset.value === "building";
  const custom = elements.preset.value === "custom";
  elements.divisionsField.classList.toggle("is-hidden", !building);
  elements.orientationField.classList.toggle("is-hidden", !building);
  elements.columnsField.classList.toggle("is-hidden", !custom);
  elements.rowsField.classList.toggle("is-hidden", !custom);
}

function setMode(mode) {
  state.mode = mode;
  setToggle(elements.modeLayout, mode === "layout");
  setToggle(elements.modeWarp, mode === "warp");
  elements.canvasBadge.textContent =
    mode === "layout"
      ? "Layout · move points over the source"
      : state.preview
        ? "Warp · live preview"
        : "Warp · original preview";
  elements.selectionHint.textContent =
    mode === "layout"
      ? "Place the points over source edges. Shift-click selects several."
      : "Move matching points onto the reference. Preview updates live.";
  scheduleRender();
}

function setProjectReady(ready) {
  elements.emptyState.classList.toggle("is-hidden", ready);
  elements.canvasBadge.classList.toggle("is-hidden", !ready);
  elements.canvas.classList.toggle("is-ready", ready);
  elements.modeLayout.disabled = !ready;
  elements.modeWarp.disabled = !ready;
  elements.previewToggle.disabled = !ready;
  elements.meshToggle.disabled = !ready;
  elements.createOutput.disabled = state.busy || !ready;
  elements.resetLayout.disabled = state.busy || !ready;
  elements.resetWarp.disabled = state.busy || !ready;
}

function editorViewRect() {
  if (elements.viewPadding.value === "full" || !state.captureMeta) {
    return { left: 0, top: 0, right: 1, bottom: 1 };
  }
  const bounds = normalizedSourceBounds();
  const fraction = Number(elements.viewPadding.value) / 100;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return {
    left: clamp(bounds.left - width * fraction, 0, 1),
    top: clamp(bounds.top - height * fraction, 0, 1),
    right: clamp(bounds.right + width * fraction, 0, 1),
    bottom: clamp(bounds.bottom + height * fraction, 0, 1),
  };
}

function prepareCanvas() {
  const rectangle = elements.canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rectangle.width * ratio));
  const height = Math.max(1, Math.round(rectangle.height * ratio));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }
  return { width, height, ratio };
}

function viewportMetrics() {
  const canvas = prepareCanvas();
  const view = editorViewRect();
  if (!state.captureMeta) {
    return { ...canvas, view, x: 0, y: 0, drawWidth: canvas.width, drawHeight: canvas.height };
  }
  const contentWidth = (view.right - view.left) * state.captureMeta.documentWidth;
  const contentHeight = (view.bottom - view.top) * state.captureMeta.documentHeight;
  const contentAspect = contentWidth / contentHeight;
  const padding = 9 * canvas.ratio;
  const availableWidth = Math.max(1, canvas.width - padding * 2);
  const availableHeight = Math.max(1, canvas.height - padding * 2);
  const canvasAspect = availableWidth / availableHeight;
  let drawWidth;
  let drawHeight;
  if (canvasAspect > contentAspect) {
    drawHeight = availableHeight;
    drawWidth = drawHeight * contentAspect;
  } else {
    drawWidth = availableWidth;
    drawHeight = drawWidth / contentAspect;
  }
  return {
    ...canvas,
    view,
    x: (canvas.width - drawWidth) / 2,
    y: (canvas.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}

function documentToCanvas(point, metrics) {
  return {
    x:
      metrics.x +
      ((point.x - metrics.view.left) / (metrics.view.right - metrics.view.left)) *
        metrics.drawWidth,
    y:
      metrics.y +
      ((point.y - metrics.view.top) / (metrics.view.bottom - metrics.view.top)) *
        metrics.drawHeight,
  };
}

function canvasToDocument(point, metrics) {
  return {
    x:
      metrics.view.left +
      ((point.x - metrics.x) / metrics.drawWidth) *
        (metrics.view.right - metrics.view.left),
    y:
      metrics.view.top +
      ((point.y - metrics.y) / metrics.drawHeight) *
        (metrics.view.bottom - metrics.view.top),
  };
}

function drawImageCrop(context, image, metrics, opacity = 1) {
  const sourceX = metrics.view.left * image.naturalWidth;
  const sourceY = metrics.view.top * image.naturalHeight;
  const sourceWidth = (metrics.view.right - metrics.view.left) * image.naturalWidth;
  const sourceHeight = (metrics.view.bottom - metrics.view.top) * image.naturalHeight;
  context.save();
  context.globalAlpha = opacity;
  context.beginPath();
  context.rect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  context.clip();
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    metrics.x,
    metrics.y,
    metrics.drawWidth,
    metrics.drawHeight,
  );
  context.restore();
}

function drawLiveWarp(context, metrics) {
  const sourceVertices = state.project.mesh.sourceVertices.map((point) => ({
    x: point.x * state.sourceImage.naturalWidth,
    y: point.y * state.sourceImage.naturalHeight,
  }));
  const targetVertices = state.project.mesh.warpVertices.map((point) =>
    documentToCanvas(point, metrics),
  );
  context.save();
  context.beginPath();
  context.rect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  context.clip();
  drawWarpedMesh(
    context,
    state.sourceImage,
    sourceVertices,
    targetVertices,
    state.project.mesh.quads,
    { seamOverlap: 0.5 * metrics.ratio },
  );
  context.restore();
}

function drawMeshOverlay(context, metrics) {
  if (!state.meshVisible) return;
  const activeVertices =
    state.mode === "layout"
      ? state.project.mesh.sourceVertices
      : state.project.mesh.warpVertices;
  const points = activeVertices.map((point) => documentToCanvas(point, metrics));

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const quad of state.project.mesh.quads) {
    context.beginPath();
    quad.forEach((index, corner) => {
      const point = points[index];
      if (corner === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.fillStyle =
      state.mode === "layout"
        ? "rgba(119, 132, 255, 0.075)"
        : "rgba(74, 224, 181, 0.055)";
    context.fill();
    context.strokeStyle =
      state.mode === "layout"
        ? "rgba(170, 178, 255, 0.92)"
        : "rgba(105, 232, 194, 0.94)";
    context.lineWidth = 1.25 * metrics.ratio;
    context.stroke();
  }

  points.forEach((point, index) => {
    const selected = state.selectedPoints.has(index);
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      (selected ? 5.4 : 4.1) * metrics.ratio,
      0,
      Math.PI * 2,
    );
    context.fillStyle = selected
      ? "#ffffff"
      : state.mode === "layout"
        ? "#cbd0ff"
        : "#b8ffe9";
    context.fill();
    context.strokeStyle =
      state.mode === "layout" ? "#5868e6" : "#168d6b";
    context.lineWidth = (selected ? 2 : 1.4) * metrics.ratio;
    context.stroke();
  });
  context.restore();
}

function render() {
  state.renderFrame = 0;
  const metrics = viewportMetrics();
  const context = elements.canvas.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, metrics.width, metrics.height);
  context.fillStyle = "#111318";
  context.fillRect(0, 0, metrics.width, metrics.height);

  if (!state.project || !state.sourceImage || !state.backdropImage) return;

  context.fillStyle = "#0d0f12";
  context.fillRect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  const referenceOpacity = Number(elements.referenceOpacity.value) / 100;
  drawImageCrop(context, state.backdropImage, metrics, referenceOpacity);

  if (state.mode === "layout" || !state.preview) {
    drawImageCrop(context, state.sourceImage, metrics, 1);
  } else {
    drawLiveWarp(context, metrics);
  }

  drawMeshOverlay(context, metrics);
}

function scheduleRender() {
  if (state.renderFrame) return;
  state.renderFrame = requestAnimationFrame(render);
}

function pointerPosition(event, metrics) {
  const rectangle = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rectangle.left) * metrics.ratio,
    y: (event.clientY - rectangle.top) * metrics.ratio,
  };
}

function activeVertices() {
  if (!state.project) return [];
  return state.mode === "layout"
    ? state.project.mesh.sourceVertices
    : state.project.mesh.warpVertices;
}

function nearestPoint(canvasPoint, metrics) {
  const points = activeVertices();
  let nearest = -1;
  let best = 11 * metrics.ratio;
  points.forEach((point, index) => {
    const display = documentToCanvas(point, metrics);
    const distance = Math.hypot(display.x - canvasPoint.x, display.y - canvasPoint.y);
    if (distance <= best) {
      best = distance;
      nearest = index;
    }
  });
  return nearest;
}

function handlePointerDown(event) {
  if (!state.project || state.busy || event.button !== 0) return;
  const metrics = viewportMetrics();
  const canvasPoint = pointerPosition(event, metrics);
  const index = nearestPoint(canvasPoint, metrics);
  if (index < 0) {
    if (!event.shiftKey) state.selectedPoints.clear();
    scheduleRender();
    return;
  }

  if (event.shiftKey) {
    if (state.selectedPoints.has(index)) state.selectedPoints.delete(index);
    else state.selectedPoints.add(index);
  } else if (!state.selectedPoints.has(index)) {
    state.selectedPoints.clear();
    state.selectedPoints.add(index);
  }
  if (!state.selectedPoints.size) {
    scheduleRender();
    return;
  }

  const pointerDocument = canvasToDocument(canvasPoint, metrics);
  const vertices = activeVertices();
  const starts = new Map();
  state.selectedPoints.forEach((selectedIndex) => {
    starts.set(selectedIndex, { ...vertices[selectedIndex] });
  });
  state.drag = {
    pointerId: event.pointerId,
    startPointer: pointerDocument,
    starts,
    warpStarts:
      state.mode === "layout" && state.project.mesh.warpLinked
        ? new Map(
            [...state.selectedPoints].map((selectedIndex) => [
              selectedIndex,
              { ...state.project.mesh.warpVertices[selectedIndex] },
            ]),
          )
        : null,
    before: snapshotMesh(),
    changed: false,
  };
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-dragging");
  scheduleRender();
  event.preventDefault();
}

function handlePointerMove(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const metrics = viewportMetrics();
  const pointerDocument = canvasToDocument(pointerPosition(event, metrics), metrics);
  const delta = {
    x: pointerDocument.x - state.drag.startPointer.x,
    y: pointerDocument.y - state.drag.startPointer.y,
  };
  const vertices = activeVertices();
  state.drag.starts.forEach((start, index) => {
    const nextPoint = clampPoint({
      x: start.x + delta.x,
      y: start.y + delta.y,
    });
    vertices[index] = nextPoint;
    if (state.drag.warpStarts) {
      state.project.mesh.warpVertices[index] = { ...nextPoint };
    }
  });
  state.drag.changed = Math.abs(delta.x) > 1e-7 || Math.abs(delta.y) > 1e-7;
  scheduleRender();
  event.preventDefault();
}

function finishPointerDrag(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  if (state.drag.changed) {
    if (state.mode === "warp") state.project.mesh.warpLinked = false;
    pushUndo(state.drag.before);
    const warning = meshWarnings(
      state.project.mesh.sourceVertices,
      state.project.mesh.warpVertices,
      state.project.mesh.quads,
    );
    if (warning.degenerate) {
      setStatus("warning", "Collapsed mesh area", "Move overlapping points apart before creating the output.");
    } else if (warning.flipped) {
      setStatus("warning", "Folded mesh area", "A triangle crosses over itself. This is allowed, but may produce a mirrored fold.");
    } else {
      setStatus(
        "success",
        state.mode === "layout" ? "Layout updated" : "Warp updated",
        `${state.selectedPoints.size} ${state.selectedPoints.size === 1 ? "point" : "points"} moved.`,
      );
    }
  }
  try { elements.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  state.drag = null;
  elements.canvas.classList.remove("is-dragging");
  scheduleRender();
}

function nudgeSelection(event) {
  if (!state.project || !state.selectedPoints.size) return false;
  const directions = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (!directions[event.key]) return false;
  const [dx, dy] = directions[event.key];
  const pixels = event.shiftKey ? 10 : 1;
  const before = snapshotMesh();
  const vertices = activeVertices();
  state.selectedPoints.forEach((index) => {
    const nextPoint = clampPoint({
      x: vertices[index].x + (dx * pixels) / state.captureMeta.documentWidth,
      y: vertices[index].y + (dy * pixels) / state.captureMeta.documentHeight,
    });
    vertices[index] = nextPoint;
    if (state.mode === "layout" && state.project.mesh.warpLinked) {
      state.project.mesh.warpVertices[index] = { ...nextPoint };
    }
  });
  if (state.mode === "warp") state.project.mesh.warpLinked = false;
  pushUndo(before);
  scheduleRender();
  return true;
}

function handleKeyDown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (nudgeSelection(event)) event.preventDefault();
}

function imageFromBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buffer], { type: "image/png" }));
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Photopea returned an image that the panel could not read."));
    };
    image.src = url;
  });
}

function updateSourceSummary() {
  if (!state.captureMeta) return;
  elements.layerName.textContent = state.captureMeta.layerName;
  elements.layerMeta.textContent =
    `${Math.round(state.captureMeta.documentWidth)} × ${Math.round(state.captureMeta.documentHeight)} px document · ` +
    (state.captureMeta.smartObject ? "Smart Object" : "Raster layer");
}

function projectFromCapture() {
  const projectId = randomProjectId();
  const shortId = shortProjectId(projectId);
  const sourceLabel = safeLayerLabel(state.captureMeta.layerName);
  return {
    schemaVersion: 1,
    projectId,
    source: {
      layerId: state.captureMeta.layerId,
      layerName: state.captureMeta.layerName,
      documentName: state.captureMeta.documentName,
      documentSource: state.captureMeta.documentSource,
      documentWidth: state.captureMeta.documentWidth,
      documentHeight: state.captureMeta.documentHeight,
      bounds: state.captureMeta.bounds,
      smartObject: state.captureMeta.smartObject,
    },
    mesh: {
      name: "",
      warpLinked: true,
      quads: [],
      sourceVertices: [],
      warpVertices: [],
    },
    output: {
      groupName: `UV Warp — ${sourceLabel} [UVWP:${shortId}]`,
      resultName: `UV Warp Result [${shortId}]`,
      dataLayerName: `UV Warp Data [${shortId}]`,
    },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLoadedProject(project) {
  if (!project || project.schemaVersion !== 1 || !project.source || !project.output) {
    throw new Error("This saved UV Warp uses an unsupported data format.");
  }
  validateProjectMesh(project.mesh);
  return {
    ...project,
    source: {
      ...project.source,
      layerId: state.captureMeta.layerId,
      layerName: state.captureMeta.layerName,
      documentName: state.captureMeta.documentName,
      documentSource: state.captureMeta.documentSource,
      documentWidth: state.captureMeta.documentWidth,
      documentHeight: state.captureMeta.documentHeight,
      bounds: state.captureMeta.bounds,
      smartObject: state.captureMeta.smartObject,
    },
    mesh: {
      name: project.mesh.name,
      warpLinked: Boolean(project.mesh.warpLinked),
      quads: project.mesh.quads.map((quad) => [...quad]),
      sourceVertices: clonePoints(project.mesh.sourceVertices),
      warpVertices: clonePoints(project.mesh.warpVertices),
    },
  };
}

async function finishCapture() {
  try {
    if (state.captureBuffers.length !== 2 || !state.captureMeta) {
      throw new Error("Photopea did not return both the source and reference images.");
    }
    const [backdropImage, sourceImage] = await Promise.all(
      state.captureBuffers.map(imageFromBuffer),
    );
    state.backdropImage = backdropImage;
    state.sourceImage = sourceImage;
    if (state.pendingSavedProject) {
      state.project = normalizeLoadedProject(state.pendingSavedProject);
      state.pendingSavedProject = null;
      state.undo = [];
      state.redo = [];
      setMode("warp");
      setStatus(
        "success",
        "Saved warp loaded",
        "The saved mesh is editable again. Create output to update the result.",
      );
    } else {
      state.project = projectFromCapture();
      state.undo = [];
      state.redo = [];
      rebuildMesh({ recordHistory: false });
      setStatus(
        state.captureMeta.smartObject ? "success" : "warning",
        state.captureMeta.smartObject ? "Source captured" : "Source is not a Smart Object",
        state.captureMeta.smartObject
          ? "Arrange the source mesh in Layout, then switch to Warp."
          : "The original is still untouched, but converting it to a Smart Object is recommended.",
      );
    }
    updateSourceSummary();
    setProjectReady(true);
    setBusy(false);
    updateHistoryButtons();
    scheduleRender();
  } catch (error) {
    state.project = null;
    state.pendingSavedProject = null;
    setProjectReady(false);
    setBusy(false);
    setStatus("error", "Capture failed", error.message);
  } finally {
    state.captureInProgress = false;
    state.captureBuffers = [];
  }
}

function beginCapture(savedProject = null) {
  if (state.busy) return;
  if (!isEmbeddedInPhotopea()) {
    setStatus(
      "error",
      "Open inside Photopea",
      "Load plugin.local.json or the hosted plugin JSON through Window → Plugins.",
    );
    return;
  }
  state.captureInProgress = true;
  state.captureBuffers = [];
  state.captureMeta = null;
  state.pendingSavedProject = savedProject;
  setBusy(true);
  setStatus(
    "info",
    savedProject ? "Loading saved warp…" : "Capturing source…",
    "Photopea is rendering the selected layer and the visible reference underneath.",
  );
  captureSource({
    sourceLayerId: savedProject ? savedProject.source.layerId : null,
    hideGroupName: savedProject ? savedProject.output.groupName : "",
  });
}

function serializeProject() {
  const project = {
    ...state.project,
    source: {
      ...state.project.source,
      layerId: state.captureMeta.layerId,
      layerName: state.captureMeta.layerName,
      documentName: state.captureMeta.documentName,
      documentSource: state.captureMeta.documentSource,
      documentWidth: state.captureMeta.documentWidth,
      documentHeight: state.captureMeta.documentHeight,
      bounds: state.captureMeta.bounds,
      smartObject: state.captureMeta.smartObject,
    },
    mesh: snapshotMesh(),
    view: {
      referenceOpacity: Number(elements.referenceOpacity.value),
      viewPadding: elements.viewPadding.value,
    },
    updatedAt: new Date().toISOString(),
  };
  validateProjectMesh(project.mesh);
  return project;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode the warped image."));
    }, "image/png");
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The rendered PNG could not be prepared for Photopea."));
    reader.readAsDataURL(blob);
  });
}

async function createOutput() {
  if (!state.project || state.busy) return;
  try {
    validateProjectMesh(state.project.mesh);
    const width = state.sourceImage.naturalWidth;
    const height = state.sourceImage.naturalHeight;
    if (width * height > 180_000_000) {
      throw new Error("This document is too large to render safely in the browser.");
    }
    const sourceVertices = state.project.mesh.sourceVertices.map((point) => ({
      x: point.x * width,
      y: point.y * height,
    }));
    const warpVertices = state.project.mesh.warpVertices.map((point) => ({
      x: point.x * width,
      y: point.y * height,
    }));
    const warnings = meshWarnings(
      sourceVertices,
      warpVertices,
      state.project.mesh.quads,
    );
    if (warnings.degenerate) {
      throw new Error("One or more mesh triangles are collapsed. Move overlapping points apart.");
    }

    setBusy(true);
    setStatus(
      "info",
      "Rendering output…",
      `${width} × ${height} px · ${state.project.mesh.quads.length} connected quads`,
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext("2d", { alpha: true });
    outputContext.clearRect(0, 0, width, height);
    drawWarpedMesh(
      outputContext,
      state.sourceImage,
      sourceVertices,
      warpVertices,
      state.project.mesh.quads,
      { seamOverlap: 0.7 },
    );

    const project = serializeProject();
    const blob = await canvasToBlob(outputCanvas);
    const dataUrl = await blobToDataUrl(blob);
    const stateBase64 = encodeBase64Utf8(JSON.stringify(project));
    state.project = project;
    const script = createOutputLayerScript({
      dataUrl,
      sourceLayerId: project.source.layerId,
      sourceLayerName: project.source.layerName,
      projectId: project.projectId,
      stateBase64,
      groupName: project.output.groupName,
      resultName: project.output.resultName,
      dataLayerName: project.output.dataLayerName,
    });
    setStatus(
      "info",
      "Sending output to Photopea…",
      "The warped PNG and editable mesh data are being added to the PSD.",
    );
    postPhotopeaScript(script);
  } catch (error) {
    setBusy(false);
    setStatus("error", "Could not create output", error.message);
  }
}

function parseSavedProjects(items) {
  const projects = [];
  for (const item of items || []) {
    try {
      const project = JSON.parse(decodeBase64Utf8(item.data));
      validateProjectMesh(project.mesh);
      project.output = project.output || {};
      if (!project.output.groupName && item.groupName) {
        project.output.groupName = item.groupName;
      }
      projects.push(project);
    } catch (_) {
      // Ignore malformed hidden text layers instead of blocking valid saved warps.
    }
  }
  return projects.sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );
}

function updateSavedProjects() {
  elements.savedProjects.replaceChildren();
  state.savedProjects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = `${project.source.layerName} · ${
      project.mesh.quads.length
    } ${project.mesh.quads.length === 1 ? "quad" : "quads"}`;
    elements.savedProjects.append(option);
  });
  elements.savedBar.classList.toggle("is-hidden", state.savedProjects.length === 0);
}

function selectedSavedProject() {
  return state.savedProjects.find(
    (project) => project.projectId === elements.savedProjects.value,
  );
}

function loadSelectedProject() {
  const project = selectedSavedProject();
  if (!project) return;
  if (project.view) {
    elements.referenceOpacity.value = String(
      clamp(Number(project.view.referenceOpacity) || 65, 0, 100),
    );
    elements.referenceOpacityValue.textContent = `${elements.referenceOpacity.value}%`;
    if (["10", "25", "50", "full"].includes(String(project.view.viewPadding))) {
      elements.viewPadding.value = String(project.view.viewPadding);
    }
  }
  beginCapture(project);
}

function toggleSelectedOutput() {
  const project =
    (state.project && state.project.output?.groupName ? state.project : null) ||
    selectedSavedProject();
  if (!project || state.busy) return;
  setBusy(true);
  setStatus("info", "Toggling result…", "Switching between the original source and warped output.");
  toggleSavedOutput({
    groupName: project.output.groupName,
    sourceLayerId: project.source.layerId,
    sourceLayerName: project.source.layerName,
  });
}

function refreshPhotopeaState() {
  if (!isEmbeddedInPhotopea()) {
    elements.layerName.textContent = "Panel preview";
    elements.layerMeta.textContent = "Install this panel in Photopea to capture a layer.";
    setStatus(
      "warning",
      "Open inside Photopea",
      "The interface is responsive here; image capture requires the Photopea panel.",
    );
    return;
  }
  requestSelectedLayer();
  scanSavedWarps();
}

function handlePhotopeaResponse(event) {
  if (event.source !== window.parent) return;
  if (event.data instanceof ArrayBuffer) {
    if (state.captureInProgress) state.captureBuffers.push(event.data);
    return;
  }
  const message = parsePhotopeaMessage(event.data);
  if (!message) return;

  if (message.type === "selection") {
    if (message.ok && !state.captureInProgress) {
      elements.layerName.textContent = message.name;
      elements.layerMeta.textContent = `${Math.round(message.width)} × ${Math.round(
        message.height,
      )} px · ${message.smartObject ? "Smart Object" : "convert to Smart Object first"}`;
    } else if (!message.ok && !state.captureInProgress) {
      elements.layerName.textContent = "No usable layer selected";
      elements.layerMeta.textContent = message.message;
    }
    return;
  }

  if (message.type === "capture-meta") {
    if (message.ok) state.captureMeta = message;
    return;
  }

  if (message.type === "capture-complete") {
    if (!message.ok) {
      state.captureInProgress = false;
      state.pendingSavedProject = null;
      setBusy(false);
      setStatus("error", "Capture failed", message.message);
      return;
    }
    finishCapture();
    return;
  }

  if (message.type === "saved-projects") {
    if (message.ok) {
      state.savedProjects = parseSavedProjects(message.projects);
      updateSavedProjects();
    } else {
      setStatus("warning", "Could not read saved warps", message.message);
    }
    return;
  }

  if (message.type === "output-result") {
    setBusy(false);
    if (message.ok) {
      setStatus(
        "success",
        "Output created",
        "The warped result and editable mesh data are saved in the PSD.",
      );
      scanSavedWarps();
    } else {
      setStatus("error", "Photopea could not add the output", message.message);
    }
    return;
  }

  if (message.type === "toggle-result") {
    setBusy(false);
    if (message.ok) {
      setStatus(
        "success",
        message.visible ? "UV Warp enabled" : "UV Warp disabled",
        message.visible ? "Showing the warped output." : "Showing the untouched source.",
      );
    } else {
      setStatus("error", "Could not toggle output", message.message);
    }
  }
}

elements.captureSource.addEventListener("click", () => beginCapture());
elements.refreshProjects.addEventListener("click", refreshPhotopeaState);
elements.loadProject.addEventListener("click", loadSelectedProject);
elements.toggleOutput.addEventListener("click", toggleSelectedOutput);
elements.modeLayout.addEventListener("click", () => setMode("layout"));
elements.modeWarp.addEventListener("click", () => setMode("warp"));
elements.previewToggle.addEventListener("click", () => {
  state.preview = !state.preview;
  setToggle(elements.previewToggle, state.preview);
  setMode(state.mode);
});
elements.meshToggle.addEventListener("click", () => {
  state.meshVisible = !state.meshVisible;
  setToggle(elements.meshToggle, state.meshVisible);
  scheduleRender();
});
elements.focusToggle.addEventListener("click", () => {
  state.focus = !state.focus;
  elements.shell.classList.toggle("is-focus", state.focus);
  setToggle(elements.focusToggle, state.focus);
  scheduleRender();
});
elements.preset.addEventListener("change", updateConditionalControls);
elements.referenceOpacity.addEventListener("input", () => {
  elements.referenceOpacityValue.textContent = `${elements.referenceOpacity.value}%`;
  scheduleRender();
});
elements.viewPadding.addEventListener("change", scheduleRender);
elements.resetLayout.addEventListener("click", () => rebuildMesh());
elements.resetWarp.addEventListener("click", resetWarp);
elements.createOutput.addEventListener("click", createOutput);
elements.undo.addEventListener("click", undo);
elements.redo.addEventListener("click", redo);
elements.canvas.addEventListener("pointerdown", handlePointerDown);
elements.canvas.addEventListener("pointermove", handlePointerMove);
elements.canvas.addEventListener("pointerup", finishPointerDrag);
elements.canvas.addEventListener("pointercancel", finishPointerDrag);
elements.canvas.addEventListener("keydown", handleKeyDown);
window.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }
  handleKeyDown(event);
});
window.addEventListener("message", handlePhotopeaResponse);
window.addEventListener("resize", scheduleRender);

const resizeObserver = new ResizeObserver(scheduleRender);
resizeObserver.observe(elements.editorWrap);

updateConditionalControls();
setToggle(elements.previewToggle, state.preview);
setToggle(elements.meshToggle, state.meshVisible);
setProjectReady(false);
updateHistoryButtons();
scheduleRender();
refreshPhotopeaState();
