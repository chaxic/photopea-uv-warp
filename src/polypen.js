/**
 * PolyPen-style contextual mesh creation for 2D UV layout.
 * Inspired by RetopoFlow PolyPen (tri/quad extrude + edge bridging).
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
export function snapToMesh(point, vertices, faces, threshold) {
  let best = { kind: "none", point: { ...point }, distance: Infinity };

  vertices.forEach((vertex, index) => {
    const d = distance(point, vertex);
    if (d < best.distance) {
      best = { kind: "vertex", index, point: { ...vertex }, distance: d };
    }
  });

  for (const edge of collectEdges(faces)) {
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

export function nearestEdge(point, vertices, faces, threshold) {
  let best = null;
  let bestDistance = threshold;
  const edges = collectEdges(faces);
  for (const edge of edges) {
    const projected = pointOnSegment(point, vertices[edge[0]], vertices[edge[1]]);
    if (projected.distance <= bestDistance) {
      bestDistance = projected.distance;
      best = { edge: [...edge], point: projected.point, t: projected.t, distance: projected.distance };
    }
  }
  return best;
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
 * Insert a vertex on an edge and split adjacent faces.
 * Mutates copies — returns new mesh arrays.
 */
export function insertVertexOnEdge(sourceVertices, warpVertices, faces, edge, point) {
  const nextSource = sourceVertices.map((p) => ({ ...p }));
  const nextWarp = warpVertices.map((p) => ({ ...p }));
  const newIndex = addVertex(nextSource, point);
  addVertex(nextWarp, point);

  const nextFaces = [];
  for (const face of faces) {
    const count = face.length;
    let splitAt = -1;
    for (let i = 0; i < count; i += 1) {
      const u = face[i];
      const v = face[(i + 1) % count];
      if (sameEdge([u, v], edge)) {
        splitAt = i;
        break;
      }
    }
    if (splitAt < 0) {
      nextFaces.push([...face]);
      continue;
    }
    // Replace edge u-v with u-new-v
    const rebuilt = [];
    for (let i = 0; i < count; i += 1) {
      rebuilt.push(face[i]);
      if (i === splitAt) rebuilt.push(newIndex);
    }
    // Split n-gon into triangle fan or two faces for quads
    if (rebuilt.length === 4) {
      nextFaces.push(rebuilt);
    } else if (rebuilt.length === 5) {
      // Quad that gained a midpoint → two quads sharing the new vertex
      // Original quad ABCD with split on AB → A N B C D
      // Faces: A N C D and N B C (if we had triangle) — for quad A-B-C-D split on A-B:
      // verts: A, N, B, C, D → faces [A,N,C,D] wait that's wrong.
      // Correct: [A, N, B, C] no — original was A-B-C-D.
      // After insert on A-B: A-N-B-C-D. Split into quads [A,N,C,D] and [N,B,C] — triangle.
      // Better: [A, N, C, D] only if C is opposite... Standard: [A,N,B,C] is wrong length.
      // For quad A-B-C-D with mid M on A-B: faces [A,M,C,D] is invalid (skips B).
      // Correct split: [A, M, D] + [M, B, C, D] or [A, M, B, C] + [A, C, D] 
      // Standard edge split for quad: [A, M, C, D] NO.
      // Quad A-B-C-D, edge A-B: result faces [A, M, B, D]? No D not adjacent to B via that.
      // Correct: [A, M, D] triangle and [M, B, C, D] quad — or both quads if we add diagonal.
      // Simplest valid: [A, M, B, C] wait C not next to B from A... 
      // Face winding A→B→C→D. Insert M on A→B: A→M→B→C→D.
      // Split into: A→M→C→D and M→B→C (triangle) — or A→M→B→C and A→C→D (tri).
      // Prefer two faces: [A, M, C, D] is wrong topology.
      // Use: [A, M, B, C] — that's A-M-B-C which includes wrong edge M-C skipping?
      // Actually for retopo: [A,M,D] and [M,B,C,D]:
      nextFaces.push([rebuilt[0], rebuilt[1], rebuilt[4]]); // A, M, D if D is last
      // rebuilt = [A, N, B, C, D] indices 0,1,2,3,4
      nextFaces.pop();
      nextFaces.push([rebuilt[0], rebuilt[1], rebuilt[4]]); // A N D
      nextFaces.push([rebuilt[1], rebuilt[2], rebuilt[3], rebuilt[4]]); // N B C D
    } else {
      nextFaces.push(rebuilt);
    }
  }

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: nextFaces,
    newVertexIndex: newIndex,
  };
}

