/**
 * Contextual mesh creation for 2D UV layout.
 * Builds triangles and quads by extruding edges and bridging gaps.
 */

const EPSILON = 1e-8;

export function cloneFace(face) {
  return [...face];
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function clampPoint(point) {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}

/** Collect undirected edges from faces (3 or 4 verts). */
export function collectEdges(faces) {
  const edges = [];
  const seen = new Set();
  for (const face of faces) {
    const count = face.length;
    for (let i = 0; i < count; i += 1) {
      const a = face[i];
      const b = face[(i + 1) % count];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return edges;
}

export function facesUsingVertex(faces, vertexIndex) {
  return faces.filter((face) => face.includes(vertexIndex));
}

export function facesUsingEdge(faces, edge) {
  const [a, b] = edge;
  return faces.filter((face) => {
    const count = face.length;
    for (let i = 0; i < count; i += 1) {
      const u = face[i];
      const v = face[(i + 1) % count];
      if ((u === a && v === b) || (u === b && v === a)) return true;
    }
    return false;
  });
}

export function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function normalizeEdgeList(edges = []) {
  const unique = [];
  const seen = new Set();
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) continue;
    const a = edge[0];
    const b = edge[1];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) continue;
    const key = edgeKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a < b ? [a, b] : [b, a]);
  }
  return unique;
}

export function hasEdge(edges, a, b) {
  const key = edgeKey(a, b);
  return edges.some((edge) => edgeKey(edge[0], edge[1]) === key);
}

export function addEdge(edges, a, b) {
  if (a === b) return edges;
  if (hasEdge(edges, a, b)) return edges;
  return [...edges, a < b ? [a, b] : [b, a]];
}

export function removeEdgeFromList(edges, a, b) {
  const key = edgeKey(a, b);
  return edges.filter((edge) => edgeKey(edge[0], edge[1]) !== key);
}

/** Prefer stored drawable edges; fall back to face boundaries. */
export function ensureEdges(faces, edges) {
  if (Array.isArray(edges) && edges.length > 0) return normalizeEdgeList(edges);
  return collectEdges(faces);
}

/** Union of face boundaries and stored edges for hit-testing. */
export function drawableEdges(faces, edges) {
  return normalizeEdgeList([...collectEdges(faces), ...(edges || [])]);
}

export function edgesFromFace(face) {
  const result = [];
  for (let i = 0; i < face.length; i += 1) {
    result.push([face[i], face[(i + 1) % face.length]]);
  }
  return result;
}

export function remapEdges(edges, vertexIndex) {
  return normalizeEdgeList(
    edges
      .filter((edge) => !edge.includes(vertexIndex))
      .map((edge) => edge.map((index) => (index > vertexIndex ? index - 1 : index))),
  );
}

/** How many faces use each undirected edge. Count 1 means an open boundary. */
export function edgeUsage(faces) {
  const usage = new Map();
  for (const face of faces) {
    const count = face.length;
    for (let i = 0; i < count; i += 1) {
      const key = edgeKey(face[i], face[(i + 1) % count]);
      usage.set(key, (usage.get(key) || 0) + 1);
    }
  }
  return usage;
}

/** How many faces use each vertex index. Count 0 means a loose point. */
export function vertexUsage(faces, vertexCount) {
  const usage = new Array(vertexCount).fill(0);
  for (const face of faces) {
    for (const index of face) {
      if (index >= 0 && index < vertexCount) usage[index] += 1;
    }
  }
  return usage;
}

function pointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < EPSILON) return { t: 0, point: { ...a }, distance: distance(point, a) };
  const t = Math.min(
    1,
    Math.max(0, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq),
  );
  const projected = { x: a.x + abx * t, y: a.y + aby * t };
  return { t, point: projected, distance: distance(point, projected) };
}

/**
 * Snap a document-space point to nearby vertices or edges.
 * @returns {{ kind: 'vertex'|'edge'|'none', index?: number, edge?: number[], point: {x,y}, distance: number }}
 */
export function snapToMesh(point, vertices, faces, threshold, edges = null) {
  let best = { kind: "none", point: { ...point }, distance: Infinity };

  vertices.forEach((vertex, index) => {
    const d = distance(point, vertex);
    if (d < best.distance) {
      best = { kind: "vertex", index, point: { ...vertex }, distance: d };
    }
  });

  // A vertex inside the snap radius always wins, even when an edge passes closer.
  // Welding to an existing point matters more than splitting the edge under it.
  if (best.kind === "vertex" && best.distance <= threshold) return best;

  for (const edge of drawableEdges(faces, edges)) {
    const a = vertices[edge[0]];
    const b = vertices[edge[1]];
    const projected = pointOnSegment(point, a, b);
    if (projected.distance < best.distance) {
      best = {
        kind: "edge",
        edge: [...edge],
        point: projected.point,
        t: projected.t,
        distance: projected.distance,
      };
    }
  }

  if (best.distance <= threshold) return best;
  return { kind: "none", point: clampPoint(point), distance: Infinity };
}

