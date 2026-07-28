import { clonePoints, validateProjectMesh } from "./mesh.js";
import {
  computeIslands,
  facesInIslandOrder,
  islandAtPoint,
  islandContainingSelection,
  islandHue,
  orderedIslands,
  lowerIslandInOrder,
  raiseIslandInOrder,
  resolveIslandOrder,
} from "./islands.js";
import {
  deleteTemplate as removeStoredTemplate,
  fitMeshToBounds,
  getTemplate,
  importTemplates,
  listTemplates,
  meshToTemplate,
  parseTemplateFile,
  serializeTemplate,
  upsertTemplate,
} from "./templates.js";
import {
  createOutputFinalizeScript,
  createSaveMeshScript,
  isEmbeddedInPhotopea,
  makeCloseTemporaryScript,
  makePrepareCapturePngScript,
  makeSnapshotScript,
  parsePhotopeaMessage,
  postPhotopeaBinary,
  postPhotopeaScript,
  readCaptureMeta,
  requestSelectedLayer,
  scanSavedWarps,
  toggleSavedOutput,
} from "./photopea.js";
import {
  applyPenAction,
  deleteEdge,
  deleteFace,
  deleteVertex,
  drawableEdges,
  edgeUsage,
  ensureEdges,
  facesEqual,
  findFaceAtPoint,
  nearestEdge,
  nearestVertex,
  resolvePenAction,
  seedQuadMesh,
  triangulateFaces,
  validateEdges,
  validateFaces,
  vertexUsage,
  verticesInRect,
} from "./polypen.js";
import { drawWarpedMesh, meshWarnings, triangulateQuads } from "./warp.js";

const CAPTURE_TIMEOUT_MS = 120_000;
const OUTPUT_TIMEOUT_MS = 90_000;
const HISTORY_LIMIT = 80;
const EXPLODE_SCALE = 0.84;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 12;
const ZOOM_STEP = 1.25;
// Photopea stores project data in a text layer, so the payload must stay small.
const MAX_STATE_BYTES = 400_000;

const elements = {
  shell: document.querySelector(".app-shell"),
  layerName: document.querySelector("#layer-name"),
  layerMeta: document.querySelector("#layer-meta"),
  captureSource: document.querySelector("#capture-source"),
  clearSource: document.querySelector("#clear-source"),
  captureReference: document.querySelector("#capture-reference"),
  loadReference: document.querySelector("#load-reference"),
  clearReference: document.querySelector("#clear-reference"),
  referenceFile: document.querySelector("#reference-file"),
  referenceName: document.querySelector("#reference-name"),
  referenceMeta: document.querySelector("#reference-meta"),
  refreshProjects: document.querySelector("#refresh-projects"),
  savedBar: document.querySelector("#saved-bar"),
  savedProjects: document.querySelector("#saved-projects"),
  loadProject: document.querySelector("#load-project"),
  toggleOutput: document.querySelector("#toggle-output"),
  modeLayout: document.querySelector("#mode-layout"),
  modeWarp: document.querySelector("#mode-warp"),
  toolPen: document.querySelector("#tool-pen"),
  toolSelect: document.querySelector("#tool-select"),
  drawModeLine: document.querySelector("#draw-mode-line"),
  drawModeFace: document.querySelector("#draw-mode-face"),
  drawModeTools: document.querySelector("#draw-mode-tools"),
  layoutToolCluster: document.querySelector("#layout-tool-cluster"),
  layoutTools: document.querySelector("#layout-tools"),
  previewToggle: document.querySelector("#preview-toggle"),
  meshToggle: document.querySelector("#mesh-toggle"),
  trianglesToggle: document.querySelector("#triangles-toggle"),
  connectionsToggle: document.querySelector("#connections-toggle"),
  fullscreenToggle: document.querySelector("#fullscreen-toggle"),
  editorWrap: document.querySelector("#editor-wrap"),
  canvas: document.querySelector("#warp-canvas"),
  emptyState: document.querySelector("#empty-state"),
  canvasBadge: document.querySelector("#canvas-badge"),
  selectionHint: document.querySelector("#selection-hint"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  deleteSelection: document.querySelector("#delete-selection"),
  sourceOpacity: document.querySelector("#source-opacity"),
  sourceOpacityValue: document.querySelector("#source-opacity-value"),
  referenceOpacity: document.querySelector("#reference-opacity"),
  referenceOpacityValue: document.querySelector("#reference-opacity-value"),
  referenceTintToggle: document.querySelector("#reference-tint-toggle"),
  referenceTintColor: document.querySelector("#reference-tint-color"),
  backgroundColor: document.querySelector("#background-color"),
  resetLayout: document.querySelector("#reset-layout"),
  resetWarp: document.querySelector("#reset-warp"),
  saveMesh: document.querySelector("#save-mesh"),
  createOutput: document.querySelector("#create-output"),
  raiseIsland: document.querySelector("#raise-island"),
  islandsToggle: document.querySelector("#islands-toggle"),
  meshTemplates: document.querySelector("#mesh-templates"),
  saveTemplate: document.querySelector("#save-template"),
  applyTemplate: document.querySelector("#apply-template"),
  deleteTemplate: document.querySelector("#delete-template"),
  exportTemplate: document.querySelector("#export-template"),
  importTemplate: document.querySelector("#import-template"),
  templateFile: document.querySelector("#template-file"),
  statusCard: document.querySelector("#status-card"),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
};

const state = {
  mode: "layout",
  layoutTool: "pen",
  insertMode: "tri-quad",
  faceMode: true,
  ctrlLineHeld: false,
  preview: true,
  meshVisible: true,
  trianglesVisible: false,
  connectionsVisible: false,
  islandsVisible: false,
  selectedIslandId: null,
  lastPointerDocument: null,
  fullscreen: false,
  referenceTint: false,
  busy: false,
  project: null,
  captureMeta: null,
  sourceImage: null,
  backdropImage: null,
  referenceMeta: null,
  pendingReferenceRestore: null,
  captureSession: null,
  pendingSavedProject: null,
  savedProjects: [],
  selectedPoints: new Set(),
  selectedEdge: null,
  selectedFace: null,
  penPreview: null,
  hoverVertex: -1,
  zoom: 1,
  pan: { x: 0, y: 0 },
  panDrag: null,
  panReady: false,
  drag: null,
  marquee: null,
  outputSession: null,
  outputTimeoutId: null,
  undo: [],
  redo: [],
  renderFrame: 0,
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampPoint(point) {
  return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
}

function setStatus(tone, title, message) {
  elements.statusCard.dataset.tone = tone;
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
}

function setToggle(button, active) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
}

function setBusy(busy) {
  state.busy = busy;
  const disabled = (element, unlessReady = false) => {
    if (element) element.disabled = busy || (unlessReady && !state.project);
  };
  disabled(elements.captureSource);
  disabled(elements.clearSource, true);
  disabled(elements.captureReference, true);
  disabled(elements.loadReference, true);
  disabled(elements.clearReference, true);
  disabled(elements.refreshProjects);
  disabled(elements.loadProject);
  disabled(elements.toggleOutput);
  disabled(elements.createOutput, true);
  disabled(elements.saveMesh, true);
  disabled(elements.raiseIsland, true);
  disabled(elements.saveTemplate, true);
  disabled(elements.applyTemplate, true);
  disabled(elements.resetLayout, true);
  disabled(elements.resetWarp, true);
  disabled(elements.deleteSelection, true);
  disabled(elements.toolPen, true);
  disabled(elements.toolSelect, true);
  disabled(elements.drawModeLine, true);
  disabled(elements.drawModeFace, true);
  elements.referenceFile.disabled = busy || !state.project;
  updateHistoryButtons();
  updateTemplateControls();
}

function setProjectReady(ready) {
  elements.emptyState.classList.toggle("is-hidden", ready);
  elements.canvasBadge.classList.toggle("is-hidden", !ready);
  elements.canvas.classList.toggle("is-ready", ready);
  for (const element of [
    elements.modeLayout, elements.modeWarp, elements.previewToggle, elements.meshToggle,
    elements.trianglesToggle, elements.connectionsToggle, elements.islandsToggle, elements.fullscreenToggle,
    elements.toolPen, elements.toolSelect, elements.drawModeLine, elements.drawModeFace,
    elements.deleteSelection, elements.raiseIsland, elements.sourceOpacity,
    elements.referenceOpacity, elements.referenceTintToggle, elements.referenceTintColor,
    elements.backgroundColor,
    elements.resetLayout, elements.resetWarp, elements.saveMesh, elements.createOutput,
    elements.saveTemplate, elements.applyTemplate,
    elements.clearSource, elements.captureReference, elements.loadReference,
  ]) {
    element.disabled = !ready || state.busy;
  }
  updateRaiseIslandButton();
  updateTemplateControls();
  elements.referenceFile.disabled = !ready || state.busy;
  elements.clearReference.disabled = !ready || state.busy || !state.backdropImage;
  syncReferenceTintControls();
}

function syncReferenceTintControls() {
  const enabled = Boolean(state.project) && !state.busy;
  elements.referenceTintToggle.disabled = !enabled;
  elements.referenceTintColor.disabled = !enabled || !state.referenceTint;
  setToggle(elements.referenceTintToggle, state.referenceTint);
}

function setReferenceSummary(name, meta) {
  elements.referenceName.textContent = name;
  elements.referenceMeta.textContent = meta;
  elements.clearReference.disabled = state.busy || !state.project || !state.backdropImage;
}

function clearReference() {
  if (state.busy || !state.backdropImage) return;
  state.backdropImage = null;
  state.referenceMeta = null;
  setReferenceSummary("No reference loaded", "Select another layer and capture it, or load an image.");
  setStatus("info", "Reference cleared", "The source and its mesh were kept.");
  scheduleRender();
}

function clearSource() {
  if (state.busy || !state.project) return;
  state.project = null;
  state.captureMeta = null;
  state.sourceImage = null;
  state.backdropImage = null;
  state.referenceMeta = null;
  state.pendingReferenceRestore = null;
  state.pendingSavedProject = null;
  state.undo = [];
  state.redo = [];
  clearSelection();
  resetZoom();
  elements.layerName.textContent = "No source captured";
  elements.layerMeta.textContent = "Select a Smart Object in Photopea.";
  setReferenceSummary("No reference loaded", "Select another layer and capture it, or load an image.");
  setProjectReady(false);
  updateHistoryButtons();
  setMode("layout");
  setStatus("info", "Source cleared", "The PSD was not changed. Select a layer and capture it again.");
  refreshPhotopeaState();
  scheduleRender();
}

function normalizedSourceBounds() {
  const bounds = state.captureMeta?.bounds;
  if (!bounds) throw new Error("Capture a source layer first.");
  const result = {
    left: clamp(Math.min(bounds.left, bounds.right), 0, 1),
    top: clamp(Math.min(bounds.top, bounds.bottom), 0, 1),
    right: clamp(Math.max(bounds.left, bounds.right), 0, 1),
    bottom: clamp(Math.max(bounds.top, bounds.bottom), 0, 1),
  };
  if (result.right - result.left <= 0.0001 || result.bottom - result.top <= 0.0001) {
    throw new Error("The visible part of this layer has no usable bounds.");
  }
  return result;
}

function snapshotMesh() {
  if (!state.project) return null;
  const { mesh } = state.project;
  const islands = computeIslands(mesh.quads, mesh.sourceVertices);
  return {
    name: mesh.name,
    warpLinked: Boolean(mesh.warpLinked),
    quads: mesh.quads.map((face) => [...face]),
    edges: ensureEdges(mesh.quads, mesh.edges).map((edge) => [...edge]),
    islandOrder: resolveIslandOrder(islands, mesh.islandOrder),
    sourceVertices: clonePoints(mesh.sourceVertices),
    warpVertices: clonePoints(mesh.warpVertices),
  };
}

function clearSelection() {
  state.selectedPoints.clear();
  state.selectedEdge = null;
  state.selectedFace = null;
  state.selectedIslandId = null;
  state.penPreview = null;
  updateRaiseIslandButton();
}

function restoreMesh(snapshot) {
  state.project.mesh = {
    name: snapshot.name,
    warpLinked: Boolean(snapshot.warpLinked),
    quads: snapshot.quads.map((face) => [...face]),
    edges: ensureEdges(snapshot.quads, snapshot.edges).map((edge) => [...edge]),
    islandOrder: Array.isArray(snapshot.islandOrder) ? [...snapshot.islandOrder] : [],
    sourceVertices: clonePoints(snapshot.sourceVertices),
    warpVertices: clonePoints(snapshot.warpVertices),
  };
  clearSelection();
  scheduleRender();
}

function pushUndo(snapshot) {
  if (!snapshot) return;
  state.undo.push(snapshot);
  if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
  state.redo = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  elements.undo.disabled = state.busy || !state.undo.length;
  elements.redo.disabled = state.busy || !state.redo.length;
}

function undo() {
  if (state.busy || !state.project || !state.undo.length) return;
  state.redo.push(snapshotMesh());
  restoreMesh(state.undo.pop());
  updateHistoryButtons();
}

function redo() {
  if (state.busy || !state.project || !state.redo.length) return;
  state.undo.push(snapshotMesh());
  restoreMesh(state.redo.pop());
  updateHistoryButtons();
}

function editorViewRect() {
  return { left: 0, top: 0, right: 1, bottom: 1 };
}

function setMode(mode) {
  state.mode = mode;
  if (mode !== "layout") state.penPreview = null;
  setToggle(elements.modeLayout, mode === "layout");
  setToggle(elements.modeWarp, mode === "warp");
  if (elements.layoutToolCluster) {
    elements.layoutToolCluster.classList.toggle("is-hidden", mode !== "layout");
  } else {
    elements.layoutTools.classList.toggle("is-hidden", mode !== "layout");
  }
  if (elements.drawModeTools) {
    elements.drawModeTools.classList.toggle("is-hidden", mode !== "layout" || state.layoutTool !== "pen");
  }
  syncDrawModeUi();
  updateCanvasBadge();
  updateSelectionHint();
  scheduleRender();
}

function effectiveFaceMode() {
  return state.faceMode && !state.ctrlLineHeld;
}

function syncDrawModeUi() {
  if (!elements.drawModeLine || !elements.drawModeFace) return;
  const faceActive = effectiveFaceMode();
  setToggle(elements.drawModeFace, faceActive);
  setToggle(elements.drawModeLine, !faceActive);
  elements.drawModeLine.classList.toggle("is-temp", state.ctrlLineHeld && state.faceMode);
  elements.drawModeFace.classList.toggle("is-temp", false);
  if (elements.drawModeTools) {
    elements.drawModeTools.title = state.ctrlLineHeld && state.faceMode
      ? "Line mode while Ctrl is held (release Ctrl to return to Face)"
      : "Draw mode — Line or Face";
  }
}

function setCtrlLineHeld(held) {
  const next = Boolean(held);
  if (next === state.ctrlLineHeld) return;
  state.ctrlLineHeld = next;
  syncDrawModeUi();
  updateSelectionHint();
  updateCanvasBadge();
}

function updateSelectionHint() {
  const face = effectiveFaceMode();
  elements.selectionHint.textContent = state.mode === "layout"
    ? state.layoutTool === "pen"
      ? face
        ? "Draw · Face: closing a triangle/quad creates a face. Hold Ctrl (or switch to Line) for knife-only cuts."
        : state.ctrlLineHeld && state.faceMode
          ? "Draw · Line (Ctrl): knife-only cuts. Release Ctrl to return to Face mode."
          : "Draw · Line: draw and cut without auto-faces. Switch to Face (or release Ctrl) to seal loops into faces."
      : "Select (S): click a point, line, or face; drag empty space for a marquee. Del removes the selection (faces/lines keep points)."
    : "Move matching points onto the reference. Preview updates live.";
}

function setFaceMode(faceMode) {
  state.faceMode = Boolean(faceMode);
  syncDrawModeUi();
  updateSelectionHint();
  updateCanvasBadge();
}

function setLayoutTool(tool) {
  state.layoutTool = tool;
  if (tool !== "pen") state.penPreview = null;
  setToggle(elements.toolPen, tool === "pen");
  setToggle(elements.toolSelect, tool === "select");
  setMode("layout");
}

function togglePreview() {
  state.preview = !state.preview;
  setToggle(elements.previewToggle, state.preview);
  setMode(state.mode);
}

function toggleMesh() {
  state.meshVisible = !state.meshVisible;
  setToggle(elements.meshToggle, state.meshVisible);
  scheduleRender();
}

function toggleTriangles() {
  state.trianglesVisible = !state.trianglesVisible;
  setToggle(elements.trianglesToggle, state.trianglesVisible);
  scheduleRender();
}

function toggleIslands() {
  state.islandsVisible = !state.islandsVisible;
  setToggle(elements.islandsToggle, state.islandsVisible);
  scheduleRender();
}

function toggleIslandSelection() {
  if (!state.project) return;
  const mesh = state.project.mesh;
  const vertices = activeVertices();
  let island = null;
  if (state.lastPointerDocument) {
    island = islandAtPoint(state.lastPointerDocument, mesh.quads, vertices, mesh.islandOrder);
  }
  if (!island) {
    island = islandContainingSelection({
      points: [...state.selectedPoints],
      edge: state.selectedEdge,
      face: state.selectedFace,
      islandId: state.selectedIslandId,
    }, mesh.quads, vertices, mesh.islandOrder);
  }
  if (!island) {
    setStatus("warning", "No UV island", "Click a face first, or move the cursor over an island, then press L.");
    return;
  }
  if (state.selectedIslandId === island.id) {
    clearSelection();
    setStatus("success", "Island deselected", "Press L again over an island to select it.");
  } else {
    clearSelection();
    state.selectedIslandId = island.id;
    island.vertices.forEach((index) => state.selectedPoints.add(index));
    mesh.islandOrder = resolveIslandOrder(computeIslands(mesh.quads, mesh.sourceVertices), mesh.islandOrder);
    const rank = orderedIslands(computeIslands(mesh.quads, vertices), mesh.islandOrder)
      .findIndex((entry) => entry.id === island.id) + 1;
    setStatus(
      "success",
      "Island selected",
      `Island ${rank} · ${island.faces.length} face${island.faces.length === 1 ? "" : "s"} · ${island.vertices.length} point${island.vertices.length === 1 ? "" : "s"}. Del removes it; ] / [ change depth.`,
    );
  }
  updateRaiseIslandButton();
  scheduleRender();
}

function adjustSelectedIslandDepth(direction) {
  if (!state.project || !state.selectedIslandId) return;
  const before = snapshotMesh();
  const mesh = state.project.mesh;
  const islands = computeIslands(mesh.quads, mesh.sourceVertices);
  const order = resolveIslandOrder(islands, mesh.islandOrder);
  const next = direction > 0
    ? raiseIslandInOrder(order, state.selectedIslandId)
    : lowerIslandInOrder(order, state.selectedIslandId);
  if (next.join("|") === order.join("|")) {
    setStatus("info", direction > 0 ? "Already on top" : "Already at bottom",
      direction > 0
        ? "This island is already the highest depth."
        : "This island is already the lowest depth.");
    return;
  }
  mesh.islandOrder = next;
  pushUndo(before);
  const rank = next.indexOf(state.selectedIslandId) + 1;
  setStatus("success", direction > 0 ? "Island raised" : "Island lowered",
    `Island depth is now ${rank} of ${next.length} (higher paints on top).`);
  scheduleRender();
}

function raiseSelectedIsland() {
  adjustSelectedIslandDepth(1);
}

function lowerSelectedIsland() {
  adjustSelectedIslandDepth(-1);
}

function updateRaiseIslandButton() {
  if (!elements.raiseIsland) return;
  elements.raiseIsland.disabled = state.busy || !state.project || !state.selectedIslandId;
}

function toggleConnections() {
  state.connectionsVisible = !state.connectionsVisible;
  setToggle(elements.connectionsToggle, state.connectionsVisible);
  if (state.connectionsVisible) {
    setStatus("info", "Connection check on",
      "Faces are pulled apart. Green links mean welded points, amber means only one face uses that point or edge, red rings are loose points.");
  }
  setMode(state.mode);
}

function toggleFullscreen() {
  state.fullscreen = !state.fullscreen;
  elements.shell.classList.toggle("is-fullscreen", state.fullscreen);
  setToggle(elements.fullscreenToggle, state.fullscreen);
  scheduleRender();
}

function prepareCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }
  return { width, height, ratio };
}

