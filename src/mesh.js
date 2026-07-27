const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeInset(insetPercent) {
  return clamp(Number(insetPercent) || 0, 0, 25) / 100;
}

function applyInset(point, inset) {
  const scale = 1 - inset * 2;
  return {
    x: inset + point.x * scale,
    y: inset + point.y * scale,
  };
}

function addDeduplicatedPoint(vertices, pointIndex, point) {
  const key = `${Math.round(point.x * 1_000_000)}:${Math.round(point.y * 1_000_000)}`;
  if (pointIndex.has(key)) return pointIndex.get(key);

  const index = vertices.length;
  vertices.push(point);
  pointIndex.set(key, index);
  return index;
}

function lerpPoint(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  };
}

function bilinearPoint(corners, u, v) {
  const top = lerpPoint(corners[0], corners[1], u);
  const bottom = lerpPoint(corners[3], corners[2], u);
  return lerpPoint(top, bottom, v);
}

function addSubdividedFace(mesh, pointIndex, corners, divisions) {
  const faceGrid = [];

  for (let row = 0; row <= divisions; row += 1) {
    const rowIndices = [];
    for (let column = 0; column <= divisions; column += 1) {
      const point = bilinearPoint(corners, column / divisions, row / divisions);
      rowIndices.push(addDeduplicatedPoint(mesh.vertices, pointIndex, point));
    }
    faceGrid.push(rowIndices);
  }

  for (let row = 0; row < divisions; row += 1) {
    for (let column = 0; column < divisions; column += 1) {
      mesh.quads.push([
        faceGrid[row][column],
        faceGrid[row][column + 1],
        faceGrid[row + 1][column + 1],
        faceGrid[row + 1][column],
      ]);
    }
  }
}

export function buildGridMesh(columns = 2, rows = 2, insetPercent = 0) {
  const safeColumns = clamp(Math.round(Number(columns) || 1), 1, 10);
  const safeRows = clamp(Math.round(Number(rows) || 1), 1, 10);
  const inset = normalizeInset(insetPercent);
  const vertices = [];
  const quads = [];

  for (let row = 0; row <= safeRows; row += 1) {
    for (let column = 0; column <= safeColumns; column += 1) {
      vertices.push(
        applyInset(
          {
            x: column / safeColumns,
            y: row / safeRows,
          },
          inset,
        ),
      );
    }
  }

  const stride = safeColumns + 1;
  for (let row = 0; row < safeRows; row += 1) {
    for (let column = 0; column < safeColumns; column += 1) {
      const topLeft = row * stride + column;
      quads.push([topLeft, topLeft + 1, topLeft + stride + 1, topLeft + stride]);
    }
  }

  return {
    name: `${safeColumns} × ${safeRows} grid`,
    vertices,
    quads,
  };
}

export function buildBuildingMesh(divisions = 2, orientation = "right", insetPercent = 0) {
  const safeDivisions = clamp(Math.round(Number(divisions) || 1), 1, 4);
  const inset = normalizeInset(insetPercent);

  const roofBackLeft = { x: 0.28, y: 0.06 };
  const roofBackRight = { x: 0.94, y: 0.29 };
  const frontTopRight = { x: 0.59, y: 0.49 };
  const frontTopLeft = { x: 0.06, y: 0.27 };
  const frontBottomLeft = { x: 0.06, y: 0.84 };
  const frontBottomRight = { x: 0.59, y: 0.95 };
  const sideBottomRight = { x: 0.94, y: 0.73 };

  const faces = [
    [roofBackLeft, roofBackRight, frontTopRight, frontTopLeft],
    [frontTopLeft, frontTopRight, frontBottomRight, frontBottomLeft],
    [frontTopRight, roofBackRight, sideBottomRight, frontBottomRight],
  ];

  const mesh = {
    name: `Building — ${safeDivisions} division${safeDivisions === 1 ? "" : "s"} per face`,
    vertices: [],
    quads: [],
  };
  const pointIndex = new Map();

  for (const corners of faces) {
    addSubdividedFace(mesh, pointIndex, corners, safeDivisions);
  }

  if (orientation === "left") {
    mesh.vertices = mesh.vertices.map((point) => ({ x: 1 - point.x, y: point.y }));
    mesh.quads = mesh.quads.map((quad) => [...quad].reverse());
  }

  mesh.vertices = mesh.vertices.map((point) => applyInset(point, inset));
  return mesh;
}

export function validateMesh(mesh) {
  if (!mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.quads)) {
    throw new Error("The generated mesh is missing vertices or quads.");
  }

  if (mesh.vertices.length < 3) {
    throw new Error("The mesh needs at least three vertices before it can be warped.");
  }
  if (mesh.quads.length < 1) {
    throw new Error("The mesh needs at least one triangle or quad before it can be warped.");
  }

  for (const point of mesh.vertices) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("A generated mesh point is not a finite coordinate.");
    }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      throw new Error("A generated mesh point falls outside the selected layer bounds.");
    }
  }

  for (const face of mesh.quads) {
    if (
      !Array.isArray(face) ||
      (face.length !== 3 && face.length !== 4) ||
      new Set(face).size !== face.length
    ) {
      throw new Error("Every mesh face must be a triangle or quad with distinct vertices.");
    }
    for (const index of face) {
      if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) {
        throw new Error("A mesh face refers to an invalid vertex.");
      }
    }
  }

  return true;
}

export function clonePoints(points) {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

export function mapMeshToRect(mesh, rectangle) {
  validateMesh(mesh);
  const width = rectangle.right - rectangle.left;
  const height = rectangle.bottom - rectangle.top;
  if (!(width > 0 && height > 0)) {
    throw new Error("The source layer does not have usable bounds.");
  }

  return {
    name: mesh.name,
    vertices: mesh.vertices.map((point) => ({
      x: rectangle.left + point.x * width,
      y: rectangle.top + point.y * height,
    })),
    quads: mesh.quads.map((quad) => [...quad]),
  };
}

export function validateProjectMesh(mesh) {
  if (
    !mesh ||
    !Array.isArray(mesh.sourceVertices) ||
    !Array.isArray(mesh.warpVertices) ||
    !Array.isArray(mesh.quads)
  ) {
    throw new Error("The saved warp is missing its mesh data.");
  }

  if (mesh.sourceVertices.length !== mesh.warpVertices.length) {
    throw new Error("The source and warp meshes do not have matching points.");
  }

  validateMesh({
    vertices: mesh.sourceVertices,
    quads: mesh.quads,
  });

  for (const point of mesh.warpVertices) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("A warp point is not a finite coordinate.");
    }
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      throw new Error("A warp point falls outside the document.");
    }
  }

  return true;
}
