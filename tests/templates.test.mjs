import test from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_SCHEMA,
  createMemoryStorage,
  fitMeshToBounds,
  importTemplates,
  listTemplates,
  meshToTemplate,
  parseTemplateFile,
  serializeTemplate,
  upsertTemplate,
} from "../src/templates.js";

const sampleMesh = {
  name: "Sample",
  warpLinked: false,
  sourceVertices: [
    { x: 0.1, y: 0.2 },
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.6 },
    { x: 0.1, y: 0.6 },
  ],
  warpVertices: [
    { x: 0.15, y: 0.25 },
    { x: 0.55, y: 0.25 },
    { x: 0.55, y: 0.65 },
    { x: 0.15, y: 0.65 },
  ],
  quads: [[0, 1, 2, 3]],
  edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
  islandOrder: [],
};

test("fitMeshToBounds maps layout AABB to target bounds", () => {
  const fitted = fitMeshToBounds(sampleMesh, {
    left: 0.2,
    top: 0.1,
    right: 0.8,
    bottom: 0.9,
  });
  assert.equal(fitted.sourceVertices[0].x, 0.2);
  assert.equal(fitted.sourceVertices[0].y, 0.1);
  assert.equal(fitted.sourceVertices[2].x, 0.8);
  assert.equal(fitted.sourceVertices[2].y, 0.9);
});

test("fitMeshToBounds applies the same transform to warp vertices", () => {
  const fitted = fitMeshToBounds(sampleMesh, {
    left: 0,
    top: 0,
    right: 1,
    bottom: 1,
  });
  // Layout [0.1,0.2]→[0,0]; warp was offset +0.05,+0.05 in source space → same relative after map
  const sx = (0.15 - 0.1) / 0.4;
  const sy = (0.25 - 0.2) / 0.4;
  assert.ok(Math.abs(fitted.warpVertices[0].x - sx) < 1e-9);
  assert.ok(Math.abs(fitted.warpVertices[0].y - sy) < 1e-9);
  assert.deepEqual(fitted.quads, [[0, 1, 2, 3]]);
});

test("serialize and parse round-trip a single template", () => {
  const template = meshToTemplate(sampleMesh, "Roof");
  const json = serializeTemplate(template);
  const [parsed] = parseTemplateFile(json);
  assert.equal(parsed.schema, TEMPLATE_SCHEMA);
  assert.equal(parsed.name, "Roof");
  assert.equal(parsed.mesh.sourceVertices.length, 4);
  assert.deepEqual(parsed.mesh.quads, [[0, 1, 2, 3]]);
});

test("parseTemplateFile rejects garbage", () => {
  assert.throws(() => parseTemplateFile("{}"), /Unrecognized template JSON/);
  assert.throws(() => parseTemplateFile('{"schema":"NOPE"}'), /Unrecognized template JSON/);
});

test("library upsert and import use injectable storage", () => {
  const storage = createMemoryStorage();
  const a = upsertTemplate(meshToTemplate(sampleMesh, "A", { id: "id-a" }), storage);
  const b = upsertTemplate(meshToTemplate(sampleMesh, "B", { id: "id-b" }), storage);
  assert.equal(listTemplates(storage).length, 2);
  const imported = importTemplates([a], storage);
  assert.equal(listTemplates(storage).length, 3);
  assert.notEqual(imported[0].id, a.id);
  assert.equal(b.name, "B");
});
