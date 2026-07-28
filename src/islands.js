import { edgeKey, edgeUsage, faceKey, findFaceAtPoint, facesEqual } from "./polypen.js";

/**
 * Connected components of faces that share undirected edges (usage >= 2).
 * Knife-only edges without faces do not merge islands.
 */
export function computeIslands(faces, vertices = null) {
  if (!Array.isArray(faces) || !faces.length) return [];

  const usage = edgeUsage(faces);
  const adjacency = faces.map(() => []);
  const edgeToFaces = new Map();

  faces.forEach((face, faceIndex) => {
    for (let i = 0; i < face.length; i += 1) {
      const key = edgeKey(face[i], face[(i + 1) % face.length]);
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key).push(faceIndex);
    }
  });

  for (const [key, owners] of edgeToFaces) {
    if ((usage.get(key) || 0) < 2) continue;
    for (let i = 0; i < owners.length; i += 1) {
      for (let j = i + 1; j < owners.length; j += 1) {
        adjacency[owners[i]].push(owners[j]);
        adjacency[owners[j]].push(owners[i]);
      }
    }
  }

  const visited = new Array(faces.length).fill(false);
  const islands = [];

  for (let start = 0; start < faces.length; start += 1) {
    if (visited[start]) continue;
    const stack = [start];
    visited[start] = true;
    const memberIndexes = [];
    while (stack.length) {
      const index = stack.pop();
      memberIndexes.push(index);
      for (const next of adjacency[index]) {
        if (visited[next]) continue;
        visited[next] = true;
        stack.push(next);
      }
    }

    const islandFaces = memberIndexes.map((index) => [...faces[index]]);
    const vertexSet = new Set();
    for (const face of islandFaces) {
      for (const index of face) vertexSet.add(index);
    }
    const verts = [...vertexSet].sort((a, b) => a - b);
    const id = islandFaces
      .map((face) => faceKey(face))
      .sort()
      .join("|");

    let centroid = { x: 0.5, y: 0.5 };
    if (vertices && verts.length) {
      let sx = 0;
      let sy = 0;
      for (const index of verts) {
        sx += vertices[index].x;
        sy += vertices[index].y;
      }
      centroid = { x: sx / verts.length, y: sy / verts.length };
    }

    islands.push({
      id,
      faces: islandFaces,
      faceIndexes: memberIndexes.sort((a, b) => a - b),
      vertices: verts,
      centroid,
    });
  }

  return islands;
}

/** Keep known order, drop stale ids, append new islands sorted by centroid. */
export function resolveIslandOrder(islands, islandOrder = []) {
  const byId = new Map(islands.map((island) => [island.id, island]));
  const ordered = [];
  const seen = new Set();
  for (const id of islandOrder || []) {
    if (!byId.has(id) || seen.has(id)) continue;
    ordered.push(id);
    seen.add(id);
  }
  const missing = islands
    .filter((island) => !seen.has(island.id))
    .sort((a, b) => a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x || a.id.localeCompare(b.id));
  for (const island of missing) ordered.push(island.id);
  return ordered;
}

export function orderedIslands(islands, islandOrder) {
  const order = resolveIslandOrder(islands, islandOrder);
  const byId = new Map(islands.map((island) => [island.id, island]));
  return order.map((id) => byId.get(id)).filter(Boolean);
}

/** Faces sorted so later islands paint on top (warp depth). */
export function facesInIslandOrder(faces, vertices, islandOrder = []) {
  if (!faces.length) return [];
  const islands = computeIslands(faces, vertices);
  const ordered = orderedIslands(islands, islandOrder);
  const result = [];
  for (const island of ordered) {
    for (const face of island.faces) result.push([...face]);
  }
  return result;
}

export function islandAtPoint(point, faces, vertices, islandOrder = []) {
  const face = findFaceAtPoint(point, vertices, faces);
  if (!face) return null;
  const islands = orderedIslands(computeIslands(faces, vertices), islandOrder);
  return islands.find((island) => island.faces.some((entry) => facesEqual(entry, face))) || null;
}

export function islandContainingSelection({ points = [], edge = null, face = null, islandId = null }, faces, vertices, islandOrder = []) {
  const islands = orderedIslands(computeIslands(faces, vertices), islandOrder);
  if (islandId) {
    const match = islands.find((island) => island.id === islandId);
    if (match) return match;
  }
  if (face) {
    const match = islands.find((island) => island.faces.some((entry) => facesEqual(entry, face)));
    if (match) return match;
  }
  if (edge) {
    const match = islands.find((island) => edge.every((index) => island.vertices.includes(index)));
    if (match) return match;
  }
  if (points.length) {
    const match = islands.find((island) => points.every((index) => island.vertices.includes(index)));
    if (match) return match;
  }
  return null;
}

/** Move islandId one step later (toward top / higher depth). Clamped at end. */
export function raiseIslandInOrder(islandOrder, islandId) {
  const order = [...islandOrder];
  const index = order.indexOf(islandId);
  if (index < 0 || index >= order.length - 1) return order;
  const next = order[index + 1];
  order[index + 1] = order[index];
  order[index] = next;
  return order;
}

/** Move islandId one step earlier (toward bottom / lower depth). Clamped at start. */
export function lowerIslandInOrder(islandOrder, islandId) {
  const order = [...islandOrder];
  const index = order.indexOf(islandId);
  if (index <= 0) return order;
  const prev = order[index - 1];
  order[index - 1] = order[index];
  order[index] = prev;
  return order;
}

export function islandHue(index, total) {
  const t = total > 0 ? index / Math.max(total, 1) : 0;
  return Math.round(28 + t * 300);
}
