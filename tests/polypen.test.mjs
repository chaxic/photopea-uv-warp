import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPenAction,
  bridgeEdges,
  deleteEdge,
  deleteFace,
  deleteVertex,
  edgeUsage,
  findFaceAtPoint,
  resolvePenAction,
  seedQuadMesh,
  snapToMesh,
  splitEdge,
  triangulateFaces,
  validateFaces,
  vertexUsage,
  verticesInRect,
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

test("pen connects a line from a selected vertex", () => {
  const vertices = [{ x: 0.2, y: 0.2 }];
  const action = resolvePenAction({
    selection: { vertices: [0], edge: null, face: null },
    clickPoint: { x: 0.5, y: 0.2 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.01,
  });
  assert.equal(action.type, "connect-line");
  const result = applyPenAction(action, vertices, [{ x: 0.2, y: 0.2 }], []);
  assert.equal(result.sourceVertices.length, 2);
  assert.deepEqual(result.selection.vertices, [1]);
  assert.equal(result.selection.edge, null);
  assert.ok(result.edges.some((edge) => edge[0] === 0 && edge[1] === 1));
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

test("clicking an edge with nothing selected inserts a point only", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const action = resolvePenAction({
    selection: { vertices: [], edge: null, face: null },
    clickPoint: { x: 0.5, y: 0.0 },
    sourceVertices: mesh.sourceVertices,
    faces: mesh.quads,
    edges: mesh.edges,
    insertMode: "tri-quad",
    snapThreshold: 0.05,
  });
  assert.equal(action.type, "split-edge");
  const result = applyPenAction(action, mesh.sourceVertices, mesh.warpVertices, mesh.quads, mesh.edges);
  assert.equal(result.sourceVertices.length, 5);
  assert.equal(result.selection.vertices.length, 1);
  assert.equal(result.faces.length, 1);
  assert.equal(result.faces[0].length, 5);
  validateFaces(result.sourceVertices, result.faces);
});

test("edge click with a selected point knife-connects", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const action = resolvePenAction({
    selection: { vertices: [3], edge: null, face: null },
    clickPoint: { x: 0.5, y: 0.0 },
    sourceVertices: mesh.sourceVertices,
    faces: mesh.quads,
    edges: mesh.edges,
    insertMode: "tri-quad",
    snapThreshold: 0.05,
  });
  assert.equal(action.type, "split-and-connect");
});

test("drawing a line that crosses an edge creates an intersection point", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 0.5, y: 1 },
    { x: 1, y: 1 },
  ];
  const faces = [
    [0, 1, 4, 3],
    [1, 2, 5, 4],
  ];
  const action = resolvePenAction({
    selection: { vertices: [0], edge: null, face: null },
    clickPoint: { x: 0.9, y: 0.9 },
    sourceVertices: vertices,
    faces,
    insertMode: "tri-quad",
    snapThreshold: 0.01,
  });
  assert.equal(action.type, "connect-line");
  const result = applyPenAction(action, vertices, clone(vertices), faces);
  assert.ok(result.sourceVertices.length > vertices.length, "expected an intersection vertex");
  validateFaces(result.sourceVertices, result.faces);
  assert.ok(result.edges.length >= 1);
});

test("knife cut across a quad yields two faces and cut edges without a spurious diagonal", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  // Cut from left mid to right mid through the face.
  const left = applyPenAction(
    { type: "split-edge", edge: [0, 3], point: { x: 0, y: 0.5 } },
    mesh.sourceVertices,
    mesh.warpVertices,
    mesh.quads,
    mesh.edges,
  );
  const leftMid = left.selection.vertices[0];
  const right = applyPenAction(
    { type: "split-edge", edge: [1, 2], point: { x: 1, y: 0.5 } },
    left.sourceVertices,
    left.warpVertices,
    left.faces,
    left.edges,
  );
  const rightMid = right.selection.vertices[0];
  const cut = applyPenAction(
    {
      type: "connect-line",
      from: leftMid,
      point: right.sourceVertices[rightMid],
      toExisting: rightMid,
    },
    right.sourceVertices,
    right.warpVertices,
    right.faces,
    right.edges,
  );
  assert.equal(cut.faces.length, 2);
  assert.ok(cut.edges.some((edge) => (edge[0] === leftMid && edge[1] === rightMid) || (edge[0] === rightMid && edge[1] === leftMid)));
  // No auto triangle fan diagonal from corner to opposite — only the cut chord between mids.
  const diagonalKeys = new Set(cut.edges.map((edge) => `${Math.min(edge[0], edge[1])}:${Math.max(edge[0], edge[1])}`));
  assert.equal(diagonalKeys.has("0:2"), false);
  assert.equal(diagonalKeys.has("1:3"), false);
  validateFaces(cut.sourceVertices, cut.faces);
});

test("splitEdge inserts a midpoint without auto-diagonals", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const split = splitEdge(
    mesh.sourceVertices,
    mesh.warpVertices,
    mesh.quads,
    [0, 1],
    null,
    mesh.edges,
  );
  assert.equal(split.sourceVertices.length, 5);
  assert.equal(split.faces.length, 1);
  assert.equal(split.faces[0].length, 5);
  validateFaces(split.sourceVertices, split.faces);
});