/** Fix insertVertexOnEdge for clean quad split. */
export function splitEdge(sourceVertices, warpVertices, faces, edge, atPoint) {
  const nextSource = sourceVertices.map((p) => ({ ...p }));
  const nextWarp = warpVertices.map((p) => ({ ...p }));
  const newIndex = addVertex(nextSource, atPoint || midpoint(sourceVertices[edge[0]], sourceVertices[edge[1]]));
  addVertex(nextWarp, atPoint || midpoint(warpVertices[edge[0]], warpVertices[edge[1]]));

  const nextFaces = [];
  for (const face of faces) {
    const count = face.length;
    let edgeIndex = -1;
    for (let i = 0; i < count; i += 1) {
      if (sameEdge([face[i], face[(i + 1) % count]], edge)) {
        edgeIndex = i;
        break;
      }
    }
    if (edgeIndex < 0) {
      nextFaces.push([...face]);
      continue;
    }

    if (count === 3) {
      const a = face[edgeIndex];
      const b = face[(edgeIndex + 1) % 3];
      const c = face[(edgeIndex + 2) % 3];
      nextFaces.push([a, newIndex, c]);
      nextFaces.push([newIndex, b, c]);
      continue;
    }

    // Quad: split into two quads sharing the new mid-edge vertex and the opposite diagonal
    const a = face[edgeIndex];
    const b = face[(edgeIndex + 1) % 4];
    const c = face[(edgeIndex + 2) % 4];
    const d = face[(edgeIndex + 3) % 4];
    nextFaces.push([a, newIndex, c, d]);
    nextFaces.push([newIndex, b, c]);
    // Prefer two quads: [a, new, d] is tri; better [a, newIndex, b, c] no.
    // Correct two-quad split of ABCD with M on AB: [A,M,C,D] is invalid.
    // [A, M, D] + [M, B, C, D]:
    nextFaces.pop();
    nextFaces.pop();
    nextFaces.push([a, newIndex, d]);
    nextFaces.push([newIndex, b, c, d]);
  }

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: nextFaces,
    newVertexIndex: newIndex,
  };
}

export function bridgeEdges(sourceVertices, warpVertices, faces, edgeA, edgeB) {
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

  return {
    sourceVertices: sourceVertices.map((p) => ({ ...p })),
    warpVertices: warpVertices.map((p) => ({ ...p })),
    faces: [...faces.map((f) => [...f]), face],
  };
}

/**
 * Resolve what a Pen click should do given current selection.
 * selection: { vertices: number[], edge: [a,b]|null, face: number[]|null }
 */
