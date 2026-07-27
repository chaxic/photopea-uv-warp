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

export function captureSource({
  sourceLayerId = null,
  hideGroupName = "",
} = {}) {
  const script = `
(function () {
  ${commonScriptHelpers()}
  var sourceDocument = null;
  var captureDocument = null;
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
  try {
    if (!app.documents.length) throw new Error("Open a document first.");
    sourceDocument = app.activeDocument;
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

    captureDocument = sourceDocument.duplicate("__UV Warp Capture__", false);
    var captureLayer = findLayerById(captureDocument, layerId(sourceLayer));
    if (!captureLayer) captureLayer = captureDocument.activeLayer;

    var groupToHide = findLayerSetByName(
      captureDocument,
      ${JSON.stringify(hideGroupName || "")}
    );
    if (groupToHide) groupToHide.visible = false;
    captureLayer.visible = false;
    captureDocument.saveToOE("png");

    hideEveryLayer(captureDocument);
    revealWithParents(captureLayer, captureDocument);
    captureDocument.saveToOE("png");

    captureDocument.close(SaveOptions.DONOTSAVECHANGES);
    captureDocument = null;
    app.activeDocument = sourceDocument;
    echo("capture-complete", { ok: true });
  } catch (error) {
    try {
      if (captureDocument) captureDocument.close(SaveOptions.DONOTSAVECHANGES);
      if (sourceDocument) app.activeDocument = sourceDocument;
    } catch (_) {}
    echo("capture-complete", {
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}());`;

  postPhotopeaScript(script);
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
