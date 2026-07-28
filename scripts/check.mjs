import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "index.html",
  "styles.css",
  "installer.css",
  "installer.js",
  "src/app.js",
  "src/mesh.js",
  "src/warp.js",
  "src/photopea.js",
  "src/polypen.js",
  "src/islands.js",
  "src/templates.js",
  "assets/icon.svg",
  "plugin.json",
  "uv-warp-photopea.json",
  "plugin.local.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
];

for (const relativePath of requiredFiles) {
  await readFile(resolve(root, relativePath));
}

const index = await readFile(resolve(root, "index.html"), "utf8");
const plugin = JSON.parse(await readFile(resolve(root, "plugin.json"), "utf8"));
const installerPlugin = JSON.parse(
  await readFile(resolve(root, "uv-warp-photopea.json"), "utf8"),
);
const localPlugin = JSON.parse(await readFile(resolve(root, "plugin.local.json"), "utf8"));

for (const id of [
  "warp-canvas",
  "side-panel",
  "capture-source",
  "clear-source",
  "capture-reference",
  "load-reference",
  "clear-reference",
  "tool-pen",
  "tool-select",
  "triangles-toggle",
  "connections-toggle",
  "fullscreen-toggle",
  "source-opacity",
  "reference-opacity",
  "reference-tint-toggle",
  "reference-tint-color",
  "background-color",
  "mode-layout",
  "mode-warp",
  "preview-toggle",
  "create-output",
  "save-mesh",
  "islands-toggle",
  "raise-island",
  "mesh-templates",
  "save-template",
  "apply-template",
  "delete-template",
  "export-template",
  "import-template",
  "status-card",
]) {
  if (!index.includes(`id="${id}"`)) throw new Error(`index.html is missing #${id}`);
}

for (const manifest of [plugin, installerPlugin, localPlugin]) {
  if (!manifest.name || !manifest.url || !manifest.icon) {
    throw new Error("Each Photopea plugin manifest requires name, url, and icon.");
  }
}

for (const marker of [
  'id="install-page"',
  'id="plugin-app"',
  'href="./uv-warp-photopea.json"',
  'src="./?preview=1&v=0.3.15"',
]) {
  if (!index.includes(marker)) {
    throw new Error(`index.html is missing installer marker: ${marker}`);
  }
}

if (plugin.url !== installerPlugin.url || plugin.icon !== installerPlugin.icon) {
  throw new Error("The production and downloadable manifests must stay in sync.");
}

const app = await readFile(resolve(root, "src/app.js"), "utf8");
const photopea = await readFile(resolve(root, "src/photopea.js"), "utf8");
const polypen = await readFile(resolve(root, "src/polypen.js"), "utf8");
const templates = await readFile(resolve(root, "src/templates.js"), "utf8");
for (const requirement of [
  "drawWarpedMesh",
  "createOutputLayerScript",
  "scanSavedWarps",
  "UVWP_DATA_V1:",
  'saveToOE("psd")',
  "makeCloseTemporaryScript",
  "resolvePenAction",
  "bridgeEdges",
  "beginSourceCapture",
  "beginReferenceCapture",
  "clearReference",
  "toggleConnections",
  "toggleFullscreen",
  "drawReferenceLayer",
  "makeOutputNames",
  "restoreSavedReference",
  "originalLayerName",
  "setZoom",
  "resetZoom",
  "armOutputTimeout",
  "MAX_STATE_BYTES",
  "createOutputFinalizeScript",
  "beginOutputFinalize",
  "postPhotopeaBinary",
  "connectAcrossIntersections",
  "split-and-connect",
  "saveCurrentAsTemplate",
  "applySelectedTemplate",
  "fitMeshToBounds",
]) {
  if (!app.includes(requirement) && !photopea.includes(requirement) && !polypen.includes(requirement) && !templates.includes(requirement)) {
    throw new Error(`The addon is missing required workflow marker: ${requirement}`);
  }
}

console.log(`Checked ${requiredFiles.length} addon files and all plugin manifests.`);
