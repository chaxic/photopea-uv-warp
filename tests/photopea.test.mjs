import test from "node:test";
import assert from "node:assert/strict";
import {
  captureSource,
  createOutputLayerScript,
  parsePhotopeaMessage,
  requestSelectedLayer,
  scanSavedWarps,
  toggleSavedOutput,
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
      captureSource({ sourceLayerId: 12, hideGroupName: "UV Warp — Test" }),
    ),
    capturePostedScript(() => scanSavedWarps()),
    capturePostedScript(() =>
      toggleSavedOutput({
        groupName: "UV Warp — Test",
        sourceLayerId: 12,
        sourceLayerName: "Building",
      }),
    ),
    createOutputLayerScript({
      dataUrl: "data:image/png;base64,AA==",
      sourceLayerId: 12,
      sourceLayerName: "Building",
      projectId: "uvwp-test",
      stateBase64: "e30=",
      groupName: "UV Warp — Test",
      resultName: "UV Warp Result [test]",
      dataLayerName: "UV Warp Data [test]",
    }),
  ];

  scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
});

test("Photopea bridge messages decode only the UV Warp protocol", () => {
  assert.deepEqual(parsePhotopeaMessage('UVWP:{"type":"selection","ok":true}'), {
    type: "selection",
    ok: true,
  });
  assert.equal(parsePhotopeaMessage("done"), null);
});
