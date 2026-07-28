import { clonePoints, validateProjectMesh } from "./mesh.js";
import { ensureEdges } from "./polypen.js";

export const TEMPLATE_SCHEMA = "UVWP_TEMPLATE_V1";
export const STORAGE_KEY = "uvwarp.templates.v1";
export const MAX_TEMPLATES = 50;

/** In-memory storage for tests (and environments without localStorage). */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function defaultStorage() {
  if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  throw new Error("Template storage is unavailable in this environment.");
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneMesh(mesh) {
  validateProjectMesh(mesh);
  return {
    name: mesh.name || "Custom mesh",
    warpLinked: Boolean(mesh.warpLinked),
    quads: mesh.quads.map((face) => [...face]),
    edges: ensureEdges(mesh.quads, mesh.edges).map((edge) => [...edge]),
    islandOrder: Array.isArray(mesh.islandOrder) ? [...mesh.islandOrder] : [],
    sourceVertices: clonePoints(mesh.sourceVertices),
    warpVertices: clonePoints(mesh.warpVertices),
  };
}

function pointBounds(points) {
  if (!points?.length) {
    return { left: 0, top: 0, right: 1, bottom: 1 };
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  if (!(right > left) || !(bottom > top)) {
    return { left: 0, top: 0, right: 1, bottom: 1 };
  }
  return { left, top, right, bottom };
}

function mapPoint(point, from, to) {
  const fromWidth = from.right - from.left;
  const fromHeight = from.bottom - from.top;
  const toWidth = to.right - to.left;
  const toHeight = to.bottom - to.top;
  return {
    x: to.left + ((point.x - from.left) / fromWidth) * toWidth,
    y: to.top + ((point.y - from.top) / fromHeight) * toHeight,
  };
}

/** Fit layout AABB into bounds; apply the same transform to layout and warp. */
export function fitMeshToBounds(mesh, bounds) {
  const cloned = cloneMesh(mesh);
  if (
    !bounds ||
    !(bounds.right > bounds.left) ||
    !(bounds.bottom > bounds.top)
  ) {
    throw new Error("The source layer does not have usable bounds.");
  }
  const from = pointBounds(cloned.sourceVertices);
  return {
    ...cloned,
    sourceVertices: cloned.sourceVertices.map((point) => mapPoint(point, from, bounds)),
    warpVertices: cloned.warpVertices.map((point) => mapPoint(point, from, bounds)),
  };
}

export function meshToTemplate(mesh, name, { id = null, createdAt = null } = {}) {
  const now = new Date().toISOString();
  const trimmed = String(name || "").trim() || "Untitled template";
  return {
    schema: TEMPLATE_SCHEMA,
    id: id || newId(),
    name: trimmed,
    createdAt: createdAt || now,
    updatedAt: now,
    mesh: cloneMesh(mesh),
  };
}

export function normalizeTemplate(raw) {
  if (!raw || raw.schema !== TEMPLATE_SCHEMA) {
    throw new Error("This file is not a UV Warp mesh template.");
  }
  if (!raw.id || !raw.name) {
    throw new Error("The template is missing a name or id.");
  }
  const mesh = cloneMesh(raw.mesh);
  return {
    schema: TEMPLATE_SCHEMA,
    id: String(raw.id),
    name: String(raw.name).trim() || "Untitled template",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    mesh,
  };
}

export function serializeTemplate(template) {
  return JSON.stringify(normalizeTemplate(template), null, 2);
}

export function serializeLibrary(templates) {
  return JSON.stringify({
    schema: "UVWP_TEMPLATE_LIBRARY_V1",
    version: 1,
    templates: templates.map((entry) => normalizeTemplate(entry)),
  }, null, 2);
}

/** Accept a single template, a library object, or a bare template array. */
export function parseTemplateFile(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (Array.isArray(data)) {
    return data.map((entry) => normalizeTemplate(entry));
  }
  if (data?.schema === "UVWP_TEMPLATE_LIBRARY_V1" && Array.isArray(data.templates)) {
    return data.templates.map((entry) => normalizeTemplate(entry));
  }
  if (data?.schema === TEMPLATE_SCHEMA) {
    return [normalizeTemplate(data)];
  }
  throw new Error("Unrecognized template JSON. Export a template from UV Warp and try again.");
}

export function loadLibrary(storage = defaultStorage()) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.templates)) return [];
    return data.templates.map((entry) => normalizeTemplate(entry));
  } catch (_) {
    return [];
  }
}

function saveLibrary(templates, storage = defaultStorage()) {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    templates: templates.map((entry) => normalizeTemplate(entry)),
  }));
}

export function listTemplates(storage = defaultStorage()) {
  return loadLibrary(storage).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function getTemplate(id, storage = defaultStorage()) {
  return loadLibrary(storage).find((entry) => entry.id === id) || null;
}

export function upsertTemplate(template, storage = defaultStorage()) {
  const next = normalizeTemplate(template);
  const library = loadLibrary(storage);
  const index = library.findIndex((entry) => entry.id === next.id);
  if (index >= 0) {
    next.createdAt = library[index].createdAt || next.createdAt;
    library[index] = next;
  } else {
    if (library.length >= MAX_TEMPLATES) {
      throw new Error(`Template library is full (${MAX_TEMPLATES} max). Delete one before saving.`);
    }
    library.push(next);
  }
  saveLibrary(library, storage);
  return next;
}

export function deleteTemplate(id, storage = defaultStorage()) {
  const library = loadLibrary(storage);
  const next = library.filter((entry) => entry.id !== id);
  if (next.length === library.length) return false;
  saveLibrary(next, storage);
  return true;
}

/**
 * Merge imported templates into the library.
 * Existing ids get fresh ids so imports never overwrite silently.
 */
export function importTemplates(templates, storage = defaultStorage()) {
  const imported = [];
  for (const entry of templates) {
    const normalized = normalizeTemplate(entry);
    const existing = getTemplate(normalized.id, storage);
    const id = existing ? newId() : normalized.id;
    imported.push(upsertTemplate({
      ...normalized,
      id,
      createdAt: existing ? new Date().toISOString() : normalized.createdAt,
      updatedAt: new Date().toISOString(),
    }, storage));
  }
  return imported;
}
