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

export function createOutputLayerScript({
  dataUrl,
  sourceLayerId,
  sourceLayerName,
  projectId,
  stateBase64,
  groupName,
  resultName,
  dataLayerName,
}) {
  const payload = JSON.stringify({
    dataUrl,
    sourceLayerId,
    sourceLayerName,
    projectId,
    stateBase64,
    groupName,
    resultName,
    dataLayerName,
  });

  return `
(function () {
  ${commonScriptHelpers()}
  var dataPrefix = ${JSON.stringify(DATA_PREFIX)};
  var data = ${payload};
  try {
    if (!app.documents.length) throw new Error("The source document is no longer open.");
    var documentRef = app.activeDocument;
    var sourceLayer = findLayerById(documentRef, data.sourceLayerId);
    if (!sourceLayer) sourceLayer = findLayerByName(documentRef, data.sourceLayerName);
    if (!sourceLayer) throw new Error("The original source layer could not be found.");

    documentRef.activeLayer = sourceLayer;
    app.open(data.dataUrl, null, true);
    var resultLayer = documentRef.activeLayer;
    if (!resultLayer || resultLayer === sourceLayer) {
      throw new Error("Photopea did not insert the rendered output.");
    }

    var group = findLayerSetByName(documentRef, data.groupName);
    if (!group) {
      group = documentRef.layerSets.add();
      group.name = data.groupName;
    }

    var previousResult = findLayerByName(group, data.resultName);
    if (previousResult && previousResult !== resultLayer) previousResult.remove();

    resultLayer.name = data.resultName;
    resultLayer.move(group, ElementPlacement.INSIDE);
    resultLayer.visible = true;

    var dataLayer = findLayerByName(group, data.dataLayerName);
    if (!dataLayer) {
      dataLayer = documentRef.artLayers.add();
      dataLayer.kind = LayerKind.TEXT;
      dataLayer.name = data.dataLayerName;
      dataLayer.move(group, ElementPlacement.INSIDE);
    }
    dataLayer.textItem.contents = dataPrefix + data.stateBase64;
    dataLayer.visible = false;

    sourceLayer.visible = false;
    group.visible = true;
    documentRef.activeLayer = resultLayer;
    echo("output-result", {
      ok: true,
      projectId: data.projectId,
      groupName: data.groupName,
      resultName: data.resultName
    });
  } catch (error) {
    echo("output-result", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;
}

export function toggleSavedOutput({ groupName, sourceLayerId, sourceLayerName }) {
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
