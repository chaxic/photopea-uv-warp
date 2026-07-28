const MESSAGE_PREFIX = "UVWP:";
const DATA_PREFIX = "UVWP_DATA_V1:";

export function isEmbeddedInPhotopea() {
  return window.parent !== window;
}

export function postPhotopeaScript(script) {
  if (!isEmbeddedInPhotopea()) {
    throw new Error("This panel must be opened inside Photopea.");
  }
  window.parent.postMessage(script, "*");
}

export function postPhotopeaBinary(buffer) {
  if (!isEmbeddedInPhotopea()) {
    throw new Error("This panel must be opened inside Photopea.");
  }
  window.parent.postMessage(buffer, "*");
}

function commonScriptHelpers() {
  return `
  var prefix = ${JSON.stringify(MESSAGE_PREFIX)};
  function px(value) {
    if (typeof value === "number") return value;
    try { return value.as("px"); } catch (_) {}
    try { return Number(value.value); } catch (_) {}
    return Number(value);
  }
  function layerId(layer) {
    try { return Number(layer.id); } catch (_) { return -1; }
  }
  function findLayerById(container, wantedId) {
    if (wantedId === null || wantedId === undefined || wantedId < 0) return null;
    for (var i = 0; i < container.layers.length; i += 1) {
      var item = container.layers[i];
      if (layerId(item) === Number(wantedId)) return item;
      if (item.typename === "LayerSet") {
        var nested = findLayerById(item, wantedId);
        if (nested) return nested;
      }
    }
    return null;
  }
  function findLayerSetByName(container, wantedName) {
    for (var i = 0; i < container.layerSets.length; i += 1) {
      var group = container.layerSets[i];
      if (group.name === wantedName) return group;
      var nested = findLayerSetByName(group, wantedName);
      if (nested) return nested;
    }
    return null;
  }
  function findLayerByName(container, wantedName) {
    for (var i = 0; i < container.layers.length; i += 1) {
      var item = container.layers[i];
      if (item.name === wantedName) return item;
      if (item.typename === "LayerSet") {
        var nested = findLayerByName(item, wantedName);
        if (nested) return nested;
      }
    }
    return null;
  }
  function echo(type, object) {
    object.type = type;
    app.echoToOE(prefix + JSON.stringify(object));
  }`;
}