export function resolvePenAction({
  selection,
  clickPoint,
  sourceVertices,
  faces,
  insertMode = "tri-quad",
  snapThreshold = 0.02,
}) {
  const snap = snapToMesh(clickPoint, sourceVertices, faces, snapThreshold);
  const point = snap.kind === "none" ? clampPoint(clickPoint) : snap.point;

  // Prefer an edge hit that includes open edges (not only face edges).
  const edgeHit =
    snap.kind === "edge"
      ? snap
      : nearestAnyEdge(clickPoint, sourceVertices, faces, snapThreshold, selection.edge ? [selection.edge] : []);

  // Bridge: one edge selected + click lands on another edge
  if (selection.edge && edgeHit && !sameEdge(selection.edge, edgeHit.edge)) {
    return {
      type: "bridge",
      edgeA: [...selection.edge],
      edgeB: [...edgeHit.edge],
      preview: {
        kind: "quad",
        points: [
          sourceVertices[selection.edge[0]],
          sourceVertices[selection.edge[1]],
          sourceVertices[edgeHit.edge[1]],
          sourceVertices[edgeHit.edge[0]],
        ],
      },
      hint: "Bridge these edges with a quad",
    };
  }

  // Click on existing edge with nothing useful selected → split
  if (
    (!selection.edge || selection.vertices.length === 0) &&
    !selection.face &&
    edgeHit &&
    selection.vertices.length === 0
  ) {
    return {
      type: "split-edge",
      edge: [...edgeHit.edge],
      point: edgeHit.point,
      preview: { kind: "vertex", point: edgeHit.point },
      hint: "Split this edge",
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

  // Triangle selected → complete to quad
  if (selection.face && selection.face.length === 3) {
    return {
      type: "complete-quad",
      face: [...selection.face],
      point,
      preview: {
        kind: "quad",
        points: [
          sourceVertices[selection.face[0]],
          sourceVertices[selection.face[1]],
          sourceVertices[selection.face[2]],
          point,
        ],
      },
      hint: "Complete the triangle into a quad",
    };
  }

  // Edge selected
  if (selection.edge) {
    if (insertMode === "edge") {
      return {
        type: "extrude-edge-open",
        edge: [...selection.edge],
        point,
        preview: {
          kind: "edge",
          points: [midpoint(sourceVertices[selection.edge[0]], sourceVertices[selection.edge[1]]), point],
        },
        hint: "Extrude an open edge",
      };
    }
    if (insertMode === "quad-strip") {
      // Parallel edge centered on click, quad between
      const a = sourceVertices[selection.edge[0]];
      const b = sourceVertices[selection.edge[1]];
      const mid = midpoint(a, b);
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
        edge: [...selection.edge],
        newEdge: [c, d],
        preview: {
          kind: "quad",
          points: [a, b, d, c],
        },
        hint: "Extrude a quad strip",
      };
    }
    // tri-quad default: triangle from edge to point
    return {
      type: "extrude-triangle",
      edge: [...selection.edge],
      point,
      preview: {
        kind: "triangle",
        points: [sourceVertices[selection.edge[0]], sourceVertices[selection.edge[1]], point],
      },
      hint: "Extrude a triangle from this edge",
    };
  }

  // Single vertex selected → extrude edge
  if (selection.vertices.length === 1) {
    const from = selection.vertices[0];
    return {
      type: "extrude-edge",
      from,
      point: snap.kind === "vertex" && snap.index !== from ? sourceVertices[snap.index] : point,
      toExisting: snap.kind === "vertex" && snap.index !== from ? snap.index : null,
      preview: {
        kind: "edge",
        points: [sourceVertices[from], snap.kind === "vertex" && snap.index !== from ? sourceVertices[snap.index] : point],
      },
      hint: "Extrude an edge from this vertex",
    };
  }

  // Nothing selected
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

/**
 * Apply a resolved pen action. Returns next mesh + selection hint.
 */
export function applyPenAction(action, sourceVertices, warpVertices, faces) {
  const nextSource = sourceVertices.map((p) => ({ ...p }));
  const nextWarp = warpVertices.map((p) => ({ ...p }));
  let nextFaces = faces.map((f) => [...f]);
  let selectVertices = [];
  let selectEdge = null;
  let selectFace = null;

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
    case "extrude-edge": {
      let toIndex = action.toExisting;
      if (toIndex === null || toIndex === undefined) {
        toIndex = addVertex(nextSource, action.point);
        addVertex(nextWarp, action.point);
      }
      selectEdge = [action.from, toIndex];
      selectVertices = [action.from, toIndex];
      break;
    }
    case "extrude-triangle": {
      const newIndex = addVertex(nextSource, action.point);
      addVertex(nextWarp, action.point);
      const face = [action.edge[0], action.edge[1], newIndex];
      nextFaces.push(face);
      selectFace = face;
      selectVertices = [...face];
      selectEdge = null;
      break;
    }
    case "complete-quad": {
      const newIndex = addVertex(nextSource, action.point);
      addVertex(nextWarp, action.point);
      nextFaces = nextFaces.filter(
        (face) =>
          !(
            face.length === action.face.length &&
            face.every((index, i) => index === action.face[i])
          ),
      );
      const face = [...action.face, newIndex];
      nextFaces.push(face);
      selectFace = face;
      selectVertices = [...face];
      break;
    }
    case "bridge": {
      const bridged = bridgeEdges(nextSource, nextWarp, nextFaces, action.edgeA, action.edgeB);
      return {
        sourceVertices: bridged.sourceVertices,
        warpVertices: bridged.warpVertices,
        faces: bridged.faces,
        selection: {
          vertices: [...action.edgeA, ...action.edgeB],
          edge: null,
          face: bridged.faces[bridged.faces.length - 1],
        },
      };
    }
    case "split-edge": {
      const split = splitEdge(nextSource, nextWarp, nextFaces, action.edge, action.point);
      return {
        sourceVertices: split.sourceVertices,
        warpVertices: split.warpVertices,
        faces: split.faces,
        selection: {
          vertices: [split.newVertexIndex],
          edge: null,
          face: null,
        },
      };
    }
    case "quad-strip": {
      const c = addVertex(nextSource, action.newEdge[0]);
      addVertex(nextWarp, action.newEdge[0]);
      const d = addVertex(nextSource, action.newEdge[1]);
      addVertex(nextWarp, action.newEdge[1]);
      const face = [action.edge[0], action.edge[1], d, c];
      nextFaces.push(face);
      selectEdge = [c, d];
      selectFace = face;
      selectVertices = [...face];
      break;
    }
    case "extrude-edge-open": {
      const newIndex = addVertex(nextSource, action.point);
      addVertex(nextWarp, action.point);
      // Connect both edge ends? For edge-only mode, just add a dangling vertex linked from midpoint conceptually — link from nearest endpoint
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
    selection: {
      vertices: selectVertices,
      edge: selectEdge,
      face: selectFace,
    },
  };
}

/**
 * Delete a vertex and remove faces that used it. Leaves remaining faces intact.
 */
export function deleteVertex(sourceVertices, warpVertices, faces, vertexIndex) {
  if (vertexIndex < 0 || vertexIndex >= sourceVertices.length) {
    throw new Error("That vertex does not exist.");
  }
  const remainingFaces = faces
    .filter((face) => !face.includes(vertexIndex))
    .map((face) => face.map((index) => (index > vertexIndex ? index - 1 : index)));

  const nextSource = sourceVertices.filter((_, index) => index !== vertexIndex);
  const nextWarp = warpVertices.filter((_, index) => index !== vertexIndex);

  if (nextSource.length === 0) {
    return {
      sourceVertices: [],
      warpVertices: [],
      faces: [],
    };
  }

  return {
    sourceVertices: nextSource,
    warpVertices: nextWarp,
    faces: remainingFaces,
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
    if (!Array.isArray(face) || (face.length !== 3 && face.length !== 4)) {
      throw new Error("Every face must be a triangle or a quad.");
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
    warpLinked: true,
  };
}

/** Triangulate faces that may be triangles or quads. */
export function triangulateFaces(faces) {
  return faces.flatMap((face) => {
    if (face.length === 3) return [face];
    return [
      [face[0], face[1], face[2]],
      [face[0], face[2], face[3]],
    ];
  });
}
