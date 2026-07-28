import test from "node:test";
import assert from "node:assert/strict";
import {
  computeIslands,
  facesInIslandOrder,
  raiseIslandInOrder,
  lowerIslandInOrder,
  resolveIslandOrder,
} from "../src/islands.js";

test("computeIslands finds two separate quads", () => {
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ];
  const vertices = [
    { x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.4 }, { x: 0, y: 0.4 },
    { x: 0.6, y: 0.6 }, { x: 1, y: 0.6 }, { x: 1, y: 1 }, { x: 0.6, y: 1 },
  ];
  const islands = computeIslands(faces, vertices);
  assert.equal(islands.length, 2);
  assert.notEqual(islands[0].id, islands[1].id);
});

test("shared edge merges faces into one island", () => {
  const faces = [
    [0, 1, 4, 3],
    [1, 2, 5, 4],
  ];
  const vertices = [
    { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 },
    { x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 },
  ];
  assert.equal(computeIslands(faces, vertices).length, 1);
});

test("resolveIslandOrder keeps known ids and appends new ones", () => {
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ];
  const vertices = [
    { x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.4 }, { x: 0, y: 0.4 },
    { x: 0.6, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0.6, y: 0.4 },
  ];
  const islands = computeIslands(faces, vertices);
  const first = islands[0].id;
  const second = islands[1].id;
  const order = resolveIslandOrder(islands, [second, "stale-id"]);
  assert.deepEqual(order[0], second);
  assert.ok(order.includes(first));
  assert.equal(order.includes("stale-id"), false);
});

test("raiseIslandInOrder moves an island toward the top", () => {
  assert.deepEqual(raiseIslandInOrder(["a", "b", "c"], "a"), ["b", "a", "c"]);
  assert.deepEqual(raiseIslandInOrder(["a", "b", "c"], "c"), ["a", "b", "c"]);
});

test("lowerIslandInOrder moves an island toward the bottom", () => {
  assert.deepEqual(lowerIslandInOrder(["a", "b", "c"], "c"), ["a", "c", "b"]);
  assert.deepEqual(lowerIslandInOrder(["a", "b", "c"], "a"), ["a", "b", "c"]);
});

test("facesInIslandOrder paints later islands last", () => {
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ];
  const vertices = [
    { x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.4 }, { x: 0, y: 0.4 },
    { x: 0.6, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0.6, y: 0.4 },
  ];
  const islands = computeIslands(faces, vertices);
  const order = [islands[1].id, islands[0].id];
  const ordered = facesInIslandOrder(faces, vertices, order);
  assert.equal(ordered.length, 2);
  assert.deepEqual(ordered[0], islands[1].faces[0]);
  assert.deepEqual(ordered[1], islands[0].faces[0]);
});
