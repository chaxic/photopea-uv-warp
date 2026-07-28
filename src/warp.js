const EPSILON = 1e-8;

export function triangleArea(a, b, c) {
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

export function solveAffineTransform(source, target) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = target;
  const determinant =
    s0.x * (s1.y - s2.y) +
    s1.x * (s2.y - s0.y) +
    s2.x * (s0.y - s1.y);

  if (Math.abs(determinant) < EPSILON) return null;

  const inverse = [
    [(s1.y - s2.y) / determinant, (s2.y - s0.y) / determinant, (s0.y - s1.y) / determinant],
    [(s2.x - s1.x) / determinant, (s0.x - s2.x) / determinant, (s1.x - s0.x) / determinant],
    [
      (s1.x * s2.y - s2.x * s1.y) / determinant,
      (s2.x * s0.y - s0.x * s2.y) / determinant,
      (s0.x * s1.y - s1.x * s0.y) / determinant,
    ],
  ];

  const multiply = (values) => [
    inverse[0][0] * values[0] + inverse[0][1] * values[1] + inverse[0][2] * values[2],
    inverse[1][0] * values[0] + inverse[1][1] * values[1] + inverse[1][2] * values[2],
    inverse[2][0] * values[0] + inverse[2][1] * values[1] + inverse[2][2] * values[2],
  ];

  const x = multiply([d0.x, d1.x, d2.x]);
  const y = multiply([d0.y, d1.y, d2.y]);

  return {
    a: x[0],
    c: x[1],
    e: x[2],
    b: y[0],
    d: y[1],
    f: y[2],
  };
}

export function triangulateQuads(quads) {
  return quads.flatMap((face) => {
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

function expandTriangle(points, amount) {
  if (!amount) return points;
  const center = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };

  return points.map((point) => {
    const distance = Math.hypot(point.x - center.x, point.y - center.y) || 1;
    return {
      x: point.x + ((point.x - center.x) / distance) * amount,
      y: point.y + ((point.y - center.y) / distance) * amount,
    };
  });
}

export function drawWarpedMesh(
  context,
  sourceImage,
  sourceVertices,
  targetVertices,
  quads,
  { seamOverlap = 0.45 } = {},
) {
  const triangles = triangulateQuads(quads);
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  for (const triangle of triangles) {
    const source = triangle.map((index) => sourceVertices[index]);
    const target = triangle.map((index) => targetVertices[index]);
    if (
      Math.abs(triangleArea(source[0], source[1], source[2])) < EPSILON ||
      Math.abs(triangleArea(target[0], target[1], target[2])) < EPSILON
    ) {
      continue;
    }

    const transform = solveAffineTransform(source, target);
    if (!transform) continue;
    const clip = expandTriangle(target, seamOverlap);

    context.save();
    context.beginPath();
    context.moveTo(clip[0].x, clip[0].y);
    context.lineTo(clip[1].x, clip[1].y);
    context.lineTo(clip[2].x, clip[2].y);
    context.closePath();
    context.clip();
    context.setTransform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f,
    );
    context.drawImage(sourceImage, 0, 0);
    context.restore();
  }

  context.restore();
}

export function meshWarnings(sourceVertices, targetVertices, quads) {
  let degenerate = 0;
  let flipped = 0;

  for (const triangle of triangulateQuads(quads)) {
    const source = triangle.map((index) => sourceVertices[index]);
    const target = triangle.map((index) => targetVertices[index]);
    const sourceArea = triangleArea(source[0], source[1], source[2]);
    const targetArea = triangleArea(target[0], target[1], target[2]);
    if (Math.abs(sourceArea) < EPSILON || Math.abs(targetArea) < EPSILON) {
      degenerate += 1;
    } else if (Math.sign(sourceArea) !== Math.sign(targetArea)) {
      flipped += 1;
    }
  }

  return { degenerate, flipped };
}