function viewportMetrics() {
  const canvas = prepareCanvas();
  const view = editorViewRect();
  const documentWidth = state.captureMeta?.documentWidth || 1;
  const documentHeight = state.captureMeta?.documentHeight || 1;
  const aspect = documentWidth / documentHeight;
  const padding = 9 * canvas.ratio;
  const availableWidth = Math.max(1, canvas.width - padding * 2);
  const availableHeight = Math.max(1, canvas.height - padding * 2);
  const fitHeight = availableWidth / availableHeight > aspect ? availableHeight : availableWidth / aspect;
  const fitWidth = fitHeight * aspect;
  const drawWidth = fitWidth * state.zoom;
  const drawHeight = fitHeight * state.zoom;
  // Keep part of the image on screen no matter how far the view is dragged.
  const limitX = Math.max(0, (drawWidth - canvas.width) / 2) + canvas.width * 0.4;
  const limitY = Math.max(0, (drawHeight - canvas.height) / 2) + canvas.height * 0.4;
  state.pan.x = clamp(state.pan.x, -limitX, limitX);
  state.pan.y = clamp(state.pan.y, -limitY, limitY);
  return {
    ...canvas, view,
    x: (canvas.width - drawWidth) / 2 + state.pan.x,
    y: (canvas.height - drawHeight) / 2 + state.pan.y,
    drawWidth, drawHeight, fitWidth, fitHeight,
  };
}

function documentToCanvas(point, metrics) {
  return {
    x: metrics.x + ((point.x - metrics.view.left) / (metrics.view.right - metrics.view.left)) * metrics.drawWidth,
    y: metrics.y + ((point.y - metrics.view.top) / (metrics.view.bottom - metrics.view.top)) * metrics.drawHeight,
  };
}

function canvasToDocumentRaw(point, metrics) {
  return {
    x: metrics.view.left + ((point.x - metrics.x) / metrics.drawWidth) * (metrics.view.right - metrics.view.left),
    y: metrics.view.top + ((point.y - metrics.y) / metrics.drawHeight) * (metrics.view.bottom - metrics.view.top),
  };
}

function canvasToDocument(point, metrics) {
  return clampPoint(canvasToDocumentRaw(point, metrics));
}

function updateCanvasBadge() {
  const tool = state.layoutTool === "pen"
    ? `Draw · ${effectiveFaceMode() ? "Face" : "Line"}`
    : "Select tool";
  const base = state.mode === "layout"
    ? `Layout · ${tool}`
    : state.preview ? "Warp · live preview" : "Warp · original preview";
  const parts = [base, `${Math.round(state.zoom * 100)}%`];
  if (state.connectionsVisible) parts.push("connection check");
  elements.canvasBadge.textContent = parts.join(" · ");
}

/** Zoom around a canvas-space anchor so the document point under it stays put. */
function setZoom(nextZoom, anchor = null) {
  const target = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  if (Math.abs(target - state.zoom) < 1e-4) return;
  const before = viewportMetrics();
  const focus = anchor || { x: before.width / 2, y: before.height / 2 };
  const anchored = canvasToDocumentRaw(focus, before);
  state.zoom = target;
  const after = viewportMetrics();
  const moved = documentToCanvas(anchored, after);
  state.pan.x += focus.x - moved.x;
  state.pan.y += focus.y - moved.y;
  updateCanvasBadge();
  scheduleRender();
}

function zoomIn() {
  setZoom(state.zoom * ZOOM_STEP);
}

function zoomOut() {
  setZoom(state.zoom / ZOOM_STEP);
}

function resetZoom() {
  state.zoom = 1;
  state.pan.x = 0;
  state.pan.y = 0;
  updateCanvasBadge();
  scheduleRender();
}

function drawImageCrop(context, image, metrics, opacity) {
  if (!image || opacity <= 0) return;
  context.save();
  context.globalAlpha = opacity;
  context.beginPath();
  context.rect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  context.clip();
  context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  context.restore();
}

