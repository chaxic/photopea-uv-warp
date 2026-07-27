import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBuildingMesh,
  buildGridMesh,
  mapMeshToRect,
  validateMesh,
  validateProjectMesh,
} from "../src/mesh.js";

test("a 3 × 2 grid has the expected topology", () => {
  const mesh = buildGridMesh(3, 2, 0);
  assert.equal(mesh.vertices.length, 12);
  assert.equal(mesh.quads.length, 6);
  assert.equal(validateMesh(mesh), true);
});

test("grid values are clamped to supported density", () => {
  const mesh = buildGridMesh(50, -2, 0);
  assert.equal(mesh.vertices.length, 22);
  assert.equal(mesh.quads.length, 10);
});

test("the simple building preset contains three connected faces", () => {
  const mesh = buildBuildingMesh(1, "right", 0);
  assert.equal(mesh.vertices.length, 7);
  assert.equal(mesh.quads.length, 3);
  assert.equal(validateMesh(mesh), true);
});

test("building subdivision creates three times divisions squared quads", () => {
  for (const divisions of [1, 2, 3, 4]) {
    const mesh = buildBuildingMesh(divisions, "right", 2);
    assert.equal(mesh.quads.length, 3 * divisions * divisions);
    assert.equal(validateMesh(mesh), true);
  }
});

test("left-facing building mirrors x coordinates and remains valid", () => {
  const right = buildBuildingMesh(2, "right", 0);
  const left = buildBuildingMesh(2, "left", 0);
  assert.equal(left.vertices.length, right.vertices.length);
  assert.equal(left.quads.length, right.quads.length);
  assert.equal(left.vertices[0].x, 1 - right.vertices[0].x);
  assert.equal(validateMesh(left), true);
});

test("boundary inset keeps every point inside the requested margin", () => {
  const mesh = buildGridMesh(4, 4, 10);
  for (const point of mesh.vertices) {
    assert.ok(point.x >= 0.1 && point.x <= 0.9);
    assert.ok(point.y >= 0.1 && point.y <= 0.9);
  }
});

test("a local mesh maps into normalized document bounds", () => {
  const local = buildGridMesh(1, 1, 0);
  const mapped = mapMeshToRect(local, {
    left: 0.2,
    top: 0.25,
    right: 0.7,
    bottom: 0.8,
  });
  assert.deepEqual(mapped.vertices[0], { x: 0.2, y: 0.25 });
  assert.deepEqual(mapped.vertices[3], { x: 0.7, y: 0.8 });
});

test("saved source and warp vertices must remain paired", () => {
  const mesh = buildGridMesh(2, 2, 0);
  assert.equal(
    validateProjectMesh({
      sourceVertices: mesh.vertices,
      warpVertices: mesh.vertices.map((point) => ({ ...point })),
      quads: mesh.quads,
    }),
    true,
  );
});
