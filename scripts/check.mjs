import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const requiredFiles = [
  "index.html",
  "styles.css",
  "src/app.js",
  "src/mesh.js",
  "src/warp.js",
  "src/photopea.js",
  "assets/icon.svg",
  "plugin.json",
  "plugin.local.json",
  "README.md",
  "LICENSE",
];

for (const relativePath of requiredFiles) {
  await readFile(resolve(root, relativePath));
}

const index = await readFile(resolve(root, "index.html"), "utf8");
const plugin = JSON.parse(await readFile(resolve(root, "plugin.json"), "utf8"));
const localPlugin = JSON.parse(await readFile(resolve(root, "plugin.local.json"), "utf8"));

for (const id of [
  "preset",
  "warp-canvas",
  "capture-source",
  "mode-layout",
  "mode-warp",
  "preview-toggle",
  "create-output",
  "status-card",
]) {
  if (!index.includes(`id="${id}"`)) throw new Error(`index.html is missing #${id}`);
}

for (const manifest of [plugin, localPlugin]) {
  if (!manifest.name || !manifest.url || !manifest.icon) {
    throw new Error("Each Photopea plugin manifest requires name, url, and icon.");
  }
}

const app = await readFile(resolve(root, "src/app.js"), "utf8");
const photopea = await readFile(resolve(root, "src/photopea.js"), "utf8");
for (const requirement of [
  "drawWarpedMesh",
  "createOutputLayerScript",
  "scanSavedWarps",
  "UVWP_DATA_V1:",
]) {
  if (!app.includes(requirement) && !photopea.includes(requirement)) {
    throw new Error(`The addon is missing required workflow marker: ${requirement}`);
  }
}

console.log(`Checked ${requiredFiles.length} addon files and both plugin manifests.`);