function drawReferenceLayer(context, metrics) {
  if (!state.backdropImage) return;
  const opacity = Number(elements.referenceOpacity.value) / 100;
  if (opacity <= 0) return;
  if (!state.referenceTint) {
    drawImageCrop(context, state.backdropImage, metrics, opacity);
    return;
  }
  // Tint in a viewport-sized buffer: a zoomed view would otherwise need a
  // canvas as large as the scaled image, which browsers refuse to allocate.
  const width = Math.max(1, Math.round(metrics.width));
  const height = Math.max(1, Math.round(metrics.height));
  const offscreen = drawReferenceLayer.offscreen || (drawReferenceLayer.offscreen = document.createElement("canvas"));
  if (offscreen.width !== width || offscreen.height !== height) {
    offscreen.width = width;
    offscreen.height = height;
  }
  const tint = offscreen.getContext("2d");
  tint.setTransform(1, 0, 0, 1, 0, 0);
  tint.clearRect(0, 0, width, height);
  tint.drawImage(
    state.backdropImage,
    0, 0, state.backdropImage.naturalWidth, state.backdropImage.naturalHeight,
    metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight,
  );
  tint.globalCompositeOperation = "source-atop";
  tint.fillStyle = elements.referenceTintColor.value || "#ff4d6d";
  tint.fillRect(0, 0, width, height);
  tint.globalCompositeOperation = "source-over";
  context.save();
  context.globalAlpha = opacity;
  context.beginPath();
  context.rect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  context.clip();
  context.drawImage(offscreen, 0, 0);
  context.restore();
}

function drawLiveWarp(context, metrics) {
  const mesh = state.project.mesh;
  const sourceVertices = mesh.sourceVertices.map((point) => ({
    x: point.x * state.sourceImage.naturalWidth,
    y: point.y * state.sourceImage.naturalHeight,
  }));
  const targets = mesh.warpVertices.map((point) => documentToCanvas(point, metrics));
  context.save();
  context.globalAlpha = Number(elements.sourceOpacity.value) / 100;
  context.beginPath();
  context.rect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  context.clip();
  drawWarpedMesh(context, state.sourceImage, sourceVertices, targets, mesh.quads, {
    seamOverlap: 0.5 * metrics.ratio,
    faceOrder: facesInIslandOrder(mesh.quads, mesh.sourceVertices, mesh.islandOrder),
  });
  context.restore();
}

function sameEdge(edgeA, edgeB) {
  return edgeA && edgeB && (
    (edgeA[0] === edgeB[0] && edgeA[1] === edgeB[1]) ||
    (edgeA[0] === edgeB[1] && edgeA[1] === edgeB[0])
  );
}

function explodedFacePoints(face, points) {
  const corners = face.map((index) => points[index]);
  if (!state.connectionsVisible) return corners;
  const centerX = corners.reduce((total, point) => total + point.x, 0) / corners.length;
  const centerY = corners.reduce((total, point) => total + point.y, 0) / corners.length;
  return corners.map((point) => ({
    x: centerX + (point.x - centerX) * EXPLODE_SCALE,
    y: centerY + (point.y - centerY) * EXPLODE_SCALE,
  }));
}