test("deleteEdge removes a line and keeps endpoints", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const next = deleteEdge(mesh.sourceVertices, mesh.warpVertices, mesh.quads, mesh.edges, [0, 1]);
  assert.equal(next.sourceVertices.length, 4);
  assert.equal(next.faces.length, 0);
  assert.equal(next.edges.some((edge) => edge[0] === 0 && edge[1] === 1), false);
});

test("deleteVertex removes faces that used it", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const next = deleteVertex(mesh.sourceVertices, mesh.warpVertices, mesh.quads, 0, mesh.edges);
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

test("clicking an existing point welds instead of adding a duplicate", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.25, y: 0.4 },
  ];
  const action = resolvePenAction({
    selection: { vertices: [0, 1], edge: [0, 1], face: null },
    clickPoint: { x: 0.252, y: 0.402 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.02,
  });
  assert.equal(action.type, "extrude-triangle");
  assert.equal(action.toExisting, 2);
  const result = applyPenAction(action, vertices, clone(vertices), []);
  assert.equal(result.sourceVertices.length, 3);
  assert.deepEqual(result.faces, [[0, 1, 2]]);
});

test("two selected points act as an edge for the next pen click", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
  ];
  const action = resolvePenAction({
    selection: { vertices: [0, 1], edge: null, face: null },
    clickPoint: { x: 0.25, y: 0.4 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.01,
  });
  assert.equal(action.type, "extrude-triangle");
  const result = applyPenAction(action, vertices, clone(vertices), []);
  assert.equal(result.faces.length, 1);
});

test("clicking a point of the active edge restarts from that point", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
  ];
  const action = resolvePenAction({
    selection: { vertices: [0, 1], edge: [0, 1], face: null },
    clickPoint: { x: 0.101, y: 0.101 },
    sourceVertices: vertices,
    faces: [],
    insertMode: "tri-quad",
    snapThreshold: 0.02,
  });
  assert.equal(action.type, "select-only");
  assert.equal(action.vertexIndex, 0);
});

test("selected point plus edge click splits and connects", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const action = resolvePenAction({
    selection: { vertices: [0], edge: null, face: null },
    clickPoint: { x: 1, y: 0.5 },
    sourceVertices: mesh.sourceVertices,
    faces: mesh.quads,
    insertMode: "tri-quad",
    snapThreshold: 0.05,
  });
  assert.equal(action.type, "split-and-connect");
  const result = applyPenAction(action, mesh.sourceVertices, mesh.warpVertices, mesh.quads);
  assert.ok(result.sourceVertices.length >= 5);
  assert.equal(result.selection.vertices.length, 1);
  validateFaces(result.sourceVertices, result.faces);
});

test("connection counts expose shared points and open edges", () => {
  const faces = [
    [0, 1, 2],
    [1, 3, 2],
  ];
  const usage = vertexUsage(faces, 5);
  assert.deepEqual(usage, [1, 2, 2, 1, 0]);
  const edges = edgeUsage(faces);
  assert.equal(edges.get("1:2"), 2);
  assert.equal(edges.get("0:1"), 1);
});

test("triangulateFaces keeps triangles and splits quads", () => {
  assert.deepEqual(triangulateFaces([[0, 1, 2]]), [[0, 1, 2]]);
  assert.deepEqual(triangulateFaces([[0, 1, 2, 3]]), [
    [0, 1, 2],
    [0, 2, 3],
  ]);
});

test("face mode seals a triangle when the third edge closes the loop", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.3, y: 0.5 },
  ];
  const edges = [
    [0, 1],
    [1, 2],
  ];
  const result = applyPenAction(
    { type: "connect-line", from: 2, point: vertices[0], toExisting: 0 },
    vertices,
    clone(vertices),
    [],
    edges,
    { faceMode: true },
  );
  assert.equal(result.faces.length, 1);
  assert.equal(result.faces[0].length, 3);
  assert.ok(result.selection.face);
});

test("line mode does not auto-create a face when a triangle closes", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.3, y: 0.5 },
  ];
  const edges = [
    [0, 1],
    [1, 2],
  ];
  const result = applyPenAction(
    { type: "connect-line", from: 2, point: vertices[0], toExisting: 0 },
    vertices,
    clone(vertices),
    [],
    edges,
    { faceMode: false },
  );
  assert.equal(result.faces.length, 0);
  assert.ok(result.edges.some((edge) => edge.includes(0) && edge.includes(2)));
});

test("deleteFace removes the face but keeps points and edges", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const next = deleteFace(mesh.sourceVertices, mesh.warpVertices, mesh.quads, mesh.edges, mesh.quads[0]);
  assert.equal(next.sourceVertices.length, 4);
  assert.equal(next.faces.length, 0);
  assert.ok(next.edges.length >= 4);
});

test("findFaceAtPoint hits the interior of a face", () => {
  const mesh = seedQuadMesh({ left: 0, top: 0, right: 1, bottom: 1 });
  const hit = findFaceAtPoint({ x: 0.5, y: 0.5 }, mesh.sourceVertices, mesh.quads);
  assert.ok(hit);
  assert.equal(hit.length, 4);
});

test("verticesInRect returns points inside a marquee", () => {
  const vertices = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.5, y: 0.5 },
  ];
  assert.deepEqual(verticesInRect(vertices, { x0: 0, y0: 0, x1: 0.6, y1: 0.6 }), [0, 2]);
});

function clone(points) {
  return points.map((point) => ({ ...point }));
}
