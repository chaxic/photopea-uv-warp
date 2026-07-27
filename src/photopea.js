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
 * via postMessage(ArrayBuffer). Embedding a multi-megabyte data URL inside a
 * single script hangs Photopea; binary open + a small follow-up script is reliable.
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
  function documentSource(documentRef) {
    try { return String(documentRef.source || ""); } catch (_) { return ""; }
  }
  function findSourceDocument(placedDocument) {
    if (!app.documents) return null;
    if (data.sourceDocumentSource) {
      for (var i = 0; i < app.documents.length; i += 1) {
        var bySource = app.documents[i];
        if (bySource !== placedDocument && documentSource(bySource) === data.sourceDocumentSource) {
          return bySource;
        }
      }
    }
    if (data.sourceDocumentName) {
      for (var j = 0; j < app.documents.length; j += 1) {
        var byName = app.documents[j];
        if (byName !== placedDocument && String(byName.name || "") === data.sourceDocumentName) {
          return byName;
        }
      }
    }
    return null;
  }
  function transferPlacedLayer(placedDocument, sourceDocument) {
    app.activeDocument = placedDocument;
    var placedLayer = placedDocument.activeLayer;
    if (!placedLayer && placedDocument.artLayers && placedDocument.artLayers.length) {
      placedLayer = placedDocument.artLayers[0];
    }
    if (!placedLayer) throw new Error("The rendered output document has no layer to transfer.");
    var resultLayer = null;
    try {
      resultLayer = placedLayer.duplicate(sourceDocument, ElementPlacement.PLACEATBEGINNING);
    } catch (_) {
      resultLayer = null;
    }
    if (!resultLayer) {
      try {
        placedDocument.selection.selectAll();
        placedDocument.selection.copy();
      } catch (copyError) {
        throw new Error(copyError && copyError.message ? copyError.message : "Could not copy the rendered output.");
      }
      placedDocument.close(SaveOptions.DONOTSAVECHANGES);
      app.activeDocument = sourceDocument;
      sourceDocument.paste();
      return sourceDocument.activeLayer;
    }
    placedDocument.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = sourceDocument;
    return resultLayer;
  }
  try {
    if (app.documents.length < 2) {
      throw new Error("Photopea did not open the rendered PNG as a new document.");
    }
    var placedDocument = app.activeDocument;
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

    var sourceLayer = findLayerById(sourceDocument, data.sourceLayerId);
    if (!sourceLayer) sourceLayer = findLayerByName(sourceDocument, data.sourceLayerName);
    if (!sourceLayer && data.originalLayerName) {
      sourceLayer = findLayerByName(sourceDocument, data.originalLayerName);
    }
    if (!sourceLayer) throw new Error("The original source layer could not be found.");

    var resultLayer = transferPlacedLayer(placedDocument, sourceDocument);
    if (!resultLayer || resultLayer === sourceLayer) {
      throw new Error("Photopea did not insert the rendered output.");
    }

    // Keep the layer's pixels untouched; only append [Original] to its name.
    if (data.originalLayerName && sourceLayer.name !== data.originalLayerName) {
      try { sourceLayer.name = data.originalLayerName; } catch (_) {}
    }

    var group = findLayerSetByName(sourceDocument, data.groupName);
    if (!group) {
      group = sourceDocument.layerSets.add();
      group.name = data.groupName;
    }

    var previousNames = [data.resultName];
    if (data.previousResultName) previousNames.push(data.previousResultName);
    for (var p = 0; p < previousNames.length; p += 1) {
      var previousResult = findLayerByName(group, previousNames[p]);
      if (previousResult && previousResult !== resultLayer) previousResult.remove();
    }

    resultLayer.name = data.resultName;
    resultLayer.move(group, ElementPlacement.INSIDE);
    resultLayer.visible = true;

    var dataLayer = findLayerByName(group, data.dataLayerName);
    if (!dataLayer) {
      dataLayer = sourceDocument.artLayers.add();
      dataLayer.kind = LayerKind.TEXT;
      dataLayer.name = data.dataLayerName;
      dataLayer.move(group, ElementPlacement.INSIDE);
    }
    dataLayer.textItem.contents = dataPrefix + data.stateBase64;
    dataLayer.visible = false;

    sourceLayer.visible = false;
    group.visible = true;
    sourceDocument.activeLayer = resultLayer;
    echo("output-result", {
      ok: true,
      projectId: data.projectId,
      groupName: data.groupName,
      resultName: data.resultName,
      originalLayerName: data.originalLayerName || sourceLayer.name
    });
  } catch (error) {
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
