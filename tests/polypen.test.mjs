import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPenAction,
  bridgeEdges,
  deleteVertex,
  resolvePenAction,
  seedQuadMesh,
  snapToMesh,
  splitEdge,
  triangulateFaces,
  validateFaces,
} from "../src/polypen.js";

test("seed quad covers the source bounds", () => {
  const mesh = seedQuadMesh({ left: 0.1, top: 0.2, right: 0.5, bottom: 0.8 });
  assert.equal(mesh.quads.length, 1);
  assert.equal(mesh.sourceVertices.length, 4);
  assert.deepEqual(mesh.sourceVertices[0], { x: 0.1, y: 0.2 });
  assert.deepEqual(mesh.sourceVertices[2], { x: 0.5, y: 0.8 });
});

test("pen with nothing selected adds a vertex", () => {
  const action = resolvePenAction({
    selection: { vertices: [], edge: null, face: null },
    clickPoint: { x: 0.4, y: 0.4 },
    sourceVertices: [],
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.02,
  });
  assert.equal(action.type, "add-vertex");
  const result = applyPenAction(action, [], [], []);
  assert.equal(result.sourceVertices.length, 1);
  assert.deepEqual(result.selection.vertices, [0]);
});

test("pen extrudes an edge from a selected vertex", () => {
  const vertices = [{ x: 0.2, y: 0.2 }];
  const action = resolvePenAction({
    selection: { vertices: [0], edge: null, face: null },
    clickPoint: { x: 0.5, y: 0.2 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.01,
  });
  assert.equal(action.type, "extrude-edge");
  const result = applyPenAction(action, vertices, [{ x: 0.2, y: 0.2 }], []);
  assert.equal(result.sourceVertices.length, 2);
  assert.deepEqual(result.selection.edge, [0, 1]);
});

test("pen extrudes a triangle from a selected edge", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
  ];
  const action = resolvePenAction({
    selection: { vertices: [0, 1], edge: [0, 1], face: null },
    clickPoint: { x: 0.25, y: 0.4 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.01,
  });
  assert.equal(action.type, "extrude-triangle");
  const result = applyPenAction(action, vertices, clone(vertices), []);
  assert.equal(result.faces.length, 1);
  assert.equal(result.faces[0].length, 3);
});

test("pen completes a triangle into a quad", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.25, y: 0.4 },
  ];
  const face = [0, 1, 2];
  const action = resolvePenAction({
    selection: { vertices: face, edge: null, face },
    clickPoint: { x: 0.55, y: 0.35 },
    sourceVertices: vertices,
    faces: [face],
    insertMode: "tri-quad",
    snapThreshold: 0.01,
  });
  assert.equal(action.type, "complete-quad");
  const result = applyPenAction(action, vertices, clone(vertices), [face]);
  assert.equal(result.faces.length, 1);
  assert.equal(result.faces[0].length, 4);
});

test("pen bridges two edges into a quad", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.3, y: 0.1 },
    { x: 0.1, y: 0.4 },
    { x: 0.3, y: 0.4 },
  ];
  const bridged = bridgeEdges(vertices, clone(vertices), [], [0, 1], [2, 3]);
  assert.equal(bridged.faces.length, 1);
  assert.equal(bridged.faces[0].length, 4);
  validateFaces(bridged.sourceVertices, bridged.faces);
});

test("resolvePenAction bridges when clicking a second edge", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.1, y: 0.5 },
    { x: 0.4, y: 0.5 },
  ];
  const action = resolvePenAction({
    selection: { vertices: [0, 1], edge: [0, 1], face: null },
    clickPoint: { x: 0.25, y: 0.5 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.05,
  });
  assert.equal(action.type, "bridge");
  const result = applyPenAction(action, vertices, clone(vertices), []);
  assert.equal(result.faces.length, 1);
});

test("splitEdge inserts a midpoint and splits adjacent faces", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const split = splitEdge(
    mesh.sourceVertices,
    mesh.warpVertices,
    mesh.quads,
    [0, 1],
  );
  assert.equal(split.sourceVertices.length, 5);
  assert.ok(split.faces.length >= 2);
  validateFaces(split.sourceVertices, split.faces);
});

test("deleteVertex removes faces that used it", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const next = deleteVertex(mesh.sourceVertices, mesh.warpVertices, mesh.quads, 0);
  assert.equal(next.sourceVertices.length, 3);
  assert.equal(next.faces.length, 0);
});

test("snapToMesh prefers nearby vertices", () => {
  const vertices = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.8 },
  ];
  const snap = snapToMesh({ x: 0.21, y: 0.19 }, vertices, [], 0.05);
  assert.equal(snap.kind, "vertex");
  assert.equal(snap.index, 0);
});

test("triangulateFaces keeps triangles and splits quads", () => {
  assert.deepEqual(triangulateFaces([[0, 1, 2]]), [[0, 1, 2]]);
  assert.deepEqual(triangulateFaces([[0, 1, 2, 3]]), [
    [0, 1, 2],
    [0, 2, 3],
  ]);
});

function clone(points) {
  return points.map((point) => ({ ...point }));
}
