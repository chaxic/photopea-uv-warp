import test from "node:test";
import assert from "node:assert/strict";
import {
  meshWarnings,
  solveAffineTransform,
  triangleArea,
  triangulateQuads,
} from "../src/warp.js";

function apply(transform, point) {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

test("affine transform maps all three source corners to their targets", () => {
  const source = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 3 },
  ];
  const target = [
    { x: 10, y: 20 },
    { x: 18, y: 22 },
    { x: 8, y: 29 },
  ];
  const transform = solveAffineTransform(source, target);
  source.forEach((point, index) => {
    const mapped = apply(transform, point);
    assert.ok(Math.abs(mapped.x - target[index].x) < 1e-9);
    assert.ok(Math.abs(mapped.y - target[index].y) < 1e-9);
  });
});

test("a quadrilateral is rendered as two connected triangles", () => {
  assert.deepEqual(triangulateQuads([[0, 1, 2, 3]]), [
    [0, 1, 2],
    [0, 2, 3],
  ]);
});

test("triangle area reports orientation and collapsed triangles", () => {
  assert.ok(triangleArea({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) > 0);
  assert.ok(triangleArea({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }) < 0);
  assert.equal(triangleArea({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), 0);
});

test("mesh warnings identify flipped and collapsed output triangles", () => {
  const source = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.deepEqual(meshWarnings(source, source, [[0, 1, 2, 3]]), {
    degenerate: 0,
    flipped: 0,
  });
  const flipped = source.map((point) => ({ x: 1 - point.x, y: point.y }));
  assert.equal(meshWarnings(source, flipped, [[0, 1, 2, 3]]).flipped, 2);
});