function tracePolygon(context, corners) {
  context.beginPath();
  corners.forEach((point, position) => position ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
}

/**
 * Connection check: faces shrink toward their centre so welded points show a
 * fan of links back to one shared position, while loose points stand alone.
 */
function drawConnectionCheck(context, metrics, points, faces) {
  const usage = vertexUsage(faces, points.length);
  const openEdges = edgeUsage(faces);
  context.save();
  context.lineWidth = metrics.ratio;
  for (const face of faces) {
    const corners = explodedFacePoints(face, points);
    face.forEach((index, position) => {
      const anchor = points[index];
      const corner = corners[position];
      context.strokeStyle = usage[index] > 1 ? "rgba(97, 213, 156, 0.85)" : "rgba(240, 189, 101, 0.7)";
      context.beginPath();
      context.moveTo(corner.x, corner.y);
      context.lineTo(anchor.x, anchor.y);
      context.stroke();
    });
  }
  context.lineWidth = 2.2 * metrics.ratio;
  context.strokeStyle = "rgba(240, 189, 101, 0.75)";
  for (const [key, count] of openEdges) {
    if (count !== 1) continue;
    const [a, b] = key.split(":").map(Number);
    context.beginPath();
    context.moveTo(points[a].x, points[a].y);
    context.lineTo(points[b].x, points[b].y);
    context.stroke();
  }
  usage.forEach((count, index) => {
    if (count) return;
    const point = points[index];
    context.beginPath();
    context.arc(point.x, point.y, 6.5 * metrics.ratio, 0, Math.PI * 2);
    context.strokeStyle = "rgba(240, 120, 120, 0.9)";
    context.lineWidth = 1.6 * metrics.ratio;
    context.stroke();
  });
  context.restore();
}

function drawVertices(context, metrics, points) {
  const layout = state.mode === "layout";
  points.forEach((point, index) => {
    const selected = state.selectedPoints.has(index);
    const hovered = index === state.hoverVertex;
    if (selected) {
      context.beginPath();
      context.arc(point.x, point.y, 9.5 * metrics.ratio, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 209, 102, 0.18)";
      context.fill();
      context.beginPath();
      context.arc(point.x, point.y, 8 * metrics.ratio, 0, Math.PI * 2);
      context.strokeStyle = "#ffd166";
      context.lineWidth = 1.6 * metrics.ratio;
      context.stroke();
    } else if (hovered) {
      context.beginPath();
      context.arc(point.x, point.y, 8 * metrics.ratio, 0, Math.PI * 2);
      context.strokeStyle = "rgba(255, 255, 255, 0.55)";
      context.lineWidth = 1.3 * metrics.ratio;
      context.stroke();
    }
    context.beginPath();
    context.arc(point.x, point.y, (selected ? 5.2 : hovered ? 4.8 : 4.1) * metrics.ratio, 0, Math.PI * 2);
    context.fillStyle = selected ? "#ffd166" : layout ? "#cbd0ff" : "#b8ffe9";
    context.fill();
    context.strokeStyle = selected ? "#3a2c05" : layout ? "#5868e6" : "#168d6b";
    context.lineWidth = (selected ? 2.2 : 1.4) * metrics.ratio;
    context.stroke();
  });
}

function drawMeshOverlay(context, metrics) {
  if (!state.meshVisible || !state.project) return;
  const mesh = state.project.mesh;
  const vertices = state.mode === "layout" ? mesh.sourceVertices : mesh.warpVertices;
  const points = vertices.map((point) => documentToCanvas(point, metrics));
  const edges = drawableEdges(mesh.quads, mesh.edges);
  const islands = orderedIslands(computeIslands(mesh.quads, vertices), mesh.islandOrder);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (state.islandsVisible && islands.length) {
    islands.forEach((island, index) => {
      const hue = islandHue(index, islands.length);
      const selected = state.selectedIslandId === island.id;
      context.fillStyle = selected
        ? `hsl(${hue}, 78%, 58%)`
        : `hsl(${hue}, 70%, 48%)`;
      for (const face of island.faces) {
        tracePolygon(context, face.map((vertIndex) => points[vertIndex]));
        context.fill();
      }
    });
  } else {
    for (const face of mesh.quads) {
      const faceSelected = (state.selectedFace && facesEqual(face, state.selectedFace))
        || (state.selectedIslandId && islands.some((island) =>
          island.id === state.selectedIslandId && island.faces.some((entry) => facesEqual(entry, face))));
      tracePolygon(context, explodedFacePoints(face, points));
      context.fillStyle = faceSelected ? "rgba(255, 212, 102, 0.22)" : state.mode === "layout" ? "rgba(119, 132, 255, 0.075)" : "rgba(74, 224, 181, 0.055)";
      context.fill();
    }
  }

  // Draw all stored/face edges once (includes free knife cuts).
  context.strokeStyle = state.mode === "layout" ? "rgba(170, 178, 255, 0.92)" : "rgba(105, 232, 194, 0.94)";
  context.lineWidth = 1.25 * metrics.ratio;
  for (const edge of edges) {
    context.beginPath();
    context.moveTo(points[edge[0]].x, points[edge[0]].y);
    context.lineTo(points[edge[1]].x, points[edge[1]].y);
    context.stroke();
  }
  if (state.trianglesVisible) {
    context.setLineDash([4 * metrics.ratio, 3 * metrics.ratio]);
    context.strokeStyle = "rgba(255, 205, 104, 0.88)";
    context.lineWidth = metrics.ratio;
    for (const triangle of triangulateFaces(mesh.quads)) {
      tracePolygon(context, explodedFacePoints(triangle, points));
      context.stroke();
    }
    context.setLineDash([]);
  }
  if (state.connectionsVisible) drawConnectionCheck(context, metrics, points, mesh.quads);
  if (state.selectedEdge) {
    const [a, b] = state.selectedEdge;
    context.beginPath();
    context.moveTo(points[a].x, points[a].y);
    context.lineTo(points[b].x, points[b].y);
    context.strokeStyle = "#ffd166";
    context.lineWidth = 3 * metrics.ratio;
    context.stroke();
  }
  drawVertices(context, metrics, points);

  if (state.islandsVisible && islands.length) {
    islands.forEach((island, index) => {
      const center = documentToCanvas(island.centroid, metrics);
      const label = String(index + 1);
      const radius = 9 * metrics.ratio;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fillStyle = state.selectedIslandId === island.id ? "#ffd166" : "rgba(12, 14, 18, 0.82)";
      context.fill();
      context.strokeStyle = "#ffd166";
      context.lineWidth = metrics.ratio;
      context.stroke();
      context.fillStyle = state.selectedIslandId === island.id ? "#1a1404" : "#ffd166";
      context.font = `700 ${11 * metrics.ratio}px ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, center.x, center.y + 0.5 * metrics.ratio);
    });
  }
  context.restore();
}

function drawMarquee(context, metrics) {
  if (!state.marquee) return;
  const a = documentToCanvas({ x: state.marquee.start.x, y: state.marquee.start.y }, metrics);
  const b = documentToCanvas({ x: state.marquee.current.x, y: state.marquee.current.y }, metrics);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  context.save();
  context.fillStyle = "rgba(255, 209, 102, 0.12)";
  context.strokeStyle = "#ffd166";
  context.lineWidth = metrics.ratio;
  context.setLineDash([4 * metrics.ratio, 3 * metrics.ratio]);
  context.fillRect(left, top, width, height);
  context.strokeRect(left, top, width, height);
  context.restore();
}

function drawPenPreview(context, metrics) {
  const preview = state.penPreview?.preview;
  if (!preview) return;
  context.save();
  context.strokeStyle = "#ffd166";
  context.fillStyle = "rgba(255, 209, 102, 0.12)";
  context.lineWidth = 1.5 * metrics.ratio;

  const drawMarker = (docPoint) => {
    if (!docPoint) return;
    const point = documentToCanvas(docPoint, metrics);
    context.setLineDash([]);
    context.beginPath();
    context.arc(point.x, point.y, 5 * metrics.ratio, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  };

  if (preview.kind === "vertex") {
    drawMarker(preview.point);
  } else {
    context.setLineDash([6 * metrics.ratio, 4 * metrics.ratio]);
    context.beginPath();
    preview.points.forEach((point, index) => {
      const display = documentToCanvas(point, metrics);
      if (index) context.lineTo(display.x, display.y);
      else context.moveTo(display.x, display.y);
    });
    if (preview.kind !== "edge") context.closePath();
    context.fill();
    context.stroke();
    // Always show the snap/target point ring (same as hovering a line with no selection).
    const marker =
      preview.marker ||
      (preview.kind === "edge" && preview.points.length
        ? preview.points[preview.points.length - 1]
        : null);
    drawMarker(marker);
  }
  context.restore();
}

function render() {
  state.renderFrame = 0;
  const metrics = viewportMetrics();
  const context = elements.canvas.getContext("2d");
  const background = elements.backgroundColor.value || "#0d0f12";
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, metrics.width, metrics.height);
  context.fillStyle = background;
  context.fillRect(0, 0, metrics.width, metrics.height);
  if (!state.project || !state.sourceImage) return;
  context.fillStyle = background;
  context.fillRect(metrics.x, metrics.y, metrics.drawWidth, metrics.drawHeight);
  drawReferenceLayer(context, metrics);
  if (state.mode === "layout" || !state.preview) {
    drawImageCrop(context, state.sourceImage, metrics, Number(elements.sourceOpacity.value) / 100);
  } else {
    drawLiveWarp(context, metrics);
  }
  drawMeshOverlay(context, metrics);
  if (state.mode === "layout" && state.layoutTool === "pen") drawPenPreview(context, metrics);
  drawMarquee(context, metrics);
}

function scheduleRender() {
  if (!state.renderFrame) state.renderFrame = requestAnimationFrame(render);
}

function pointerPosition(event, metrics) {
  const rect = elements.canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * metrics.ratio, y: (event.clientY - rect.top) * metrics.ratio };
}

function hitThreshold(metrics) {
  return (11 * metrics.ratio) / Math.min(metrics.drawWidth, metrics.drawHeight);
}

/** Points get a wider catch radius than edges so welding is easy to hit. */
function vertexHitThreshold(metrics) {
  return (15 * metrics.ratio) / Math.min(metrics.drawWidth, metrics.drawHeight);
}

function activeVertices() {
  return state.mode === "layout" ? state.project.mesh.sourceVertices : state.project.mesh.warpVertices;
}

function indicesForActiveSelection() {
  if (state.selectedPoints.size) return [...state.selectedPoints];
  if (state.selectedIslandId && state.project) {
    const islands = computeIslands(state.project.mesh.quads, activeVertices());
    const island = islands.find((entry) => entry.id === state.selectedIslandId);
    if (island) return [...island.vertices];
  }
  if (state.selectedEdge) return [...state.selectedEdge];
  if (state.selectedFace) return [...new Set(state.selectedFace)];
  return [];
}

function selectEdge(edge, preserve = false) {
  if (!preserve) state.selectedPoints.clear();
  state.selectedEdge = [...edge];
  state.selectedFace = null;
  state.selectedIslandId = null;
}

function selectFace(face, preserve = false) {
  if (!preserve) state.selectedPoints.clear();
  state.selectedEdge = null;
  state.selectedFace = [...face];
  state.selectedIslandId = null;
}

function setPointSelection(indices, { preserve = false } = {}) {
  if (!preserve) {
    state.selectedPoints.clear();
    state.selectedEdge = null;
    state.selectedFace = null;
    state.selectedIslandId = null;
  }
  indices.forEach((index) => state.selectedPoints.add(index));
}

function beginDrag(event, pointerDocument, indexList = null) {
  const vertices = activeVertices();
  const indices = indexList || indicesForActiveSelection();
  if (!indices.length) return;
  const starts = new Map(indices.map((index) => [index, { ...vertices[index] }]));
  state.drag = {
    pointerId: event.pointerId,
    startPointer: pointerDocument,
    starts,
    warpStarts: state.mode === "layout" && state.project.mesh.warpLinked
      ? new Map(indices.map((index) => [index, { ...state.project.mesh.warpVertices[index] }]))
      : null,
    before: snapshotMesh(),
    changed: false,
  };
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.classList.add("is-dragging");
}

function applyPen(pointerDocument, metrics, event = null) {
  const mesh = state.project.mesh;
  const faceMode = effectiveFaceMode();
  const action = resolvePenAction({
    selection: { vertices: [...state.selectedPoints], edge: state.selectedEdge, face: state.selectedFace },
    clickPoint: pointerDocument,
    sourceVertices: mesh.sourceVertices,
    faces: mesh.quads,
    edges: mesh.edges,
    insertMode: state.insertMode,
    snapThreshold: vertexHitThreshold(metrics),
  });
  const before = snapshotMesh();
  try {
    const result = applyPenAction(action, mesh.sourceVertices, mesh.warpVertices, mesh.quads, mesh.edges, { faceMode });
    validateFaces(result.sourceVertices, result.faces);
    validateEdges(result.sourceVertices, result.edges);
    state.project.mesh = {
      ...mesh,
      sourceVertices: result.sourceVertices,
      warpVertices: result.warpVertices,
      quads: result.faces,
      edges: ensureEdges(result.faces, result.edges),
      warpLinked: mesh.warpLinked,
    };
    clearSelection();
    setPointSelection(result.selection.vertices);
    state.selectedEdge = result.selection.edge;
    state.selectedFace = result.selection.face;
    if (action.type !== "select-only") pushUndo(before);
    const sealed = result.selection.face ? " Face created." : "";
    setStatus("success", "Mesh updated", `${action.hint}${sealed}`);
  } catch (error) {
    setStatus("error", "Could not update mesh", error.message);
  }
  scheduleRender();
}

function beginPan(event) {
  const metrics = viewportMetrics();
  state.panDrag = {
    pointerId: event.pointerId,
    start: pointerPosition(event, metrics),
    origin: { ...state.pan },
  };
  try { elements.canvas.setPointerCapture(event.pointerId); } catch (_) {}
  elements.canvas.classList.add("is-panning");
  event.preventDefault();
}

function handlePointerDown(event) {
  if (!state.project || state.busy) return;
  // Middle-drag or Space-drag pans the view at any zoom level.
  if (event.button === 1 || (event.button === 0 && state.panReady)) {
    elements.canvas.focus();
    beginPan(event);
    return;
  }
  if (event.button !== 0) return;
  elements.canvas.focus();
  const metrics = viewportMetrics();
  const pointerDocument = canvasToDocument(pointerPosition(event, metrics), metrics);
  const vertices = activeVertices();
  const threshold = hitThreshold(metrics);
  const vertexThreshold = vertexHitThreshold(metrics);
  if (state.mode === "layout" && state.layoutTool === "pen") {
    setCtrlLineHeld(event.ctrlKey || event.metaKey);
    applyPen(pointerDocument, metrics, event);
    event.preventDefault();
    return;
  }
  const vertex = nearestVertex(pointerDocument, vertices, vertexThreshold);
  if (vertex >= 0) {
    if (state.selectedIslandId) {
      const islands = computeIslands(state.project.mesh.quads, vertices);
      const island = islands.find((entry) => entry.id === state.selectedIslandId);
      if (island?.vertices.includes(vertex)) {
        beginDrag(event, pointerDocument, [...island.vertices]);
        scheduleRender();
        event.preventDefault();
        return;
      }
    }
    state.selectedEdge = null;
    state.selectedFace = null;
    state.selectedIslandId = null;
    updateRaiseIslandButton();
    if (event.shiftKey) {
      if (state.selectedPoints.has(vertex)) state.selectedPoints.delete(vertex);
      else state.selectedPoints.add(vertex);
    } else if (!state.selectedPoints.has(vertex)) {
      clearSelection();
      setPointSelection([vertex]);
    }
    if (state.selectedPoints.size) beginDrag(event, pointerDocument);
  } else {
    const edgeResult = state.mode === "layout"
      ? nearestEdge(pointerDocument, state.project.mesh.sourceVertices, state.project.mesh.quads, threshold, state.project.mesh.edges)
      : null;
    if (edgeResult) {
      if (state.selectedIslandId) {
        const islands = computeIslands(state.project.mesh.quads, vertices);
        const island = islands.find((entry) => entry.id === state.selectedIslandId);
        if (island && edgeResult.edge.every((index) => island.vertices.includes(index))) {
          beginDrag(event, pointerDocument, [...island.vertices]);
          scheduleRender();
          event.preventDefault();
          return;
        }
      }
      selectEdge(edgeResult.edge, event.shiftKey);
      beginDrag(event, pointerDocument, [...edgeResult.edge]);
    } else {
      const faceHit = state.mode === "layout"
        ? findFaceAtPoint(pointerDocument, state.project.mesh.sourceVertices, state.project.mesh.quads)
        : null;
      if (faceHit) {
        if (state.selectedIslandId) {
          const islands = computeIslands(state.project.mesh.quads, vertices);
          const island = islands.find((entry) => entry.id === state.selectedIslandId);
          if (island?.faces.some((face) => facesEqual(face, faceHit))) {
            beginDrag(event, pointerDocument, [...island.vertices]);
            scheduleRender();
            event.preventDefault();
            return;
          }
        }
        selectFace(faceHit, event.shiftKey);
        beginDrag(event, pointerDocument, [...new Set(faceHit)]);
      } else {
        state.marquee = {
          pointerId: event.pointerId,
          start: { ...pointerDocument },
          current: { ...pointerDocument },
          additive: event.shiftKey,
        };
        try { elements.canvas.setPointerCapture(event.pointerId); } catch (_) {}
        elements.canvas.classList.add("is-marquee");
      }
    }
  }
  scheduleRender();
  event.preventDefault();
}

function handlePointerMove(event) {
  if (!state.project || state.busy) return;
  const metrics = viewportMetrics();
  if (state.panDrag) {
    if (state.panDrag.pointerId !== event.pointerId) return;
    const current = pointerPosition(event, metrics);
    state.pan.x = state.panDrag.origin.x + (current.x - state.panDrag.start.x);
    state.pan.y = state.panDrag.origin.y + (current.y - state.panDrag.start.y);
    scheduleRender();
    event.preventDefault();
    return;
  }
  const pointerDocument = canvasToDocument(pointerPosition(event, metrics), metrics);
  state.lastPointerDocument = { ...pointerDocument };
  if (state.marquee && state.marquee.pointerId === event.pointerId) {
    state.marquee.current = { ...pointerDocument };
    scheduleRender();
    event.preventDefault();
    return;
  }
  if (!state.drag) {
    const hovered = nearestVertex(pointerDocument, activeVertices(), vertexHitThreshold(metrics));
    const hoverChanged = hovered !== state.hoverVertex;
    state.hoverVertex = hovered;
    if (state.mode === "layout" && state.layoutTool === "pen") {
      setCtrlLineHeld(event.ctrlKey || event.metaKey);
      state.penPreview = resolvePenAction({
        selection: { vertices: [...state.selectedPoints], edge: state.selectedEdge, face: state.selectedFace },
        clickPoint: pointerDocument,
        sourceVertices: state.project.mesh.sourceVertices,
        faces: state.project.mesh.quads,
        edges: state.project.mesh.edges,
        insertMode: state.insertMode,
        snapThreshold: vertexHitThreshold(metrics),
      });
      scheduleRender();
    } else if (hoverChanged) {
      scheduleRender();
    }
    return;
  }
  if (state.drag.pointerId !== event.pointerId) return;
  const delta = { x: pointerDocument.x - state.drag.startPointer.x, y: pointerDocument.y - state.drag.startPointer.y };
  const vertices = activeVertices();
  state.drag.starts.forEach((start, index) => {
    const point = clampPoint({ x: start.x + delta.x, y: start.y + delta.y });
    vertices[index] = point;
    if (state.drag.warpStarts) state.project.mesh.warpVertices[index] = { ...point };
  });
  state.drag.changed = Math.abs(delta.x) > 1e-7 || Math.abs(delta.y) > 1e-7;
  scheduleRender();
  event.preventDefault();
}

function finishPointerDrag(event) {
  if (state.panDrag && state.panDrag.pointerId === event.pointerId) {
    try { elements.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    state.panDrag = null;
    elements.canvas.classList.remove("is-panning");
    scheduleRender();
    return;
  }
  if (state.marquee && state.marquee.pointerId === event.pointerId) {
    try { elements.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    const box = state.marquee;
    state.marquee = null;
    elements.canvas.classList.remove("is-marquee");
    const dx = Math.abs(box.current.x - box.start.x);
    const dy = Math.abs(box.current.y - box.start.y);
    const metrics = viewportMetrics();
    const clickThreshold = (4 * metrics.ratio) / Math.min(metrics.drawWidth, metrics.drawHeight);
    if (dx <= clickThreshold && dy <= clickThreshold) {
      if (!box.additive) clearSelection();
    } else {
      const hits = verticesInRect(activeVertices(), {
        x0: box.start.x,
        y0: box.start.y,
        x1: box.current.x,
        y1: box.current.y,
      });
      if (!box.additive) {
        clearSelection();
        setPointSelection(hits);
      } else {
        setPointSelection(hits, { preserve: true });
      }
      state.selectedEdge = null;
      state.selectedFace = null;
    }
    scheduleRender();
    return;
  }
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  if (state.drag.changed) {
    if (state.mode === "warp") state.project.mesh.warpLinked = false;
    pushUndo(state.drag.before);
    const warning = meshWarnings(state.project.mesh.sourceVertices, state.project.mesh.warpVertices, state.project.mesh.quads);
    setStatus(warning.degenerate ? "warning" : warning.flipped ? "warning" : "success",
      warning.degenerate ? "Collapsed mesh area" : warning.flipped ? "Folded mesh area" : (state.mode === "layout" ? "Layout" : "Warp") + " updated",
      warning.degenerate ? "Move overlapping points apart before creating output." : warning.flipped ? "A triangle crosses over itself and may mirror the output." : state.selectedPoints.size + " point" + (state.selectedPoints.size === 1 ? "" : "s") + " moved.");
  }
  try { elements.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  state.drag = null;
  elements.canvas.classList.remove("is-dragging");
  scheduleRender();
}

function deleteSelection() {
  if (!state.project || state.busy) return;
  if (!state.selectedPoints.size) {
    if (state.selectedFace) {
      const before = snapshotMesh();
      try {
        const mesh = state.project.mesh;
        const result = deleteFace(
          mesh.sourceVertices,
          mesh.warpVertices,
          mesh.quads,
          mesh.edges,
          state.selectedFace,
        );
        validateFaces(result.sourceVertices, result.faces);
        validateEdges(result.sourceVertices, result.edges);
        state.project.mesh = {
          ...mesh,
          sourceVertices: result.sourceVertices,
          warpVertices: result.warpVertices,
          quads: result.faces,
          edges: result.edges,
        };
        clearSelection();
        pushUndo(before);
        setStatus("success", "Face deleted", "The face was removed; its points and lines were kept.");
      } catch (error) {
        setStatus("error", "Could not delete face", error.message);
      }
      scheduleRender();
      return;
    }
    if (state.selectedEdge) {
      const before = snapshotMesh();
      try {
        const mesh = state.project.mesh;
        const result = deleteEdge(
          mesh.sourceVertices,
          mesh.warpVertices,
          mesh.quads,
          mesh.edges,
          state.selectedEdge,
        );
        validateFaces(result.sourceVertices, result.faces);
        validateEdges(result.sourceVertices, result.edges);
        state.project.mesh = {
          ...mesh,
          sourceVertices: result.sourceVertices,
          warpVertices: result.warpVertices,
          quads: result.faces,
          edges: result.edges,
        };
        clearSelection();
        pushUndo(before);
        setStatus("success", "Line deleted", "The line was removed; its endpoints were kept.");
      } catch (error) {
        setStatus("error", "Could not delete line", error.message);
      }
      scheduleRender();
    }
    return;
  }
  const before = snapshotMesh();
  const deletingIsland = Boolean(state.selectedIslandId);
  let source = state.project.mesh.sourceVertices;
  let warp = state.project.mesh.warpVertices;
  let faces = state.project.mesh.quads;
  let edges = state.project.mesh.edges;
  try {
    [...state.selectedPoints].sort((a, b) => b - a).forEach((index) => {
      ({ sourceVertices: source, warpVertices: warp, faces, edges } = deleteVertex(source, warp, faces, index, edges));
    });
    validateFaces(source, faces);
    validateEdges(source, edges);
    state.project.mesh = { ...state.project.mesh, sourceVertices: source, warpVertices: warp, quads: faces, edges };
    clearSelection();
    pushUndo(before);
    setStatus("success", "Selection deleted",
      deletingIsland
        ? "The selected UV island was removed."
        : "Faces using the deleted points were removed.");
  } catch (error) {
    setStatus("error", "Could not delete selection", error.message);
  }
  scheduleRender();
}

function nudgeSelection(event) {
  if (!state.project) return false;
  const indices = indicesForActiveSelection();
  if (!indices.length) return false;
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!directions[event.key]) return false;
  const [dx, dy] = directions[event.key];
  const pixels = event.shiftKey ? 10 : 1;
  const before = snapshotMesh();
  const vertices = activeVertices();
  indices.forEach((index) => {
    const point = clampPoint({
      x: vertices[index].x + dx * pixels / state.captureMeta.documentWidth,
      y: vertices[index].y + dy * pixels / state.captureMeta.documentHeight,
    });
    vertices[index] = point;
    if (state.mode === "layout" && state.project.mesh.warpLinked) state.project.mesh.warpVertices[index] = { ...point };
  });
  if (state.mode === "warp") state.project.mesh.warpLinked = false;
  pushUndo(before);
  scheduleRender();
  return true;
}

const TOOL_HOTKEYS = {
  1: () => setMode("layout"),
  2: () => setMode("warp"),
  c: toggleConnections,
  d: () => setLayoutTool("pen"),
  s: () => setLayoutTool("select"),
  p: togglePreview,
  m: toggleMesh,
  t: toggleTriangles,
  i: toggleIslands,
  l: toggleIslandSelection,
  "]": () => raiseSelectedIsland(),
  "[": () => lowerSelectedIsland(),
  f: toggleFullscreen,
  "+": zoomIn,
  "=": zoomIn,
  "-": zoomOut,
  _: zoomOut,
  0: resetZoom,
};

function handleKeyDown(event) {
  setCtrlLineHeld(event.ctrlKey || event.metaKey);
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (modifier || event.altKey) return;
  // Space only arms panning from the canvas or page, never from a focused button.
  if (event.code === "Space" && state.project &&
      (event.target === elements.canvas || event.target === document.body)) {
    event.preventDefault();
    if (!state.panReady) {
      state.panReady = true;
      elements.canvas.classList.add("is-pan-ready");
    }
    return;
  }
  if (event.key === "Escape" && state.project) {
    event.preventDefault();
    clearSelection();
    scheduleRender();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.project) {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (nudgeSelection(event)) {
    event.preventDefault();
    return;
  }
  const hotkey = TOOL_HOTKEYS[event.key.toLowerCase()];
  if (hotkey && state.project && !state.busy) {
    event.preventDefault();
    hotkey();
  }
}

function selectedTemplateId() {
  return elements.meshTemplates?.value || "";
}

function refreshTemplateList(preferredId = null) {
  if (!elements.meshTemplates) return;
  const templates = listTemplates();
  const selected = preferredId || selectedTemplateId();
  elements.meshTemplates.innerHTML = "";
  if (!templates.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No templates yet";
    elements.meshTemplates.append(option);
  } else {
    for (const template of templates) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      elements.meshTemplates.append(option);
    }
    if (selected && templates.some((entry) => entry.id === selected)) {
      elements.meshTemplates.value = selected;
    }
  }
  updateTemplateControls();
}

function updateTemplateControls() {
  const hasProject = Boolean(state.project) && !state.busy;
  const hasSelection = Boolean(selectedTemplateId());
  if (elements.saveTemplate) elements.saveTemplate.disabled = !hasProject;
  if (elements.applyTemplate) elements.applyTemplate.disabled = !hasProject || !hasSelection;
  if (elements.deleteTemplate) elements.deleteTemplate.disabled = state.busy || !hasSelection;
  if (elements.exportTemplate) elements.exportTemplate.disabled = state.busy || !hasSelection;
  if (elements.importTemplate) elements.importTemplate.disabled = state.busy;
  if (elements.meshTemplates) elements.meshTemplates.disabled = state.busy;
}

function defaultTemplateName() {
  const layer = state.captureMeta?.layerName || state.project?.source?.layerName || "";
  const meshName = state.project?.mesh?.name || "";
  const base = String(layer || meshName || "Mesh").replace(/\s*\[Original\]\s*$/i, "").trim();
  return base || "Untitled template";
}

function saveCurrentAsTemplate() {
  if (!state.project || state.busy) return;
  try {
    const faces = state.project.mesh.quads;
    if (!faces.length || !faces.some((face) => face.length >= 3)) {
      throw new Error("Create at least one triangle or quad face before saving a template.");
    }
    const suggested = defaultTemplateName();
    const name = window.prompt("Template name", suggested);
    if (name === null) return;
    const template = meshToTemplate(snapshotMesh(), name);
    upsertTemplate(template);
    refreshTemplateList(template.id);
    setStatus("success", "Template saved", `“${template.name}” is stored in this browser. Export JSON to share it.`);
  } catch (error) {
    setStatus("error", "Could not save template", error.message);
  }
}

function applySelectedTemplate() {
  if (!state.project || state.busy) return;
  const id = selectedTemplateId();
  if (!id) {
    setStatus("warning", "No template selected", "Choose a mesh template, then press Apply.");
    return;
  }
  try {
    const template = getTemplate(id);
    if (!template) throw new Error("That template is no longer in the library.");
    const before = snapshotMesh();
    const fitted = fitMeshToBounds(template.mesh, normalizedSourceBounds());
    const islands = computeIslands(fitted.quads, fitted.sourceVertices);
    restoreMesh({
      ...fitted,
      islandOrder: resolveIslandOrder(islands, fitted.islandOrder),
    });
    pushUndo(before);
    setStatus("success", "Template applied",
      `“${template.name}” fitted to the current source bounds (layout + warp).`);
  } catch (error) {
    setStatus("error", "Could not apply template", error.message);
  }
}

function deleteSelectedTemplate() {
  if (state.busy) return;
  const id = selectedTemplateId();
  if (!id) return;
  const template = getTemplate(id);
  if (!template) {
    refreshTemplateList();
    return;
  }
  if (!window.confirm(`Delete template “${template.name}”?`)) return;
  removeStoredTemplate(id);
  refreshTemplateList();
  setStatus("success", "Template deleted", `“${template.name}” was removed from this browser.`);
}

function exportSelectedTemplate() {
  if (state.busy) return;
  const id = selectedTemplateId();
  if (!id) return;
  try {
    const template = getTemplate(id);
    if (!template) throw new Error("That template is no longer in the library.");
    const blob = new Blob([serializeTemplate(template)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = template.name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "mesh-template";
    link.href = url;
    link.download = `${safeName}.uvwp-template.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("success", "Template exported", `Downloaded “${template.name}”.`);
  } catch (error) {
    setStatus("error", "Could not export template", error.message);
  }
}

async function importTemplateFile(file) {
  if (!file || state.busy) return;
  try {
    const text = await file.text();
    const parsed = parseTemplateFile(text);
    if (!parsed.length) throw new Error("The file did not contain any templates.");
    const imported = importTemplates(parsed);
    refreshTemplateList(imported[0]?.id || null);
    setStatus("success", "Template imported",
      imported.length === 1
        ? `“${imported[0].name}” was added to this browser.`
        : `${imported.length} templates were added to this browser.`);
  } catch (error) {
    setStatus("error", "Could not import template", error.message);
  }
}

function resetLayout() {
  if (!state.project || state.busy) return;
  const before = snapshotMesh();
  state.project.mesh = seedQuadMesh(normalizedSourceBounds());
  clearSelection();
  pushUndo(before);
  setMode("layout");
  setStatus("success", "Mesh reset", "A single quad now covers the source bounds.");
}

function resetWarp() {
  if (!state.project || state.busy) return;
  const before = snapshotMesh();
  state.project.mesh.warpVertices = clonePoints(state.project.mesh.sourceVertices);
  state.project.mesh.warpLinked = true;
  clearSelection();
  pushUndo(before);
  setMode("warp");
  setStatus("info", "Warp reset", "The warp points match the source layout again.");
}

function imageFromBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buffer], { type: "image/png" }));
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Photopea returned an unreadable image.")); };
    image.src = url;
  });
}

function readReferenceFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const image = new Image();
      image.onload = () => resolve({ image, dataUrl });
      image.onerror = () => reject(new Error("The selected reference image could not be decoded."));
      image.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("The selected reference image could not be read."));
    reader.readAsDataURL(file);
  });
}

function updateSourceSummary() {
  if (!state.captureMeta) return;
  elements.layerName.textContent = state.captureMeta.layerName;
  elements.layerMeta.textContent = `${Math.round(state.captureMeta.documentWidth)} × ${Math.round(state.captureMeta.documentHeight)} px document · ${state.captureMeta.smartObject ? "Smart Object" : "Raster layer"}`;
}

function randomProjectId() {
  return `uvwp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeLayerLabel(value) {
  return String(value || "Layer").replace(/[\r\n[\]]+/g, " ").trim().slice(0, 48);
}

function stripWarpTags(name) {
  return String(name || "Layer")
    .replace(/\s*\[Original\]\s*$/i, "")
    .replace(/\s*\[Warped\]\s*$/i, "")
    .trim();
}

function makeOutputNames(layerName, projectId, existingOutput = null) {
  const shortId = String(projectId || "").replace(/^uvwp-/, "").slice(-8) || "warp";
  const base = safeLayerLabel(stripWarpTags(layerName));
  return {
    baseName: base,
    originalName: `${base} [Original]`,
    resultName: `${base} [Warped]`,
    // Keep a stable group / data-layer identity across re-exports when possible.
    groupName: existingOutput?.groupName || `UV Warp · ${base} [UVWP:${shortId}]`,
    dataLayerName: existingOutput?.dataLayerName || `Mesh Data — do not edit [${shortId}]`,
  };
}

/**
 * Reference info saved into the PSD. Only lightweight metadata is stored:
 * pixels live in a Photopea text layer otherwise, which makes the output
 * script large enough to stall Photopea. Layer references are re-rendered
 * from the PSD on Edit, which is both smaller and higher fidelity.
 */
function buildReferencePayload() {
  if (!state.backdropImage || !state.referenceMeta) return null;
  if (state.referenceMeta.kind === "layer") {
    return {
      kind: "layer",
      layerId: state.referenceMeta.layerId,
      layerName: state.referenceMeta.layerName,
    };
  }
  return {
    kind: "image",
    fileName: state.referenceMeta.fileName || "reference.png",
  };
}

function projectFromCapture() {
  const projectId = randomProjectId();
  return {
    schemaVersion: 2,
    projectId,
    source: { ...state.captureMeta },
    mesh: seedQuadMesh(normalizedSourceBounds()),
    output: makeOutputNames(state.captureMeta.layerName, projectId),
    reference: null,
    view: {
      sourceOpacity: Number(elements.sourceOpacity.value),
      referenceOpacity: Number(elements.referenceOpacity.value),
      referenceTint: state.referenceTint,
      referenceTintColor: elements.referenceTintColor.value || "#ff4d6d",
      backgroundColor: elements.backgroundColor.value || "#0d0f12",
      insertMode: state.insertMode,
    },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLoadedProject(project) {
  if (!project || ![1, 2].includes(project.schemaVersion) || !project.source || !project.output) {
    throw new Error("This saved UV Warp uses an unsupported data format.");
  }
  validateProjectMesh(project.mesh);
  const tintColor = /^#[0-9a-fA-F]{6}$/.test(project.view?.referenceTintColor)
    ? project.view.referenceTintColor
    : "#ff4d6d";
  const backgroundColor = /^#[0-9a-fA-F]{6}$/.test(project.view?.backgroundColor)
    ? project.view.backgroundColor
    : "#0d0f12";
  return {
    ...project,
    schemaVersion: 2,
    source: { ...project.source, ...state.captureMeta },
    mesh: {
      name: project.mesh.name || "Custom mesh",
      warpLinked: Boolean(project.mesh.warpLinked),
      quads: project.mesh.quads.map((face) => [...face]),
      edges: ensureEdges(project.mesh.quads, project.mesh.edges).map((edge) => [...edge]),
      islandOrder: Array.isArray(project.mesh.islandOrder) ? [...project.mesh.islandOrder] : [],
      sourceVertices: clonePoints(project.mesh.sourceVertices),
      warpVertices: clonePoints(project.mesh.warpVertices),
    },
    reference: project.reference && typeof project.reference === "object" ? { ...project.reference } : null,
    view: {
      sourceOpacity: clamp(Number(project.view?.sourceOpacity) || 100, 0, 100),
      referenceOpacity: clamp(Number(project.view?.referenceOpacity) || 65, 0, 100),
      referenceTint: Boolean(project.view?.referenceTint),
      referenceTintColor: tintColor,
      backgroundColor,
      insertMode: "tri-quad",
    },
  };
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function clearCaptureTimeout(session = state.captureSession) {
  if (session?.timeoutId) clearTimeout(session.timeoutId);
  if (session) session.timeoutId = null;
}

function armCaptureTimeout(message) {
  const session = state.captureSession;
  if (!session) return;
  clearCaptureTimeout(session);
  session.timeoutId = setTimeout(() => {
    if (state.captureSession === session && !session.finalizing) failCapture(message);
  }, CAPTURE_TIMEOUT_MS);
}

function failCapture(message) {
  const session = state.captureSession;
  const fallback = state.pendingReferenceRestore;
  clearCaptureTimeout(session);
  if (session) session.finalizing = true;
  state.captureSession = null;
  state.pendingSavedProject = null;
  setBusy(false);
  setProjectReady(Boolean(state.project));
  if (session?.mode === "reference" && fallback?.imageDataUrl) {
    state.pendingReferenceRestore = null;
    restoreSavedReference(fallback);
    return;
  }
  state.pendingReferenceRestore = null;
  setStatus("error", "Capture failed", message);
}

function captureTemporaryName(session) {
  return `__UV_WARP_CAPTURE__${session.token}-${session.mode}`;
}

function captureTitle(session) {
  return session.mode === "source" ? "Capturing source…" : "Capturing reference…";
}

function startSnapshot() {
  const session = state.captureSession;
  if (!session || session.finalizing) return;
  session.stage = "snapshotting";
  setStatus("info", captureTitle(session), "Creating an independent PSD snapshot. The original workfile is not modified.");
  armCaptureTimeout("Photopea could not create an independent PSD snapshot.");
  postPhotopeaScript(makeSnapshotScript());
}

function openTemporaryCapture() {
  const session = state.captureSession;
  if (!session || session.finalizing || !session.snapshotBuffer) return;
  session.stage = "opening-temporary";
  session.current = { buffer: null, renderDone: false, cleanupDone: false, cleanupResult: null, temporaryDocumentName: captureTemporaryName(session) };
  setStatus("info", captureTitle(session), "Opening an independent temporary copy.");
  armCaptureTimeout("Photopea could not open the independent temporary copy.");
  postPhotopeaBinary(session.snapshotBuffer.slice(0));
}

function renderTemporaryCapture() {
  const session = state.captureSession;
  if (!session || session.finalizing || session.stage !== "opening-temporary" || !session.current) return;
  session.stage = "rendering";
  setStatus("info", captureTitle(session), `Rendering the isolated ${session.mode} layer…`);
  armCaptureTimeout(`Photopea did not finish rendering the ${session.mode}. Close the temporary capture tab without saving; the original workfile was never edited.`);
  postPhotopeaScript(makePrepareCapturePngScript({
    mode: session.captureMode,
    sourceLayerId: session.sourceMeta.layerId,
    hideGroupName: session.hideGroupName,
    temporaryDocumentName: session.current.temporaryDocumentName,
    sourceDocumentName: session.sourceMeta.documentName,
    sourceDocumentSource: session.sourceMeta.documentSource,
  }));
}

function maybeCloseTemporaryCapture() {
  const session = state.captureSession;
  if (!session || session.finalizing || session.stage !== "rendering" || !session.current?.buffer || !session.current.renderDone) return;
  session.stage = "closing-temporary";
  setStatus("info", captureTitle(session), "Closing the temporary copy and restoring the original workfile…");
  armCaptureTimeout(`Photopea did not close “${session.current.temporaryDocumentName}”. Close it without saving; the original workfile was never edited.`);
  postPhotopeaScript(makeCloseTemporaryScript({
    temporaryDocumentName: session.current.temporaryDocumentName,
    sourceDocumentName: session.sourceMeta.documentName,
    sourceDocumentSource: session.sourceMeta.documentSource,
  }));
}

async function finishSourceCapture(session) {
  state.captureMeta = session.sourceMeta;
  state.sourceImage = await imageFromBuffer(session.current.buffer);
  let restoreReference = null;
  if (state.pendingSavedProject) {
    state.project = normalizeLoadedProject(state.pendingSavedProject);
    restoreReference = state.project.reference;
    state.pendingSavedProject = null;
    elements.sourceOpacity.value = String(state.project.view.sourceOpacity);
    elements.referenceOpacity.value = String(state.project.view.referenceOpacity);
    elements.referenceTintColor.value = state.project.view.referenceTintColor || "#ff4d6d";
    elements.backgroundColor.value = state.project.view.backgroundColor || "#0d0f12";
    state.referenceTint = Boolean(state.project.view.referenceTint);
    state.insertMode = "tri-quad";
    setMode("warp");
    setStatus("success", "Saved warp loaded",
      restoreReference
        ? "Source loaded. Restoring the saved reference…"
        : "The saved mesh is editable again. Add a reference when you are ready to align it.");
  } else {
    state.project = projectFromCapture();
    setMode("layout");
    setStatus(state.captureMeta.smartObject ? "success" : "warning",
      state.captureMeta.smartObject ? "Source captured" : "Source is not a Smart Object",
      state.captureMeta.smartObject ? "Use Draw to edit the source mesh, then optionally capture a reference." : "The original remains untouched, but converting it to a Smart Object is recommended.");
  }
  state.undo = [];
  state.redo = [];
  clearSelection();
  resetZoom();
  updateSourceSummary();
  elements.sourceOpacityValue.textContent = `${elements.sourceOpacity.value}%`;
  elements.referenceOpacityValue.textContent = `${elements.referenceOpacity.value}%`;
  syncReferenceTintControls();
  setBusy(false);
  setProjectReady(true);
  scheduleRender();
  if (restoreReference) {
    queueMicrotask(() => restoreSavedReference(restoreReference));
  }
}

async function finishReferenceCapture(session) {
  state.backdropImage = await imageFromBuffer(session.current.buffer);
  const sameLayer = session.sourceMeta.layerId === state.captureMeta?.layerId;
  state.referenceMeta = {
    kind: "layer",
    layerId: session.sourceMeta.layerId,
    layerName: session.sourceMeta.layerName,
  };
  setReferenceSummary(
    session.sourceMeta.layerName,
    `${Math.round(session.sourceMeta.documentWidth)} × ${Math.round(session.sourceMeta.documentHeight)} px · captured layer`,
  );
  setBusy(false);
  setProjectReady(true);
  state.pendingReferenceRestore = null;
  const restored = Boolean(session.restoring);
  setStatus(sameLayer ? "warning" : "success",
    sameLayer ? "Reference matches the source" : restored ? "Reference restored" : "Reference captured",
    sameLayer
      ? "The same layer was selected for both. Select a different layer in Photopea and capture again."
      : restored
        ? "Source and reference are ready. Adjust the mesh, then Create output to update."
        : "Only that layer was captured. The source mesh was preserved and can be aligned in Warp.");
  scheduleRender();
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The saved reference image could not be decoded."));
    image.src = dataUrl;
  });
}

async function restoreSavedReference(reference) {
  if (!reference || state.busy || !state.project) return;
  if (reference.kind === "layer" && reference.layerId != null) {
    beginReferenceCapture({
      layerId: reference.layerId,
      layerName: reference.layerName,
      restoring: true,
      fallback: reference.imageDataUrl ? { ...reference, kind: "image" } : null,
    });
    return;
  }
  if (!reference.imageDataUrl) {
    setStatus("info", "Saved warp loaded",
      `The reference was the loaded image “${reference.fileName || "reference"}”, which is not stored in the PSD. Use Load image to add it again.`);
    return;
  }
  try {
    setBusy(true);
    state.backdropImage = await imageFromDataUrl(reference.imageDataUrl);
    state.referenceMeta = {
      kind: reference.kind === "layer" ? "layer" : "image",
      layerId: reference.layerId,
      layerName: reference.layerName,
      fileName: reference.fileName || reference.layerName || "Saved reference",
      imageDataUrl: reference.imageDataUrl,
    };
    setReferenceSummary(
      state.referenceMeta.fileName || state.referenceMeta.layerName || "Saved reference",
      `${state.backdropImage.naturalWidth} × ${state.backdropImage.naturalHeight} px · restored`,
    );
    setStatus("success", "Reference restored", "Source and reference are ready. Adjust the mesh, then Create output to update.");
  } catch (error) {
    setStatus("warning", "Source loaded without reference", error.message);
  } finally {
    setBusy(false);
    setProjectReady(true);
    scheduleRender();
  }
}

function maybeFinishTemporaryCapture() {
  const session = state.captureSession;
  if (!session || session.finalizing || session.stage !== "closing-temporary" || !session.current?.cleanupDone || !session.current.cleanupResult) return;
  const result = session.current.cleanupResult;
  if (!result.ok || !result.temporaryDocumentClosed || !result.sourceDocumentRestored) {
    failCapture(result.message || "Photopea could not close the temporary capture document and restore the original.");
    return;
  }
  clearCaptureTimeout(session);
  session.stage = "finishing";
  session.finalizing = true;
  const finish = session.mode === "source" ? finishSourceCapture : finishReferenceCapture;
  finish(session).catch((error) => {
    setBusy(false);
    setStatus("error", "Capture failed", error.message);
  }).finally(() => {
    clearCaptureTimeout(session);
    if (state.captureSession === session) state.captureSession = null;
  });
}

function handleCaptureDone() {
  const session = state.captureSession;
  if (!session || session.finalizing) return;
  if (session.stage === "reading-meta") {
    if (!session.sourceMeta) failCapture("Photopea finished without returning layer metadata.");
    else startSnapshot();
  } else if (session.stage === "snapshotting") {
    session.snapshotDone = true;
    if (session.snapshotBuffer) openTemporaryCapture();
  } else if (session.stage === "opening-temporary") {
    renderTemporaryCapture();
  } else if (session.stage === "rendering") {
    session.current.renderDone = true;
    maybeCloseTemporaryCapture();
  } else if (session.stage === "closing-temporary") {
    session.current.cleanupDone = true;
    maybeFinishTemporaryCapture();
  }
}

async function normalizeCaptureBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Blob) return value.arrayBuffer();
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return null;
}

async function handleCaptureBuffer(buffer) {
  const session = state.captureSession;
  if (!session || session.finalizing) return;
  if (session.stage === "snapshotting") {
    if (session.snapshotBuffer) return failCapture("Photopea returned more than one PSD snapshot.");
    session.snapshotBuffer = buffer;
    if (session.snapshotDone) openTemporaryCapture();
    return;
  }
  if (session.stage !== "rendering" || !session.current) return;
  if (session.current.buffer) return failCapture("Photopea returned more than one PNG for this capture.");
  session.current.buffer = buffer;
  maybeCloseTemporaryCapture();
}

function beginSourceCapture(savedProject = null) {
  if (state.busy) return;
  if (!isEmbeddedInPhotopea()) {
    setStatus("error", "Open inside Photopea", "Load plugin.local.json or the hosted plugin JSON through Window → Plugins.");
    return;
  }
  const requestId = Date.now();
  state.pendingSavedProject = savedProject;
  state.captureSession = {
    token: `${requestId}-${Math.random().toString(36).slice(2, 8)}`,
    requestId, mode: "source", captureMode: "source", stage: "reading-meta", finalizing: false, timeoutId: null,
    sourceMeta: null, snapshotBuffer: null, snapshotDone: false, current: null,
    hideGroupName: savedProject?.output?.groupName || "",
  };
  setBusy(true);
  setStatus("info", savedProject ? "Loading saved warp…" : "Capturing source…", "Reading the selected layer without changing the original workfile.");
  armCaptureTimeout("Photopea did not respond while reading the selected layer.");
  readCaptureMeta({ sourceLayerId: savedProject?.source?.layerId ?? null, requestId });
}

function beginReferenceCapture({ layerId = null, layerName = "", restoring = false, fallback = null } = {}) {
  if (!state.project || !state.captureMeta || state.busy) return;
  if (!isEmbeddedInPhotopea()) {
    setStatus("error", "Open inside Photopea", "Reference capture requires the Photopea plugin panel.");
    return;
  }
  const requestId = Date.now();
  state.pendingReferenceRestore = fallback;
  state.captureSession = {
    token: `${requestId}-${Math.random().toString(36).slice(2, 8)}`,
    requestId, mode: "reference", captureMode: "source", stage: "reading-meta", finalizing: false, timeoutId: null,
    sourceMeta: null, snapshotBuffer: null, snapshotDone: false, current: null,
    hideGroupName: "",
    restoring,
  };
  setBusy(true);
  setStatus("info", restoring ? "Restoring reference…" : "Capturing reference…",
    layerId == null
      ? "Reading the layer selected in Photopea without changing the original workfile."
      : `Reading “${layerName || "saved reference layer"}” without changing the original workfile.`);
  armCaptureTimeout("Photopea did not respond while preparing the reference capture.");
  readCaptureMeta({ sourceLayerId: layerId, requestId });
}

function serializeProject() {
  const names = makeOutputNames(
    state.captureMeta?.layerName || state.project.source.layerName,
    state.project.projectId,
    state.project.output,
  );
  const project = {
    ...state.project,
    schemaVersion: 2,
    source: {
      ...state.project.source,
      ...state.captureMeta,
      layerName: names.originalName,
    },
    mesh: snapshotMesh(),
    output: {
      ...state.project.output,
      ...names,
    },
    reference: buildReferencePayload(),
    view: {
      sourceOpacity: Number(elements.sourceOpacity.value),
      referenceOpacity: Number(elements.referenceOpacity.value),
      referenceTint: state.referenceTint,
      referenceTintColor: elements.referenceTintColor.value || "#ff4d6d",
      backgroundColor: elements.backgroundColor.value || "#0d0f12",
      insertMode: state.insertMode,
    },
    updatedAt: new Date().toISOString(),
  };
  validateProjectMesh(project.mesh);
  return project;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the warped image.")), "image/png"));
}

function clearOutputTimeout() {
  if (!state.outputTimeoutId) return;
  clearTimeout(state.outputTimeoutId);
  state.outputTimeoutId = null;
}

function failOutput(message) {
  const saving = state.outputSession?.stage === "saving-mesh";
  clearOutputTimeout();
  state.outputSession = null;
  setBusy(false);
  setStatus("error", saving ? "Could not save mesh" : "Could not create output", message);
}

/** Photopea can swallow a script silently, so never leave the panel spinning. */
function armOutputTimeout(stageMessage) {
  clearOutputTimeout();
  state.outputTimeoutId = setTimeout(() => {
    const saving = state.outputSession?.stage === "saving-mesh";
    state.outputTimeoutId = null;
    state.outputSession = null;
    setBusy(false);
    setStatus(
      "error",
      saving ? "Photopea did not confirm the mesh save" : "Photopea did not confirm the output",
      stageMessage || (saving
        ? "Try Save mesh again."
        : "The original workfile should be unchanged. Close any extra PNG tab Photopea opened, then try Create output again."),
    );
  }, OUTPUT_TIMEOUT_MS);
}

function beginOutputFinalize() {
  const session = state.outputSession;
  if (!session || session.stage !== "placing") return;
  session.stage = "finalizing";
  armOutputTimeout("Photopea opened the rendered PNG but did not finish adding it to the workfile.");
  setStatus("info", "Adding output layers…", "Renaming the source with [Original] and adding the [Warped] result.");
  postPhotopeaScript(createOutputFinalizeScript(session.finalize));
}

async function createOutput() {
  if (!state.project || state.busy) return;
  try {
    if (!isEmbeddedInPhotopea()) {
      throw new Error("Create output requires the Photopea plugin panel.");
    }
    const faces = state.project.mesh.quads;
    if (!faces.length || !faces.some((face) => face.length >= 3)) {
      throw new Error("Create at least one triangle or quad face with Draw before creating output.");
    }
    validateProjectMesh(state.project.mesh);
    const width = state.sourceImage.naturalWidth;
    const height = state.sourceImage.naturalHeight;
    if (width * height > 180_000_000) throw new Error("This document is too large to render safely in the browser.");
    const source = state.project.mesh.sourceVertices.map((point) => ({ x: point.x * width, y: point.y * height }));
    const target = state.project.mesh.warpVertices.map((point) => ({ x: point.x * width, y: point.y * height }));
    const warnings = meshWarnings(source, target, state.project.mesh.quads);
    if (warnings.degenerate) throw new Error("One or more mesh triangles are collapsed. Move overlapping points apart.");
    setBusy(true);
    const triangleCount = triangulateQuads(faces).length;
    setStatus("info", "Rendering output…", `${width} × ${height} px · ${triangleCount} render triangle${triangleCount === 1 ? "" : "s"}`);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    drawWarpedMesh(canvas.getContext("2d", { alpha: true }), state.sourceImage, source, target, state.project.mesh.quads, {
      seamOverlap: 0.7,
      faceOrder: facesInIslandOrder(state.project.mesh.quads, state.project.mesh.sourceVertices, state.project.mesh.islandOrder),
    });
    const previousResultName = state.project.output?.resultName || "";
    // Keep the live Photopea layer name for lookup; serializeProject renames it locally to [Original].
    const liveSourceName = stripWarpTags(
      state.captureMeta?.layerName || state.project.source.layerName || "",
    );
    const project = serializeProject();
    const stateBase64 = encodeBase64Utf8(JSON.stringify(project));
    if (stateBase64.length > MAX_STATE_BYTES) {
      throw new Error(`The mesh data is too large to store in the PSD (${Math.round(stateBase64.length / 1024)} KB). Reduce the number of faces and try again.`);
    }
    state.project = project;
    if (state.captureMeta) state.captureMeta.layerName = project.output.originalName;
    updateSourceSummary();
    const buffer = await (await canvasToBlob(canvas)).arrayBuffer();
    state.outputSession = {
      stage: "placing",
      finalize: {
        sourceLayerId: project.source.layerId,
        sourceLayerName: liveSourceName,
        originalLayerName: project.output.originalName,
        projectId: project.projectId,
        stateBase64,
        groupName: project.output.groupName,
        resultName: project.output.resultName,
        previousResultName,
        dataLayerName: project.output.dataLayerName,
        sourceDocumentName: project.source.documentName || state.captureMeta?.documentName || "",
        sourceDocumentSource: project.source.documentSource || state.captureMeta?.documentSource || "",
      },
    };
    armOutputTimeout("Photopea did not open the rendered PNG. Try Create output again.");
    setStatus("info", "Sending output to Photopea…", "Opening the warped image, then adding it to the workfile.");
    postPhotopeaBinary(buffer);
  } catch (error) {
    failOutput(error.message);
  }
}

async function saveMesh() {
  if (!state.project || state.busy) return;
  try {
    if (!isEmbeddedInPhotopea()) {
      throw new Error("Save mesh requires the Photopea plugin panel.");
    }
    const faces = state.project.mesh.quads;
    if (!faces.length || !faces.some((face) => face.length >= 3)) {
      throw new Error("Create at least one triangle or quad face with Draw before saving.");
    }
    validateProjectMesh(state.project.mesh);
    setBusy(true);
    setStatus("info", "Saving mesh…", "Writing mesh data into the PSD without rendering a warped image.");
    const liveSourceName = stripWarpTags(
      state.captureMeta?.layerName || state.project.source.layerName || "",
    );
    // Preserve the live source name for lookup; do not rename to [Original] on save-only.
    const names = makeOutputNames(
      state.captureMeta?.layerName || state.project.source.layerName,
      state.project.projectId,
      state.project.output,
    );
    const project = {
      ...serializeProject(),
      source: {
        ...state.project.source,
        ...state.captureMeta,
        layerName: liveSourceName,
      },
      output: {
        ...state.project.output,
        ...names,
      },
    };
    // Keep originalName for Edit later, but do not rename the live layer during save.
    const stateBase64 = encodeBase64Utf8(JSON.stringify({
      ...project,
      source: {
        ...project.source,
        layerName: names.originalName,
      },
    }));
    if (stateBase64.length > MAX_STATE_BYTES) {
      throw new Error(`The mesh data is too large to store in the PSD (${Math.round(stateBase64.length / 1024)} KB). Reduce the number of faces and try again.`);
    }
    state.project = {
      ...project,
      source: { ...project.source, layerName: liveSourceName },
    };
    state.outputSession = { stage: "saving-mesh" };
    armOutputTimeout("Photopea did not confirm the mesh save. Try Save mesh again.");
    postPhotopeaScript(createSaveMeshScript({
      sourceLayerId: project.source.layerId,
      sourceLayerName: liveSourceName,
      projectId: project.projectId,
      stateBase64,
      groupName: names.groupName,
      dataLayerName: names.dataLayerName,
    }));
  } catch (error) {
    failOutput(error.message);
  }
}

function parseSavedProjects(items) {
  const projects = [];
  for (const item of items || []) {
    try {
      const project = JSON.parse(decodeBase64Utf8(item.data));
      if (![1, 2].includes(project.schemaVersion)) continue;
      validateProjectMesh(project.mesh);
      project.output ??= {};
      if (!project.output.groupName) project.output.groupName = item.groupName;
      projects.push(project);
    } catch (_) {}
  }
  return projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function updateSavedProjects() {
  elements.savedProjects.replaceChildren(...state.savedProjects.map((project) => {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = `${stripWarpTags(project.source.layerName)} · ${project.mesh.quads.length} face${project.mesh.quads.length === 1 ? "" : "s"}`;
    return option;
  }));
  elements.savedBar.classList.toggle("is-hidden", !state.savedProjects.length);
}

function selectedSavedProject() {
  return state.savedProjects.find((project) => project.projectId === elements.savedProjects.value);
}

function loadSelectedProject() {
  const project = selectedSavedProject();
  if (project) beginSourceCapture(project);
}

function toggleSelectedOutput() {
  const project = state.project?.output?.groupName ? state.project : selectedSavedProject();
  if (!project || state.busy) return;
  setBusy(true);
  setStatus("info", "Toggling result…", "Switching between the original source and warped output.");
  toggleSavedOutput({
    groupName: project.output.groupName,
    sourceLayerId: project.source.layerId,
    sourceLayerName: project.source.layerName,
    originalLayerName: project.output.originalName || "",
  });
}

function refreshPhotopeaState() {
  if (!isEmbeddedInPhotopea()) {
    elements.layerName.textContent = "Panel preview";
    elements.layerMeta.textContent = "Install this panel in Photopea to capture a layer.";
    setStatus("warning", "Open inside Photopea", "The interface is responsive here; image capture requires the Photopea panel.");
    return;
  }
  requestSelectedLayer();
  scanSavedWarps();
}

async function handlePhotopeaResponse(event) {
  if (event.source !== window.parent) return;
  if (event.data === "done") {
    if (state.outputSession?.stage === "placing") beginOutputFinalize();
    else handleCaptureDone();
    return;
  }
  if (state.captureSession && !state.captureSession.finalizing) {
    const buffer = await normalizeCaptureBuffer(event.data);
    if (buffer) {
      await handleCaptureBuffer(buffer);
      return;
    }
  }
  const message = parsePhotopeaMessage(event.data);
  if (!message) return;
  if (message.type === "selection") {
    if (message.ok && !state.captureSession) {
      elements.layerName.textContent = message.name;
      elements.layerMeta.textContent = `${Math.round(message.width)} × ${Math.round(message.height)} px · ${message.smartObject ? "Smart Object" : "convert to Smart Object first"}`;
    } else if (!message.ok && !state.captureSession) {
      elements.layerName.textContent = "No usable layer selected";
      elements.layerMeta.textContent = message.message;
    }
    return;
  }
  if (message.type === "capture-meta") {
    const session = state.captureSession;
    if (!session || session.finalizing || session.stage !== "reading-meta" || (message.requestId !== undefined && message.requestId !== session.requestId)) return;
    if (!message.ok) return failCapture(message.message || "Photopea could not read the source layer.");
    session.sourceMeta = message;
    if (session.mode === "source") state.captureMeta = message;
    setStatus("info", captureTitle(session), "Layer identified. Waiting for Photopea to finish before snapshotting…");
    return;
  }
  if (message.type === "capture-cleanup") {
    const session = state.captureSession;
    if (!session || session.finalizing || session.stage !== "closing-temporary") return;
    session.current.cleanupResult = message;
    maybeFinishTemporaryCapture();
    return;
  }
  if (message.type === "capture-complete" && !message.ok) return failCapture(message.message || "Capture failed.");
  if (message.type === "saved-projects") {
    if (message.ok) {
      state.savedProjects = parseSavedProjects(message.projects);
      updateSavedProjects();
    } else setStatus("warning", "Could not read saved warps", message.message);
    return;
  }
  if (message.type === "output-result") {
    clearOutputTimeout();
    state.outputSession = null;
    setBusy(false);
    if (message.ok) {
      if (message.originalLayerName) {
        if (state.project?.source) state.project.source.layerName = message.originalLayerName;
        if (state.captureMeta) state.captureMeta.layerName = message.originalLayerName;
        updateSourceSummary();
      }
      if (message.dataSaved === false) {
        setStatus("warning", "Output created without mesh data",
          `“${state.project.output.resultName}” was added, but Photopea could not store the mesh text layer. You can use the result, but Edit later will not work for this warp.`);
      } else {
        setStatus("success", "Output created",
          `Source is now “${state.project.output.originalName}”. Result is “${state.project.output.resultName}”. Mesh data stays hidden — do not edit or delete it.`);
      }
      scanSavedWarps();
    } else setStatus("error", "Photopea could not add the output", message.message);
    return;
  }
  if (message.type === "save-mesh-result") {
    clearOutputTimeout();
    state.outputSession = null;
    setBusy(false);
    if (message.ok) {
      if (message.dataSaved === false) {
        setStatus("warning", "Mesh group created without data",
          "Photopea could not write the mesh text layer. Try Save mesh again.");
      } else {
        setStatus("success", "Mesh saved",
          `Mesh data stored in “${message.groupName || state.project.output.groupName}”. No warped image was created.`);
      }
      scanSavedWarps();
    } else setStatus("error", "Could not save mesh", message.message);
    return;
  }
  if (message.type === "toggle-result") {
    setBusy(false);
    if (message.ok) setStatus("success", message.visible ? "UV Warp enabled" : "UV Warp disabled", message.visible ? "Showing the warped output." : "Showing the untouched source.");
    else setStatus("error", "Could not toggle output", message.message);
  }
}

elements.captureSource.addEventListener("click", () => beginSourceCapture());
elements.clearSource.addEventListener("click", clearSource);
elements.captureReference.addEventListener("click", () => beginReferenceCapture());
elements.loadReference.addEventListener("click", () => elements.referenceFile.click());
elements.clearReference.addEventListener("click", clearReference);
elements.referenceFile.addEventListener("change", async () => {
  const [file] = elements.referenceFile.files;
  if (!file || !state.project || state.busy) return;
  try {
    setBusy(true);
    setStatus("info", "Loading reference…", "Reading the selected image.");
    const { image, dataUrl } = await readReferenceFile(file);
    state.backdropImage = image;
    state.referenceMeta = {
      kind: "image",
      fileName: file.name,
      imageDataUrl: dataUrl,
    };
    setReferenceSummary(file.name, `${image.naturalWidth} × ${image.naturalHeight} px image`);
    setStatus("success", "Reference loaded", "The source mesh was preserved.");
  } catch (error) {
    setStatus("error", "Could not load reference", error.message);
  } finally {
    elements.referenceFile.value = "";
    setBusy(false);
    scheduleRender();
  }
});
elements.refreshProjects.addEventListener("click", refreshPhotopeaState);
elements.loadProject.addEventListener("click", loadSelectedProject);
elements.toggleOutput.addEventListener("click", toggleSelectedOutput);
elements.modeLayout.addEventListener("click", () => setMode("layout"));
elements.modeWarp.addEventListener("click", () => setMode("warp"));
elements.toolPen.addEventListener("click", () => setLayoutTool("pen"));
elements.toolSelect.addEventListener("click", () => setLayoutTool("select"));
elements.drawModeLine?.addEventListener("click", () => setFaceMode(false));
elements.drawModeFace?.addEventListener("click", () => setFaceMode(true));
elements.previewToggle.addEventListener("click", togglePreview);
elements.meshToggle.addEventListener("click", toggleMesh);
elements.trianglesToggle.addEventListener("click", toggleTriangles);
elements.connectionsToggle.addEventListener("click", toggleConnections);
elements.islandsToggle?.addEventListener("click", toggleIslands);
elements.raiseIsland?.addEventListener("click", raiseSelectedIsland);
elements.fullscreenToggle.addEventListener("click", toggleFullscreen);
for (const [input, output] of [[elements.sourceOpacity, elements.sourceOpacityValue], [elements.referenceOpacity, elements.referenceOpacityValue]]) {
  input.addEventListener("input", () => { output.textContent = `${input.value}%`; scheduleRender(); });
}
elements.referenceTintToggle.addEventListener("click", () => {
  state.referenceTint = !state.referenceTint;
  syncReferenceTintControls();
  scheduleRender();
});
elements.referenceTintColor.addEventListener("input", () => scheduleRender());
elements.backgroundColor.addEventListener("input", () => scheduleRender());
elements.resetLayout.addEventListener("click", resetLayout);
elements.resetWarp.addEventListener("click", resetWarp);
elements.deleteSelection.addEventListener("click", deleteSelection);
elements.saveMesh?.addEventListener("click", saveMesh);
elements.createOutput.addEventListener("click", createOutput);
elements.saveTemplate?.addEventListener("click", saveCurrentAsTemplate);
elements.applyTemplate?.addEventListener("click", applySelectedTemplate);
elements.deleteTemplate?.addEventListener("click", deleteSelectedTemplate);
elements.exportTemplate?.addEventListener("click", exportSelectedTemplate);
elements.importTemplate?.addEventListener("click", () => elements.templateFile?.click());
elements.meshTemplates?.addEventListener("change", updateTemplateControls);
elements.templateFile?.addEventListener("change", async () => {
  const [file] = elements.templateFile.files || [];
  elements.templateFile.value = "";
  await importTemplateFile(file);
});
elements.undo.addEventListener("click", undo);
elements.redo.addEventListener("click", redo);
elements.canvas.addEventListener("pointerdown", handlePointerDown);
elements.canvas.addEventListener("pointermove", handlePointerMove);
elements.canvas.addEventListener("pointerup", finishPointerDrag);
elements.canvas.addEventListener("pointercancel", finishPointerDrag);
elements.canvas.addEventListener("pointerleave", () => {
  if (state.drag || state.panDrag) return;
  const hadHint = state.hoverVertex >= 0 || state.penPreview;
  state.hoverVertex = -1;
  state.penPreview = null;
  if (hadHint) scheduleRender();
});
elements.canvas.addEventListener("wheel", (event) => {
  if (!state.project || state.busy) return;
  event.preventDefault();
  const metrics = viewportMetrics();
  // Firefox reports lines or pages instead of pixels, so normalise first.
  const perUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? metrics.height : 1;
  setZoom(state.zoom * Math.exp(-event.deltaY * perUnit * 0.0015), pointerPosition(event, metrics));
}, { passive: false });
elements.canvas.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  handleKeyDown(event);
});
window.addEventListener("keyup", (event) => {
  setCtrlLineHeld(event.ctrlKey || event.metaKey);
  if (event.code !== "Space" || !state.panReady) return;
  state.panReady = false;
  elements.canvas.classList.remove("is-pan-ready");
});
window.addEventListener("blur", () => {
  setCtrlLineHeld(false);
  if (!state.panReady) return;
  state.panReady = false;
  elements.canvas.classList.remove("is-pan-ready");
});
window.addEventListener("message", handlePhotopeaResponse);
window.addEventListener("resize", scheduleRender);
new ResizeObserver(scheduleRender).observe(elements.editorWrap);

setToggle(elements.previewToggle, state.preview);
setToggle(elements.meshToggle, state.meshVisible);
setToggle(elements.trianglesToggle, state.trianglesVisible);
setToggle(elements.connectionsToggle, state.connectionsVisible);
setToggle(elements.islandsToggle, state.islandsVisible);
setToggle(elements.fullscreenToggle, state.fullscreen);
setToggle(elements.toolPen, true);
setFaceMode(true);
syncReferenceTintControls();
setProjectReady(false);
updateRaiseIslandButton();
refreshTemplateList();
updateHistoryButtons();
scheduleRender();
refreshPhotopeaState();
