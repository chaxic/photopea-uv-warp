import test from "node:test";
import assert from "node:assert/strict";
import {
  makeCloseTemporaryScript,
  makePrepareCapturePngScript,
  makeSnapshotScript,
  parsePhotopeaMessage,
  postPhotopeaScript,
  readCaptureMeta,
  requestSelectedLayer,
  scanSavedWarps,
  toggleSavedOutput,
  createOutputFinalizeScript,
  createSaveMeshScript,
} from "../src/photopea.js";

function capturePostedScript(action) {
  let posted;
  globalThis.window = {
    parent: {
      postMessage(value) {
        posted = value;
      },
    },
  };
  action();
  assert.equal(typeof posted, "string");
  assert.doesNotThrow(() => new Function(posted));
  return posted;
}

test("every Photopea bridge action emits syntactically valid JavaScript", () => {
  const scripts = [
    capturePostedScript(() => requestSelectedLayer()),
    capturePostedScript(() =>
      readCaptureMeta({ sourceLayerId: 12, requestId: 99 }),
    ),
    makeSnapshotScript(),
    makePrepareCapturePngScript({
      mode: "backdrop",
      sourceLayerId: 12,
      hideGroupName: "UV Warp — Test",
      temporaryDocumentName: "__UV_WARP_CAPTURE__token-backdrop",
      sourceDocumentName: "Building.psd",
      sourceDocumentSource: "local,Building.psd",
    }),
    makePrepareCapturePngScript({
      mode: "source",
      sourceLayerId: 12,
      temporaryDocumentName: "__UV_WARP_CAPTURE__token-source",
      sourceDocumentName: "Building.psd",
      sourceDocumentSource: "local,Building.psd",
    }),
    makeCloseTemporaryScript({
      temporaryDocumentName: "__UV_WARP_CAPTURE__token-backdrop",
      sourceDocumentName: "Building.psd",
      sourceDocumentSource: "local,Building.psd",
    }),
    capturePostedScript(() => scanSavedWarps()),
    capturePostedScript(() =>
      toggleSavedOutput({
        groupName: "UV Warp — Test",
        sourceLayerId: 12,
        sourceLayerName: "Building",
      }),
    ),
    createOutputFinalizeScript({
      sourceLayerId: 12,
      sourceLayerName: "Building",
      originalLayerName: "Building [Original]",
      projectId: "uvwp-test",
      stateBase64: "e30=",
      groupName: "UV Warp — Test",
      resultName: "Building [Warped]",
      dataLayerName: "Mesh Data — do not edit [test]",
      sourceDocumentName: "Building.psd",
      sourceDocumentSource: "local,Building.psd",
    }),
    createSaveMeshScript({
      sourceLayerId: 12,
      sourceLayerName: "Building",
      projectId: "uvwp-test",
      stateBase64: "e30=",
      groupName: "UV Warp — Test",
      dataLayerName: "Mesh Data — do not edit [test]",
    }),
  ];

  scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
});

test("save mesh script writes data without placing a warped image", () => {
  const script = createSaveMeshScript({
    sourceLayerId: 12,
    sourceLayerName: "Building",
    projectId: "uvwp-test",
    stateBase64: "e30=",
    groupName: "UV Warp — Test",
    dataLayerName: "Mesh Data — do not edit [test]",
  });
  assert.doesNotMatch(script, /data:image\//);
  assert.doesNotMatch(script, /\[Warped\]/);
  assert.doesNotMatch(script, /\[Original\]/);
  assert.match(script, /save-mesh-result/);
  assert.match(script, /dataPrefix/);
});

test("output finalize script transfers a placed document without embedding a data URL", () => {
  const script = createOutputFinalizeScript({
    sourceLayerId: 12,
    sourceLayerName: "Building",
    originalLayerName: "Building [Original]",
    projectId: "uvwp-test",
    stateBase64: "e30=",
    groupName: "UV Warp — Test",
    resultName: "Building [Warped]",
    dataLayerName: "Mesh Data — do not edit [test]",
    sourceDocumentName: "Building.psd",
    sourceDocumentSource: "local,Building.psd",
  });
  assert.doesNotMatch(script, /data:image\//);
  assert.doesNotMatch(script, /app\.open\(/);
  assert.match(script, /\.duplicate\(/);
  assert.match(script, /PLACEATBEGINNING/);
  assert.match(script, /\[Original\]/);
  assert.match(script, /\[Warped\]/);
  assert.match(script, /output-result/);
  // Cross-document duplicate + move(INSIDE) hangs in Photopea; result must be duplicated into the group.
  assert.doesNotMatch(script, /resultLayer\.move\(\s*group\s*,\s*ElementPlacement\.INSIDE\s*\)/);
});

test("Photopea bridge messages decode only the UV Warp protocol", () => {
  assert.deepEqual(parsePhotopeaMessage('UVWP:{"type":"selection","ok":true}'), {
    type: "selection",
    ok: true,
  });
  assert.equal(parsePhotopeaMessage("done"), null);
});

test("capture meta script includes a request id for stale reply protection", () => {
  const script = capturePostedScript(() =>
    readCaptureMeta({ sourceLayerId: null, requestId: 42 }),
  );
  assert.match(script, /requestId:\s*42|requestId = 42/);
  assert.match(script, /capture-meta/);
});

test("snapshot script uses saveToOE psd without mutating the workfile", () => {
  const script = makeSnapshotScript();
  assert.match(script, /saveToOE\("psd"\)/);
  assert.doesNotMatch(script, /\.visible\s*=/);
  assert.doesNotMatch(script, /\.duplicate\(/);
});

test("prepare capture scripts isolate layers only in the temporary document", () => {
  const backdrop = makePrepareCapturePngScript({
    mode: "backdrop",
    sourceLayerId: 7,
    hideGroupName: "UV Warp — A",
    temporaryDocumentName: "__UV_WARP_CAPTURE__a-backdrop",
    sourceDocumentName: "Doc",
    sourceDocumentSource: "src",
  });
  const source = makePrepareCapturePngScript({
    mode: "source",
    sourceLayerId: 7,
    temporaryDocumentName: "__UV_WARP_CAPTURE__a-source",
    sourceDocumentName: "Doc",
    sourceDocumentSource: "src",
  });
  assert.match(backdrop, /temporaryDocument\.name = settings\.temporaryDocumentName/);
  assert.match(backdrop, /saveToOE\("png"\)/);
  assert.match(source, /hideEveryLayer\(temporaryDocument\)/);
  assert.doesNotMatch(backdrop, /\.duplicate\(/);
  assert.doesNotMatch(source, /\.duplicate\(/);
});

test("close temporary script restores the original workfile", () => {
  const script = makeCloseTemporaryScript({
    temporaryDocumentName: "__UV_WARP_CAPTURE__a-backdrop",
    sourceDocumentName: "Doc",
    sourceDocumentSource: "src",
  });
  assert.match(script, /DONOTSAVECHANGES/);
  assert.match(script, /capture-cleanup/);
  assert.match(script, /sourceDocumentRestored/);
});

test("postPhotopeaScript still posts to the parent frame", () => {
  let posted;
  globalThis.window = {
    parent: {
      postMessage(value) {
        posted = value;
      },
    },
  };
  postPhotopeaScript("app.echoToOE('x');");
  assert.equal(posted, "app.echoToOE('x');");
});