export function requestSelectedLayer() {
  const script = `
(function () {
  ${commonScriptHelpers()}
  try {
    if (!app.documents.length) throw new Error("Open a document first.");
    var documentRef = app.activeDocument;
    var layer = documentRef.activeLayer;
    if (!layer) throw new Error("Select a layer first.");
    if (layer.typename !== "ArtLayer") throw new Error("Select a single image layer, not a group.");
    var bounds = layer.bounds;
    var smart = false;
    try { smart = layer.kind === LayerKind.SMARTOBJECT; } catch (_) {}
    echo("selection", {
      ok: true,
      name: layer.name,
      layerId: layerId(layer),
      smartObject: smart,
      width: Math.max(0, px(bounds[2]) - px(bounds[0])),
      height: Math.max(0, px(bounds[3]) - px(bounds[1]))
    });
  } catch (error) {
    echo("selection", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;

  postPhotopeaScript(script);
}

export function readCaptureMeta({ sourceLayerId = null, requestId = 0 } = {}) {
  const script = `
(function () {
  ${commonScriptHelpers()}
  var requestId = ${JSON.stringify(Number(requestId) || 0)};
  try {
    if (!app.documents.length) throw new Error("Open a document first.");
    var sourceDocument = app.activeDocument;
    var requestedId = ${sourceLayerId === null ? "null" : JSON.stringify(Number(sourceLayerId))};
    var sourceLayer = requestedId === null
      ? sourceDocument.activeLayer
      : findLayerById(sourceDocument, requestedId);
    if (!sourceLayer) throw new Error("The saved source layer could not be found.");
    if (sourceLayer.typename !== "ArtLayer") throw new Error("Select a single image layer, not a group.");

    var bounds = sourceLayer.bounds;
    var documentWidth = px(sourceDocument.width);
    var documentHeight = px(sourceDocument.height);
    var smart = false;
    try { smart = sourceLayer.kind === LayerKind.SMARTOBJECT; } catch (_) {}
    echo("capture-meta", {
      ok: true,
      requestId: requestId,
      documentName: sourceDocument.name,
      documentSource: String(sourceDocument.source || ""),
      documentWidth: documentWidth,
      documentHeight: documentHeight,
      layerId: layerId(sourceLayer),
      layerName: sourceLayer.name,
      smartObject: smart,
      bounds: {
        left: px(bounds[0]) / documentWidth,
        top: px(bounds[1]) / documentHeight,
        right: px(bounds[2]) / documentWidth,
        bottom: px(bounds[3]) / documentHeight
      }
    });
  } catch (error) {
    echo("capture-meta", {
      ok: false,
      requestId: requestId,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;

  postPhotopeaScript(script);
}

export function makeSnapshotScript() {
  return `
(function () {
  ${commonScriptHelpers()}
  try {
    if (!app.documents.length) throw new Error("Open a document first.");
    // Untouched PSD snapshot for independent temporary documents.
    // Destructive isolation never runs in the original workfile.
    app.activeDocument.saveToOE("psd");
  } catch (error) {
    echo("capture-complete", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

export function makePrepareCapturePngScript({
  mode,
  sourceLayerId,
  hideGroupName = "",
  temporaryDocumentName,
  sourceDocumentName,
  sourceDocumentSource,
}) {
  const payload = JSON.stringify({
    mode,
    sourceLayerId: Number(sourceLayerId),
    hideGroupName: hideGroupName || "",
    temporaryDocumentName,
    sourceDocumentName,
    sourceDocumentSource: sourceDocumentSource || "",
  });

  return `
(function () {
  ${commonScriptHelpers()}
  var settings = ${payload};
  var temporaryDocument = null;

  function hideEveryLayer(container) {
    for (var i = 0; i < container.layers.length; i += 1) {
      var item = container.layers[i];
      if (item.typename === "LayerSet") hideEveryLayer(item);
      try { item.visible = false; } catch (_) {}
    }
  }
  function revealWithParents(layer, documentRef) {
    var current = layer;
    while (current && current !== documentRef) {
      try { current.visible = true; } catch (_) {}
      try { current = current.parent; } catch (_) { current = null; }
    }
  }
  function findSourceDocument() {
    if (!app.documents) return null;
    for (var i = 0; i < app.documents.length; i += 1) {
      var documentRef = app.documents[i];
      if (documentRef === temporaryDocument) continue;
      var source = "";
      try { source = String(documentRef.source || ""); } catch (_) {}
      if (settings.sourceDocumentSource && source === settings.sourceDocumentSource) {
        return documentRef;
      }
    }
    for (var j = 0; j < app.documents.length; j += 1) {
      var fallback = app.documents[j];
      if (fallback !== temporaryDocument && String(fallback.name || "") === settings.sourceDocumentName) {
        return fallback;
      }
    }
    return null;
  }

  try {
    if (!app.documents.length) throw new Error("Photopea could not open the temporary PSD snapshot.");
    temporaryDocument = app.activeDocument;
    if (!temporaryDocument) throw new Error("Photopea could not activate the temporary PSD snapshot.");
    temporaryDocument.name = settings.temporaryDocumentName;

    var captureLayer = findLayerById(temporaryDocument, settings.sourceLayerId);
    if (!captureLayer) captureLayer = temporaryDocument.activeLayer;
    if (!captureLayer || captureLayer.typename !== "ArtLayer") {
      throw new Error("The source layer could not be found in the temporary copy.");
    }

    if (settings.mode === "backdrop") {
      var groupToHide = findLayerSetByName(temporaryDocument, settings.hideGroupName);
      if (groupToHide) groupToHide.visible = false;
      captureLayer.visible = false;
    } else {
      hideEveryLayer(temporaryDocument);
      revealWithParents(captureLayer, temporaryDocument);
    }

    app.activeDocument = temporaryDocument;
    temporaryDocument.saveToOE("png");
  } catch (error) {
    try {
      if (temporaryDocument && temporaryDocument !== findSourceDocument()) {
        app.activeDocument = temporaryDocument;
        temporaryDocument.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_) {}
    try {
      var sourceDocument = findSourceDocument();
      if (sourceDocument) app.activeDocument = sourceDocument;
    } catch (_) {}
    echo("capture-complete", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

export function makeCloseTemporaryScript({
  temporaryDocumentName,
  sourceDocumentName,
  sourceDocumentSource,
}) {
  const payload = JSON.stringify({
    temporaryDocumentName,
    sourceDocumentName,
    sourceDocumentSource: sourceDocumentSource || "",
  });

  return `
(function () {
  ${commonScriptHelpers()}
  var settings = ${payload};

  function documentSource(documentRef) {
    try { return String(documentRef.source || ""); } catch (_) { return ""; }
  }
  function findTemporaryDocument() {
    if (!app.documents) return null;
    for (var i = 0; i < app.documents.length; i += 1) {
      var documentRef = app.documents[i];
      if (String(documentRef.name || "") === settings.temporaryDocumentName) return documentRef;
    }
    return null;
  }
  function findSourceDocument(temporaryDocument) {
    if (!app.documents) return null;
    for (var i = 0; i < app.documents.length; i += 1) {
      var documentRef = app.documents[i];
      if (documentRef === temporaryDocument) continue;
      if (settings.sourceDocumentSource && documentSource(documentRef) === settings.sourceDocumentSource) {
        return documentRef;
      }
    }
    for (var j = 0; j < app.documents.length; j += 1) {
      var fallback = app.documents[j];
      if (fallback !== temporaryDocument && String(fallback.name || "") === settings.sourceDocumentName) {
        return fallback;
      }
    }
    return null;
  }

  try {
    var temporaryDocument = findTemporaryDocument();
    var sourceDocument = findSourceDocument(temporaryDocument);
    if (!temporaryDocument) throw new Error("Photopea could not find the temporary capture document.");
    app.activeDocument = temporaryDocument;
    temporaryDocument.close(SaveOptions.DONOTSAVECHANGES);
    if (findTemporaryDocument()) throw new Error("Photopea left the temporary capture document open.");
    if (!sourceDocument) throw new Error("Photopea could not find the original workfile.");
    app.activeDocument = sourceDocument;
    if (app.activeDocument !== sourceDocument) {
      throw new Error("Photopea could not restore the original workfile.");
    }
    echo("capture-cleanup", {
      ok: true,
      temporaryDocumentClosed: true,
      sourceDocumentRestored: true
    });
  } catch (error) {
    echo("capture-cleanup", {
      ok: false,
      message: error && error.message ? error.message : String(error),
      temporaryDocumentClosed: !findTemporaryDocument(),
      sourceDocumentRestored: false
    });
  }
}());`;
}

export function scanSavedWarps() {
  const script = `
(function () {
  ${commonScriptHelpers()}
  var dataPrefix = ${JSON.stringify(DATA_PREFIX)};
  function scan(container, results) {
    for (var i = 0; i < container.layers.length; i += 1) {
      var item = container.layers[i];
      if (item.typename === "LayerSet") {
        scan(item, results);
        continue;
      }
      try {
        if (item.kind !== LayerKind.TEXT) continue;
        var contents = String(item.textItem.contents || "");
        if (contents.indexOf(dataPrefix) !== 0) continue;
        results.push({
          data: contents.substring(dataPrefix.length),
          dataLayerName: item.name,
          groupName: item.parent && item.parent.typename === "LayerSet"
            ? item.parent.name
            : ""
        });
      } catch (_) {}
    }
  }
  try {
    if (!app.documents.length) {
      echo("saved-projects", { ok: true, projects: [] });
      return;
    }
    var results = [];
    scan(app.activeDocument, results);
    echo("saved-projects", { ok: true, projects: results });
  } catch (error) {
    echo("saved-projects", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;

  postPhotopeaScript(script);
}

/**
 * Finalize Create output after the warped PNG was opened as a new document
 * via postMessage(ArrayBuffer).
 *
 * Photopea quirks this works around:
 * - Embedding a multi-megabyte data URL in one script stalls the runtime.
 * - Layer.move(..., INSIDE) after a cross-document duplicate often never returns.
 *   Duplicating straight into the group avoids that move.
 */
export function createOutputFinalizeScript({
  sourceLayerId,
  sourceLayerName,
  originalLayerName,
  projectId,
  stateBase64,
  groupName,
  resultName,
  previousResultName = "",
  dataLayerName,
  sourceDocumentName,
  sourceDocumentSource,
}) {
  const payload = JSON.stringify({
    sourceLayerId,
    sourceLayerName,
    originalLayerName,
    projectId,
    stateBase64,
    groupName,
    resultName,
    previousResultName: previousResultName || "",
    dataLayerName,
    sourceDocumentName: sourceDocumentName || "",
    sourceDocumentSource: sourceDocumentSource || "",
  });

  return `
(function () {
  ${commonScriptHelpers()}
  var dataPrefix = ${JSON.stringify(DATA_PREFIX)};
  var data = ${payload};
  var placedDocument = null;
  function documentSource(documentRef) {
    try { return String(documentRef.source || ""); } catch (_) { return ""; }
  }
  function findSourceDocument(activePlaced) {
    if (!app.documents) return null;
    if (data.sourceDocumentSource) {
      for (var i = 0; i < app.documents.length; i += 1) {
        var bySource = app.documents[i];
        if (bySource !== activePlaced && documentSource(bySource) === data.sourceDocumentSource) return bySource;
      }
    }
    if (data.sourceDocumentName) {
      for (var j = 0; j < app.documents.length; j += 1) {
        var byName = app.documents[j];
        if (byName !== activePlaced && String(byName.name || "") === data.sourceDocumentName) return byName;
      }
    }
    return null;
  }
  function placedArtLayer(docRef) {
    var layer = docRef.activeLayer;
    if (layer && layer.typename === "ArtLayer") return layer;
    if (docRef.artLayers && docRef.artLayers.length) return docRef.artLayers[0];
    if (docRef.layers && docRef.layers.length) {
      for (var i = 0; i < docRef.layers.length; i += 1) {
        if (docRef.layers[i].typename === "ArtLayer") return docRef.layers[i];
      }
    }
    return null;
  }
  function removeNamedLayer(container, wantedName) {
    if (!wantedName) return;
    var existing = findLayerByName(container, wantedName);
    if (existing) {
      try { existing.remove(); } catch (_) {}
    }
  }
  function duplicateInto(target, layer) {
    var copied = null;
    // Prefer PLACEATBEGINNING — ElementPlacement.INSIDE after cross-doc duplicate hangs in Photopea.
    try { copied = layer.duplicate(target, ElementPlacement.PLACEATBEGINNING); } catch (_) { copied = null; }
    if (!copied) {
      try { copied = layer.duplicate(target, ElementPlacement.INSIDE); } catch (_) { copied = null; }
    }
    if (!copied) {
      try { copied = layer.duplicate(target); } catch (_) { copied = null; }
    }
    return copied;
  }
  function closePlaced() {
    if (!placedDocument) return;
    try { placedDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    placedDocument = null;
  }
  try {
    if (app.documents.length < 2) {
      throw new Error("Photopea did not open the rendered PNG as a new document.");
    }
    placedDocument = app.activeDocument;
    var sourceDocument = findSourceDocument(placedDocument);
    if (!sourceDocument) {
      sourceDocument = placedDocument;
      placedDocument = null;
      for (var d = 0; d < app.documents.length; d += 1) {
        var candidate = app.documents[d];
        if (candidate === sourceDocument) continue;
        if (data.sourceDocumentSource && documentSource(candidate) === data.sourceDocumentSource) continue;
        if (data.sourceDocumentName && String(candidate.name || "") === data.sourceDocumentName) continue;
        placedDocument = candidate;
        break;
      }
    }
    if (!placedDocument || placedDocument === sourceDocument) {
      throw new Error("Photopea did not open the rendered PNG as a new document.");
    }

    app.activeDocument = sourceDocument;
    var sourceLayer = findLayerById(sourceDocument, data.sourceLayerId);
    if (!sourceLayer) sourceLayer = findLayerByName(sourceDocument, data.sourceLayerName);
    if (!sourceLayer && data.originalLayerName) {
      sourceLayer = findLayerByName(sourceDocument, data.originalLayerName);
    }
    if (!sourceLayer) throw new Error("The original source layer could not be found.");

    // Keep pixels untouched; only append [Original] to the name.
    if (data.originalLayerName && sourceLayer.name !== data.originalLayerName) {
      try { sourceLayer.name = data.originalLayerName; } catch (_) {}
    }

    var group = findLayerSetByName(sourceDocument, data.groupName);
    if (!group) {
      group = sourceDocument.layerSets.add();
      group.name = data.groupName;
    }

    removeNamedLayer(group, data.resultName);
    if (data.previousResultName && data.previousResultName !== data.resultName) {
      removeNamedLayer(group, data.previousResultName);
    }

    app.activeDocument = placedDocument;
    var placedLayer = placedArtLayer(placedDocument);
    if (!placedLayer) throw new Error("The rendered output document has no layer to transfer.");

    // Duplicate straight into the group. Do NOT call Layer.move(..., INSIDE) afterward —
    // that call hangs in Photopea after a cross-document duplicate.
    var resultLayer = duplicateInto(group, placedLayer);
    if (!resultLayer) {
      try {
        placedDocument.selection.selectAll();
        placedDocument.selection.copy();
      } catch (copyError) {
        throw new Error(copyError && copyError.message ? copyError.message : "Could not copy the rendered output.");
      }
      closePlaced();
      app.activeDocument = sourceDocument;
      sourceDocument.paste();
      var pasted = sourceDocument.activeLayer;
      if (!pasted) throw new Error("Photopea did not paste the rendered output.");
      resultLayer = duplicateInto(group, pasted);
      if (resultLayer && resultLayer !== pasted) {
        try { pasted.remove(); } catch (_) {}
      } else {
        resultLayer = pasted;
      }
    } else {
      closePlaced();
      app.activeDocument = sourceDocument;
    }

    if (!resultLayer || resultLayer === sourceLayer) {
      throw new Error("Photopea did not insert the rendered output.");
    }

    try { resultLayer.name = data.resultName; } catch (_) {}
    resultLayer.visible = true;

    var dataLayer = findLayerByName(group, data.dataLayerName);
    if (!dataLayer) {
      dataLayer = sourceDocument.artLayers.add();
      try { dataLayer.kind = LayerKind.TEXT; } catch (_) {}
      dataLayer.name = data.dataLayerName;
      var nested = duplicateInto(group, dataLayer);
      if (nested && nested !== dataLayer) {
        try { dataLayer.remove(); } catch (_) {}
        dataLayer = nested;
        try { dataLayer.name = data.dataLayerName; } catch (_) {}
        try { dataLayer.kind = LayerKind.TEXT; } catch (_) {}
      }
    }
    var dataSaved = true;
    try {
      dataLayer.textItem.contents = dataPrefix + data.stateBase64;
      dataLayer.visible = false;
    } catch (_) {
      dataSaved = false;
      try { dataLayer.visible = false; } catch (_hide) {}
    }

    sourceLayer.visible = false;
    group.visible = true;
    try { sourceDocument.activeLayer = resultLayer; } catch (_) {}
    echo("output-result", {
      ok: true,
      dataSaved: dataSaved,
      projectId: data.projectId,
      groupName: data.groupName,
      resultName: data.resultName,
      originalLayerName: data.originalLayerName || sourceLayer.name
    });
  } catch (error) {
    closePlaced();
    echo("output-result", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

/** @deprecated Prefer createOutputFinalizeScript after posting the PNG as an ArrayBuffer. */
export function createOutputLayerScript(options) {
  return createOutputFinalizeScript(options);
}

/**
 * Upsert Mesh Data text layer in the UV Warp group without placing a warped PNG.
 * Does not rename the source or create a [Warped] layer.
 */
export function createSaveMeshScript({
  sourceLayerId,
  sourceLayerName,
  projectId,
  stateBase64,
  groupName,
  dataLayerName,
}) {
  const payload = JSON.stringify({
    sourceLayerId,
    sourceLayerName,
    projectId,
    stateBase64,
    groupName,
    dataLayerName,
  });

  return `
(function () {
  ${commonScriptHelpers()}
  var dataPrefix = ${JSON.stringify(DATA_PREFIX)};
  var data = ${payload};
  function duplicateInto(target, layer) {
    var copied = null;
    try { copied = layer.duplicate(target, ElementPlacement.PLACEATBEGINNING); } catch (_) { copied = null; }
    if (!copied) {
      try { copied = layer.duplicate(target, ElementPlacement.INSIDE); } catch (_) { copied = null; }
    }
    if (!copied) {
      try { copied = layer.duplicate(target); } catch (_) { copied = null; }
    }
    return copied;
  }
  try {
    if (!app.documents.length) throw new Error("Open a document before saving the mesh.");
    var sourceDocument = app.activeDocument;
    var sourceLayer = findLayerById(sourceDocument, data.sourceLayerId);
    if (!sourceLayer) sourceLayer = findLayerByName(sourceDocument, data.sourceLayerName);
    if (!sourceLayer) throw new Error("The source layer could not be found.");

    var group = findLayerSetByName(sourceDocument, data.groupName);
    if (!group) {
      group = sourceDocument.layerSets.add();
      group.name = data.groupName;
    }

    var dataLayer = findLayerByName(group, data.dataLayerName);
    if (!dataLayer) {
      dataLayer = sourceDocument.artLayers.add();
      try { dataLayer.kind = LayerKind.TEXT; } catch (_) {}
      dataLayer.name = data.dataLayerName;
      var nested = duplicateInto(group, dataLayer);
      if (nested && nested !== dataLayer) {
        try { dataLayer.remove(); } catch (_) {}
        dataLayer = nested;
        try { dataLayer.name = data.dataLayerName; } catch (_) {}
        try { dataLayer.kind = LayerKind.TEXT; } catch (_) {}
      }
    }
    var dataSaved = true;
    try {
      dataLayer.textItem.contents = dataPrefix + data.stateBase64;
      dataLayer.visible = false;
    } catch (_) {
      dataSaved = false;
      try { dataLayer.visible = false; } catch (_hide) {}
    }

    group.visible = true;
    try { sourceDocument.activeLayer = sourceLayer; } catch (_) {}
    echo("save-mesh-result", {
      ok: true,
      dataSaved: dataSaved,
      projectId: data.projectId,
      groupName: data.groupName
    });
  } catch (error) {
    echo("save-mesh-result", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

export function toggleSavedOutput({ groupName, sourceLayerId, sourceLayerName, originalLayerName = "" }) {
  const script = `
(function () {
  ${commonScriptHelpers()}
  try {
    if (!app.documents.length) throw new Error("Open the PSD containing the saved warp.");
    var documentRef = app.activeDocument;
    var group = findLayerSetByName(documentRef, ${JSON.stringify(groupName)});
    if (!group) throw new Error("The saved UV Warp group could not be found.");
    var source = findLayerById(documentRef, ${JSON.stringify(Number(sourceLayerId))});
    if (!source) source = findLayerByName(documentRef, ${JSON.stringify(sourceLayerName)});
    if (!source && ${JSON.stringify(originalLayerName || "")}) {
      source = findLayerByName(documentRef, ${JSON.stringify(originalLayerName || "")});
    }
    if (!source) throw new Error("The original source layer could not be found.");
    var showResult = !group.visible;
    group.visible = showResult;
    source.visible = !showResult;
    echo("toggle-result", { ok: true, visible: showResult });
  } catch (error) {
    echo("toggle-result", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;

  postPhotopeaScript(script);
}

export function parsePhotopeaMessage(data) {
  if (typeof data !== "string" || !data.startsWith(MESSAGE_PREFIX)) return null;
  try {
    return JSON.parse(data.slice(MESSAGE_PREFIX.length));
  } catch {
    return {
      type: "protocol-error",
      ok: false,
      message: "Photopea returned an unreadable response.",
    };
  }
}