export function nearestVertex(point, vertices, threshold) {
  let best = -1;
  let bestDistance = threshold;
  vertices.forEach((vertex, index) => {
    const d = distance(point, vertex);
    if (d <= bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return best;
}

export function nearestEdge(point, vertices, faces, threshold, edges = null) {
  return nearestEdgeFromList(point, vertices, drawableEdges(faces, edges), threshold);
}

/** Nearest segment among an explicit edge list (includes open edges not yet in faces). */
export function nearestEdgeFromList(point, vertices, edges, threshold) {
  let best = null;
  let bestDistance = threshold;
  for (const edge of edges) {
    if (!edge || edge.length !== 2) continue;
    const projected = pointOnSegment(point, vertices[edge[0]], vertices[edge[1]]);
    if (projected.distance <= bestDistance) {
      bestDistance = projected.distance;
      best = { edge: [...edge], point: projected.point, t: projected.t, distance: projected.distance };
    }
  }
  return best;
}

/**
 * Find the nearest edge among face edges and all vertex-pair segments that
 * are likely "open edges" (used when bridging before faces exist).
 */
export function nearestAnyEdge(point, vertices, faces, threshold, preferredEdges = []) {
  const faceEdges = collectEdges(faces);
  const candidates = [...preferredEdges, ...faceEdges];
  // Also consider every vertex pair when the mesh is still mostly open (small n).
  if (vertices.length <= 32) {
    for (let i = 0; i < vertices.length; i += 1) {
      for (let j = i + 1; j < vertices.length; j += 1) {
        candidates.push([i, j]);
      }
    }
  }
  const unique = [];
  const seen = new Set();
  for (const edge of candidates) {
    const key = edgeKey(edge[0], edge[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  return nearestEdgeFromList(point, vertices, unique, threshold);
}

function addVertex(vertices, point) {
  const index = vertices.length;
  vertices.push(clampPoint(point));
  return index;
}

function sameEdge(a, b) {
  return edgeKey(a[0], a[1]) === edgeKey(b[0], b[1]);
}

/**
 * Proper intersection of segments AB and CD, excluding near-endpoint touches.
 * Returns { point, t } where t is the parameter along AB, or null.
 */
export function segmentIntersection(a, b, c, d, endpointEpsilon = 1e-4) {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const dx = d.x - c.x;
  const dy = d.y - c.y;
  const denom = bx * dy - by * dx;
  if (Math.abs(denom) < EPSILON) return null;
  const t = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denom;
  const u = ((c.x - a.x) * by - (c.y - a.y) * bx) / denom;
  if (t <= endpointEpsilon || t >= 1 - endpointEpsilon) return null;
  if (u <= endpointEpsilon || u >= 1 - endpointEpsilon) return null;
  return {
    t,
    point: clampPoint({ x: a.x + bx * t, y: a.y + by * t }),
  };
}

/**
 * Intersections of segment from→to with face edges, sorted along the segment.
 * Skips edges that share an endpoint with fromIndex / toIndex.
 */
export function findSegmentEdgeIntersections(fromIndex, toIndex, fromPoint, toPoint, vertices, faces, edges = null) {
  const hits = [];
  const seen = new Set();
  for (const edge of drawableEdges(faces, edges)) {
    if (edge.includes(fromIndex) || (toIndex !== null && edge.includes(toIndex))) continue;
    const key = edgeKey(edge[0], edge[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = segmentIntersection(fromPoint, toPoint, vertices[edge[0]], vertices[edge[1]]);
    if (!hit) continue;
    hits.push({
      edge: [...edge],
      point: hit.point,
      t: hit.t,
    });
  }
  hits.sort((left, right) => left.t - right.t);
  return hits;
}

/** Find a current drawable edge that still contains the given point (after prior splits). */
function findEdgeAtPoint(point, vertices, faces, edges = null, threshold = 1e-5) {
  let best = null;
  let bestDistance = threshold;
  for (const edge of drawableEdges(faces, edges)) {
    const projected = pointOnSegment(point, vertices[edge[0]], vertices[edge[1]]);
    if (projected.distance <= bestDistance) {
      bestDistance = projected.distance;
      best = { edge: [...edge], point: projected.point };
    }
  }
  return best;
}

/**
 * Insert a vertex on an edge without auto-diagonals.
 * Updates face cycles in place (n-gons allowed) and replaces the edge in the edge list.
 */
export function splitEdge(sourceVertices, warpVertices, faces, edge, atPoint, edges = null) {
  const nextSource = sourceVertices.map((p) => ({ ...p }));
  const nextWarp = warpVertices.map((p) => ({ ...p }));
  const point = atPoint || midpoint(sourceVertices[edge[0]], sourceVertices[edge[1]]);
  const newIndex = addVertex(nextSource, point);
  addVertex(nextWarp, atPoint ? point : midpoint(warpVertices[edge[0]], warpVertices[edge[1]]));

  const nextFaces = faces.map((face) => {
    const count = face.length;
    let edgeIndex = -1;
    for (let i = 0; i < count; i += 1) {
      if (sameEdge([face[i], face[(i + 1) % count]], edge)) {
        edgeIndex = i;
        break;
      }
    }
    if (edgeIndex < 0) return [...face];
    const rebuilt = [];
    for (let i = 0; i < count; i += 1) {
      rebuilt.push(face[i]);
      if (i === edgeIndex) rebuilt.push(newIndex);
    }
    return rebuilt;
  });

  let nextEdges = ensureEdges(faces, edges);
  nextEdges = removeEdgeFromList(nextEdges, edge[0], edge[1]);
  nextEdges = addEdge(nextEdges, edge[0], newIndex);
  nextEdges = addEdge(nextEdges, newIndex, edge[1]);

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: nextFaces,
    edges: nextEdges,
    newVertexIndex: newIndex,
  };
}

/** @deprecated Use splitEdge — kept as an alias. */
export function insertVertexOnEdge(sourceVertices, warpVertices, faces, edge, point, edges = null) {
  return splitEdge(sourceVertices, warpVertices, faces, edge, point, edges);
}

/**
 * Split a face along chord u–v when both lie on the face and are not already adjacent.
 * Returns two faces, or null if the chord cannot split this face.
 */
export function splitFaceAlongChord(face, u, v) {
  const ui = face.indexOf(u);
  const vi = face.indexOf(v);
  if (ui < 0 || vi < 0 || ui === vi) return null;
  const n = face.length;
  if ((ui + 1) % n === vi || (vi + 1) % n === ui) return null;

  const face1 = [];
  for (let i = ui; ; i = (i + 1) % n) {
    face1.push(face[i]);
    if (i === vi) break;
  }
  const face2 = [];
  for (let i = vi; ; i = (i + 1) % n) {
    face2.push(face[i]);
    if (i === ui) break;
  }
  if (face1.length < 3 || face2.length < 3) return null;
  return [face1, face2];
}

/** Apply a cut chord to every face that can be split by it; add the chord to edges. */
export function knifeCutChord(faces, edges, u, v) {
  let nextEdges = addEdge(edges, u, v);
  const nextFaces = [];
  for (const face of faces) {
    const split = splitFaceAlongChord(face, u, v);
    if (split) nextFaces.push(...split);
    else nextFaces.push([...face]);
  }
  return { faces: nextFaces, edges: nextEdges };
}

/**
 * Knife-connect from→to: insert verts at crossings, persist path edges, split faces along the cut only.
 */
export function knifeConnect(
  sourceVertices,
  warpVertices,
  faces,
  edges,
  fromIndex,
  toPoint,
  toExisting = null,
) {
  let nextSource = sourceVertices.map((point) => ({ ...point }));
  let nextWarp = warpVertices.map((point) => ({ ...point }));
  let nextFaces = faces.map((face) => [...face]);
  let nextEdges = ensureEdges(faces, edges);

  let toIndex = toExisting;
  if (toIndex === null || toIndex === undefined || toIndex === fromIndex) {
    toIndex = addVertex(nextSource, toPoint);
    addVertex(nextWarp, toPoint);
  }

  const hits = findSegmentEdgeIntersections(
    fromIndex,
    toIndex,
    nextSource[fromIndex],
    nextSource[toIndex],
    nextSource,
    nextFaces,
    nextEdges,
  );

  const path = [fromIndex];
  for (const hit of hits) {
    const current = findEdgeAtPoint(hit.point, nextSource, nextFaces, nextEdges, 1e-4);
    if (!current) continue;
    if (current.edge.includes(fromIndex) || current.edge.includes(toIndex)) continue;
    if (path.includes(current.edge[0]) && path.includes(current.edge[1])) continue;
    const split = splitEdge(nextSource, nextWarp, nextFaces, current.edge, current.point, nextEdges);
    nextSource = split.sourceVertices;
    nextWarp = split.warpVertices;
    nextFaces = split.faces;
    nextEdges = split.edges;
    path.push(split.newVertexIndex);
  }
  path.push(toIndex);

  const uniquePath = [];
  for (const index of path) {
    if (uniquePath.length === 0 || uniquePath[uniquePath.length - 1] !== index) {
      uniquePath.push(index);
    }
  }

  for (let i = 0; i < uniquePath.length - 1; i += 1) {
    const cut = knifeCutChord(nextFaces, nextEdges, uniquePath[i], uniquePath[i + 1]);
    nextFaces = cut.faces;
    nextEdges = cut.edges;
  }

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: nextFaces,
    edges: nextEdges,
    toIndex,
    path: uniquePath,
  };
}

/**
 * Split every face edge crossed by from→to, then return the updated mesh and endpoint index.
 * Knife-style: persists cut edges and splits faces along the cut only (no auto-diagonals).
 */
export function connectAcrossIntersections(
  sourceVertices,
  warpVertices,
  faces,
  fromIndex,
  toPoint,
  toExisting = null,
  edges = null,
) {
  return knifeConnect(sourceVertices, warpVertices, faces, edges, fromIndex, toPoint, toExisting);
}

/**
 * Remove an undirected edge. Dissolves faces that used it as a boundary; keeps endpoints.
 */
export function deleteEdge(sourceVertices, warpVertices, faces, edges, edge) {
  const nextEdges = removeEdgeFromList(ensureEdges(faces, edges), edge[0], edge[1]);
  const nextFaces = faces.filter((face) => {
    const count = face.length;
    for (let i = 0; i < count; i += 1) {
      if (sameEdge([face[i], face[(i + 1) % count]], edge)) return false;
    }
    return true;
  });
  let merged = nextEdges;
  for (const face of nextFaces) {
    for (const faceEdge of edgesFromFace(face)) {
      merged = addEdge(merged, faceEdge[0], faceEdge[1]);
    }
  }
  return {
    sourceVertices: sourceVertices.map((p) => ({ ...p })),
    warpVertices: warpVertices.map((p) => ({ ...p })),
    faces: nextFaces.map((f) => [...f]),
    edges: merged,
  };
}

/** Canonical undirected face key (rotation + reflection invariant). */
export function faceKey(face) {
  const n = face.length;
  let best = null;
  for (const dir of [1, -1]) {
    for (let start = 0; start < n; start += 1) {
      const ordered = [];
      for (let i = 0; i < n; i += 1) {
        const index = dir === 1 ? (start + i) % n : (start - i + n * 8) % n;
        ordered.push(face[index]);
      }
      const key = ordered.join(":");
      if (best === null || key < best) best = key;
    }
  }
  return best;
}

export function facesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return faceKey(a) === faceKey(b);
}

function polygonArea(vertices, face) {
  let area = 0;
  for (let i = 0; i < face.length; i += 1) {
    const a = vertices[face[i]];
    const b = vertices[face[(i + 1) % face.length]];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const edge of edges) {
    const [a, b] = edge;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

function windFace(vertices, face) {
  return polygonArea(vertices, face) >= 0 ? [...face] : [...face].reverse();
}

/**
 * Find triangle/quad cycles that use newly drawn path segments and are not already faces.
 */
export function findSealableFaces(faces, edges, path, vertices) {
  if (!path || path.length < 2) return [];
  const adj = buildAdjacency(edges);
  const existing = new Set(faces.map((face) => faceKey(face)));
  const found = [];
  const seen = new Set();

  const consider = (cycle) => {
    if (cycle.length !== 3 && cycle.length !== 4) return;
    if (new Set(cycle).size !== cycle.length) return;
    for (let i = 0; i < cycle.length; i += 1) {
      if (!hasEdge(edges, cycle[i], cycle[(i + 1) % cycle.length])) return;
    }
    const wound = windFace(vertices, cycle);
    if (Math.abs(polygonArea(vertices, wound)) < 1e-12) return;
    const key = faceKey(wound);
    if (seen.has(key) || existing.has(key)) return;
    seen.add(key);
    found.push(wound);
  };

  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const neighborsA = adj.get(a) || new Set();
    const neighborsB = adj.get(b) || new Set();
    for (const w of neighborsA) {
      if (w === b) continue;
      if (neighborsB.has(w)) consider([a, b, w]);
    }
    for (const c of neighborsB) {
      if (c === a) continue;
      const neighborsC = adj.get(c) || new Set();
      for (const d of neighborsC) {
        if (d === b || d === a) continue;
        if (neighborsA.has(d)) consider([a, b, c, d]);
      }
    }
  }

  found.sort((left, right) => left.length - right.length);
  return found;
}

/**
 * Add closed triangle/quad faces along a knife path when all boundary edges already exist.
 */
export function sealFacesAlongPath(faces, edges, path, vertices) {
  const sealed = findSealableFaces(faces, edges, path, vertices);
  if (!sealed.length) {
    return { faces: faces.map((face) => [...face]), edges, added: [] };
  }
  // Prefer triangles; skip a quad if any of its 3-cycles was also sealed in this pass.
  const added = [];
  const triKeys = new Set();
  for (const face of sealed) {
    if (face.length === 3) {
      added.push(face);
      triKeys.add(faceKey(face));
    }
  }
  for (const face of sealed) {
    if (face.length !== 4) continue;
    const corners = face;
    let coversTri = false;
    for (let i = 0; i < 4; i += 1) {
      const tri = [corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]];
      if (triKeys.has(faceKey(tri))) {
        coversTri = true;
        break;
      }
    }
    if (!coversTri) added.push(face);
  }
  return {
    faces: [...faces.map((face) => [...face]), ...added.map((face) => [...face])],
    edges,
    added,
  };
}

/**
 * Remove a face but keep its vertices and boundary edges.
 */
export function deleteFace(sourceVertices, warpVertices, faces, edges, face) {
  const key = faceKey(face);
  const nextFaces = faces.filter((entry) => faceKey(entry) !== key);
  let nextEdges = ensureEdges(faces, edges);
  for (const faceEdge of edgesFromFace(face)) {
    nextEdges = addEdge(nextEdges, faceEdge[0], faceEdge[1]);
  }
  return {
    sourceVertices: sourceVertices.map((p) => ({ ...p })),
    warpVertices: warpVertices.map((p) => ({ ...p })),
    faces: nextFaces.map((f) => [...f]),
    edges: nextEdges,
  };
}

/** Ray-cast point-in-polygon for a face in document space. */
export function pointInFace(point, vertices, face) {
  let inside = false;
  for (let i = 0, j = face.length - 1; i < face.length; j = i, i += 1) {
    const a = vertices[face[i]];
    const b = vertices[face[j]];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Smallest-area face containing the point, or null. */
export function findFaceAtPoint(point, vertices, faces) {
  let best = null;
  let bestArea = Infinity;
  for (const face of faces) {
    if (!pointInFace(point, vertices, face)) continue;
    const area = Math.abs(polygonArea(vertices, face));
    if (area < bestArea) {
      bestArea = area;
      best = [...face];
    }
  }
  return best;
}

/** Vertices whose positions fall inside an axis-aligned document-space rect. */
export function verticesInRect(vertices, rect) {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  const hits = [];
  vertices.forEach((point, index) => {
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
      hits.push(index);
    }
  });
  return hits;
}

export function bridgeEdges(sourceVertices, warpVertices, faces, edgeA, edgeB, edges = null) {
  if (sameEdge(edgeA, edgeB)) {
    throw new Error("Select two different edges to bridge.");
  }
  const shared = edgeA.filter((index) => edgeB.includes(index));
  if (shared.length) {
    throw new Error("Those edges already share a vertex. Extrude instead of bridging.");
  }

  // Order edgeB so the quad doesn't bow-tie: pick orientation by crossing test
  let b0 = edgeB[0];
  let b1 = edgeB[1];
  const a0 = edgeA[0];
  const a1 = edgeA[1];
  const cross =
    (sourceVertices[a1].x - sourceVertices[a0].x) *
      (sourceVertices[b0].y - sourceVertices[a0].y) -
    (sourceVertices[a1].y - sourceVertices[a0].y) *
      (sourceVertices[b0].x - sourceVertices[a0].x);
  const cross2 =
    (sourceVertices[a1].x - sourceVertices[a0].x) *
      (sourceVertices[b1].y - sourceVertices[a0].y) -
    (sourceVertices[a1].y - sourceVertices[a0].y) *
      (sourceVertices[b1].x - sourceVertices[a0].x);
  // Prefer non-crossing quad A0-A1-B?-B?
  let face = [a0, a1, b1, b0];
  if (Math.sign(cross) === Math.sign(cross2)) {
    face = [a0, a1, b0, b1];
  }

  let nextEdges = ensureEdges(faces, edges);
  for (const faceEdge of edgesFromFace(face)) {
    nextEdges = addEdge(nextEdges, faceEdge[0], faceEdge[1]);
  }
  return {
    sourceVertices: sourceVertices.map((p) => ({ ...p })),
    warpVertices: warpVertices.map((p) => ({ ...p })),
    faces: [...faces.map((f) => [...f]), face],
    edges: nextEdges,
  };
}

/**
 * Resolve what a Draw click should do given current selection.
 * selection: { vertices: number[], edge: [a,b]|null, face: number[]|null }
 *
 * Draw behaviour:
 * - Click an edge with nothing selected → insert a point only
 * - Click an edge / empty with a point selected → knife cut (persist edges, split faces along cut)
 * - Two points / an edge selected → extrude a triangle / complete a quad as before
 */
export function resolvePenAction({
  selection,
  clickPoint,
  sourceVertices,
  faces,
  edges = null,
  insertMode = "tri-quad",
  snapThreshold = 0.02,
}) {
  const snap = snapToMesh(clickPoint, sourceVertices, faces, snapThreshold, edges);
  const point = snap.kind === "none" ? clampPoint(clickPoint) : snap.point;
  const snappedVertex = snap.kind === "vertex" ? snap.index : null;

  const activeEdge =
    selection.edge || (selection.vertices.length === 2 ? [...selection.vertices] : null);
  const singleVertex =
    selection.vertices.length === 1 ? selection.vertices[0]
      : (!activeEdge && !selection.face && selection.vertices.length > 0 ? selection.vertices[0] : null);

  if (activeEdge && snappedVertex !== null && activeEdge.includes(snappedVertex)) {
    return {
      type: "select-only",
      vertexIndex: snappedVertex,
      preview: { kind: "vertex", point: snap.point },
      hint: "Continue from this point",
    };
  }

  const edgeHit =
    snappedVertex !== null
      ? null
      : snap.kind === "edge"
        ? snap
        : nearestEdge(clickPoint, sourceVertices, faces, snapThreshold, edges);

  if (edgeHit) {
    if (singleVertex !== null && !edgeHit.edge.includes(singleVertex)) {
      return {
        type: "split-and-connect",
        from: singleVertex,
        edge: [...edgeHit.edge],
        point: edgeHit.point,
        preview: {
          kind: "edge",
          points: [sourceVertices[singleVertex], edgeHit.point],
          marker: edgeHit.point,
        },
        hint: "Cut to this line",
      };
    }
    return {
      type: "split-edge",
      edge: [...edgeHit.edge],
      point: edgeHit.point,
      preview: { kind: "vertex", point: edgeHit.point },
      hint: "Add a point on this line",
    };
  }

  if (insertMode === "vertex") {
    return {
      type: "add-vertex",
      point,
      preview: { kind: "vertex", point },
      hint: "Add a vertex",
    };
  }

  if (selection.face && selection.face.length === 3) {
    const reuse = snappedVertex !== null && !selection.face.includes(snappedVertex) ? snappedVertex : null;
    return {
      type: "complete-quad",
      face: [...selection.face],
      point,
      toExisting: reuse,
      preview: {
        kind: "quad",
        points: [
          sourceVertices[selection.face[0]],
          sourceVertices[selection.face[1]],
          sourceVertices[selection.face[2]],
          point,
        ],
      },
      hint: reuse === null
        ? "Complete the triangle into a quad"
        : "Complete the quad on the existing point",
    };
  }

  if (activeEdge) {
    if (insertMode === "edge") {
      return {
        type: "extrude-edge-open",
        edge: [...activeEdge],
        point,
        toExisting: snappedVertex,
        preview: {
          kind: "edge",
          points: [midpoint(sourceVertices[activeEdge[0]], sourceVertices[activeEdge[1]]), point],
        },
        hint: "Extrude an open edge",
      };
    }
    if (insertMode === "quad") {
      const a = sourceVertices[activeEdge[0]];
      const b = sourceVertices[activeEdge[1]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const half = distance(a, b) / 2;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const c = clampPoint({ x: point.x - ux * half, y: point.y - uy * half });
      const d = clampPoint({ x: point.x + ux * half, y: point.y + uy * half });
      return {
        type: "quad-strip",
        edge: [...activeEdge],
        newEdge: [c, d],
        preview: {
          kind: "quad",
          points: [a, b, d, c],
        },
        hint: "Extrude a quad strip",
      };
    }
    return {
      type: "extrude-triangle",
      edge: [...activeEdge],
      point,
      toExisting: snappedVertex,
      preview: {
        kind: "triangle",
        points: [sourceVertices[activeEdge[0]], sourceVertices[activeEdge[1]], point],
      },
      hint: snappedVertex === null
        ? "Extrude a triangle from this edge"
        : "Close a triangle on the existing point",
    };
  }

  if (singleVertex !== null) {
    const from = singleVertex;
    const targetPoint = snap.kind === "vertex" && snap.index !== from ? sourceVertices[snap.index] : point;
    const toExisting = snap.kind === "vertex" && snap.index !== from ? snap.index : null;
    return {
      type: "connect-line",
      from,
      point: targetPoint,
      toExisting,
      preview: {
        kind: "edge",
        points: [sourceVertices[from], targetPoint],
        marker: targetPoint,
      },
      hint: toExisting === null
        ? "Draw a cut to a new point"
        : "Cut between these points",
    };
  }

  if (snap.kind === "vertex") {
    return {
      type: "select-only",
      vertexIndex: snap.index,
      preview: { kind: "vertex", point: snap.point },
      hint: "Select this vertex",
    };
  }

  return {
    type: "add-vertex",
    point,
    preview: { kind: "vertex", point },
    hint: "Add a vertex",
  };
}

export function applyPenAction(action, sourceVertices, warpVertices, faces, edges = null, options = {}) {
  const faceMode = options.faceMode !== false;
  let nextSource = sourceVertices.map((p) => ({ ...p }));
  let nextWarp = warpVertices.map((p) => ({ ...p }));
  let nextFaces = faces.map((f) => [...f]);
  let nextEdges = ensureEdges(faces, edges);
  let selectVertices = [];
  let selectEdge = null;
  let selectFace = null;

  const withEdges = (result, selection) => ({
    sourceVertices: result.sourceVertices,
    warpVertices: result.warpVertices,
    faces: result.faces,
    edges: result.edges ?? nextEdges,
    selection,
  });

  const maybeSeal = (connected) => {
    if (!faceMode) return { ...connected, added: [] };
    const sealed = sealFacesAlongPath(
      connected.faces,
      connected.edges,
      connected.path,
      connected.sourceVertices,
    );
    return {
      ...connected,
      faces: sealed.faces,
      edges: sealed.edges,
      added: sealed.added,
    };
  };

  switch (action.type) {
    case "select-only": {
      selectVertices = [action.vertexIndex];
      break;
    }
    case "add-vertex": {
      const index = addVertex(nextSource, action.point);
      addVertex(nextWarp, action.point);
      selectVertices = [index];
      break;
    }
    case "connect-line":
    case "extrude-edge": {
      const connected = maybeSeal(
        knifeConnect(
          nextSource,
          nextWarp,
          nextFaces,
          nextEdges,
          action.from,
          action.point,
          action.toExisting,
        ),
      );
      return withEdges(connected, {
        vertices: [connected.toIndex],
        edge: null,
        face: connected.added?.length ? connected.added[connected.added.length - 1] : null,
      });
    }
    case "split-and-connect": {
      const split = splitEdge(nextSource, nextWarp, nextFaces, action.edge, action.point, nextEdges);
      const connected = maybeSeal(
        knifeConnect(
          split.sourceVertices,
          split.warpVertices,
          split.faces,
          split.edges,
          action.from,
          split.sourceVertices[split.newVertexIndex],
          split.newVertexIndex,
        ),
      );
      return withEdges(connected, {
        vertices: [connected.toIndex],
        edge: null,
        face: connected.added?.length ? connected.added[connected.added.length - 1] : null,
      });
    }
    case "extrude-triangle": {
      let tipIndex = action.toExisting;
      if (tipIndex === null || tipIndex === undefined || action.edge.includes(tipIndex)) {
        tipIndex = addVertex(nextSource, action.point);
        addVertex(nextWarp, action.point);
      }
      let mesh = knifeConnect(
        nextSource, nextWarp, nextFaces, nextEdges,
        action.edge[0], nextSource[tipIndex], tipIndex,
      );
      tipIndex = mesh.toIndex;
      mesh = knifeConnect(
        mesh.sourceVertices, mesh.warpVertices, mesh.faces, mesh.edges,
        action.edge[1], mesh.sourceVertices[tipIndex], tipIndex,
      );
      tipIndex = mesh.toIndex;
      nextSource = mesh.sourceVertices;
      nextWarp = mesh.warpVertices;
      nextFaces = mesh.faces;
      nextEdges = mesh.edges;
      const face = [action.edge[0], action.edge[1], tipIndex];
      if (new Set(face).size !== 3) throw new Error("That triangle would reuse the same point twice.");
      nextFaces.push(face);
      for (const faceEdge of edgesFromFace(face)) {
        nextEdges = addEdge(nextEdges, faceEdge[0], faceEdge[1]);
      }
      selectFace = face;
      selectVertices = [...face];
      selectEdge = null;
      break;
    }
    case "complete-quad": {
      let newIndex = action.toExisting;
      if (newIndex === null || newIndex === undefined || action.face.includes(newIndex)) {
        newIndex = addVertex(nextSource, action.point);
        addVertex(nextWarp, action.point);
      }
      nextFaces = nextFaces.filter(
        (face) =>
          !(
            face.length === action.face.length &&
            face.every((index, i) => index === action.face[i])
          ),
      );
      const face = [...action.face, newIndex];
      nextFaces.push(face);
      for (const faceEdge of edgesFromFace(face)) {
        nextEdges = addEdge(nextEdges, faceEdge[0], faceEdge[1]);
      }
      selectFace = face;
      selectVertices = [...face];
      break;
    }
    case "bridge": {
      const bridged = bridgeEdges(nextSource, nextWarp, nextFaces, action.edgeA, action.edgeB, nextEdges);
      return withEdges(bridged, {
        vertices: [...action.edgeA, ...action.edgeB],
        edge: null,
        face: bridged.faces[bridged.faces.length - 1],
      });
    }
    case "split-edge": {
      const split = splitEdge(nextSource, nextWarp, nextFaces, action.edge, action.point, nextEdges);
      return withEdges(split, {
        vertices: [split.newVertexIndex],
        edge: null,
        face: null,
      });
    }
    case "quad-strip": {
      const c = addVertex(nextSource, action.newEdge[0]);
      addVertex(nextWarp, action.newEdge[0]);
      const d = addVertex(nextSource, action.newEdge[1]);
      addVertex(nextWarp, action.newEdge[1]);
      const face = [action.edge[0], action.edge[1], d, c];
      nextFaces.push(face);
      for (const faceEdge of edgesFromFace(face)) {
        nextEdges = addEdge(nextEdges, faceEdge[0], faceEdge[1]);
      }
      selectEdge = [c, d];
      selectFace = face;
      selectVertices = [...face];
      break;
    }
    case "extrude-edge-open": {
      let newIndex = action.toExisting;
      if (newIndex === null || newIndex === undefined || action.edge.includes(newIndex)) {
        newIndex = addVertex(nextSource, action.point);
        addVertex(nextWarp, action.point);
      }
      nextEdges = addEdge(nextEdges, action.edge[0], newIndex);
      selectEdge = [action.edge[0], newIndex];
      selectVertices = [action.edge[0], newIndex];
      break;
    }
    default:
      throw new Error(`Unknown pen action: ${action.type}`);
  }

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: nextFaces,
    edges: nextEdges,
    selection: {
      vertices: selectVertices,
      edge: selectEdge,
      face: selectFace,
    },
  };
}

export function deleteVertex(sourceVertices, warpVertices, faces, vertexIndex, edges = null) {
  if (vertexIndex < 0 || vertexIndex >= sourceVertices.length) {
    throw new Error("That vertex does not exist.");
  }
  const remainingFaces = faces
    .filter((face) => !face.includes(vertexIndex))
    .map((face) => face.map((index) => (index > vertexIndex ? index - 1 : index)));

  const nextSource = sourceVertices.filter((_, index) => index !== vertexIndex);
  const nextWarp = warpVertices.filter((_, index) => index !== vertexIndex);
  const nextEdges = remapEdges(ensureEdges(faces, edges), vertexIndex);

  if (nextSource.length === 0) {
    return {
      sourceVertices: [],
      warpVertices: [],
      faces: [],
      edges: [],
    };
  }

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: remainingFaces,
    edges: nextEdges,
  };
}

export function validateFaces(vertices, faces) {
  if (!Array.isArray(vertices) || !Array.isArray(faces)) {
    throw new Error("The mesh is missing vertices or faces.");
  }
  for (const point of vertices) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("A mesh point is not a finite coordinate.");
    }
  }
  for (const face of faces) {
    if (!Array.isArray(face) || face.length < 3) {
      throw new Error("Every face must have at least three vertices.");
    }
    if (new Set(face).size !== face.length) {
      throw new Error("A face refers to the same vertex more than once.");
    }
    for (const index of face) {
      if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
        throw new Error("A face refers to an invalid vertex.");
      }
    }
  }
  return true;
}

export function validateEdges(vertices, edges) {
  if (edges == null) return true;
  if (!Array.isArray(edges)) throw new Error("Mesh edges must be an array.");
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new Error("Every edge must list two vertex indices.");
    }
    for (const index of edge) {
      if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
        throw new Error("An edge refers to an invalid vertex.");
      }
    }
    if (edge[0] === edge[1]) throw new Error("An edge cannot connect a vertex to itself.");
  }
  return true;
}

/** Seed a single quad over normalized rectangle bounds. */
export function seedQuadMesh(bounds) {
  const vertices = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ];
  return {
    name: "Custom mesh",
    sourceVertices: vertices.map((p) => ({ ...p })),
    warpVertices: vertices.map((p) => ({ ...p })),
    quads: [[0, 1, 2, 3]],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    warpLinked: true,
  };
}

/** Triangulate faces that may be triangles or quads. */
export function triangulateFaces(faces) {
  return faces.flatMap((face) => {
    if (face.length === 3) return [face];
    if (face.length === 4) {
      return [
        [face[0], face[1], face[2]],
        [face[0], face[2], face[3]],
      ];
    }
    const tris = [];
    for (let i = 1; i < face.length - 1; i += 1) {
      tris.push([face[0], face[i], face[i + 1]]);
    }
    return tris;
  });
}
