# UV Warp for Photopea

UV Warp is a panel plugin that adds an editable, connected mesh warp workflow to Photopea. It renders the deformation inside the plugin instead of relying on Photopea's scripted Perspective Warp command.

**Current version:** v0.3.1

[Install the current version](https://chaxic.github.io/photopea-uv-warp/?v=0.3.1)

## Install

1. Open the [UV Warp installer page](https://chaxic.github.io/photopea-uv-warp/?v=0.3.1).
2. Download `uv-warp-photopea.json`.
3. In Photopea, choose **Window → Plugins → Add Plugin**.
4. Select the downloaded JSON file.

No Node.js, terminal, login, or backend is required to install or use the plugin.

## Workflow

1. Convert the source image to a Smart Object and select it.
2. Under **Source**, click **Capture selected** — only that layer is captured.
3. Optionally select another layer and click **Capture selected** under **Reference**, or **Load image**.
4. In **Layout**, use the **Pen** tool (RetopoFlow PolyPen–style) to grow and bridge mesh faces over the source. Click an existing point to weld onto it.
5. Switch to **Warp**, move matching points onto the reference, and toggle **Preview** / **Triangles** / **Connections**.
6. Click **Create output** to add the warped result to the PSD.

Use **Clear** under either bar to drop the captured source or reference without touching the PSD.

## Hotkeys

| Key | Action |
| --- | --- |
| `1` / `2` | Layout / Warp mode |
| `P` / `V` | Pen / Select tool |
| `E` | Live warp preview |
| `M` | Mesh lines |
| `T` | Triangles |
| `3` | Connection check |
| `F` | Fullscreen |
| `Esc` | Clear selection |
| `Del` | Delete selected points |
| Arrows | Nudge (hold `Shift` for 10 px) |
| `Ctrl`+`Z` | Undo (add `Shift` to redo) |

The plugin creates:

```text
UV Warp — Source [UVWP:id]
├─ UV Warp Result [id]
└─ UV Warp Data [id]  (hidden)
```

The original source is hidden, not modified. Use **On / off** to restore it. The hidden data layer stores the mesh so you can **Edit** a saved warp later.

## Features

- Separate Layout and Warp modes
- PolyPen-style contextual mesh creation and edge bridging
- Live piecewise-affine preview
- Shared draggable vertices and Shift multi-selection
- Arrow-key nudging; Shift + arrow for 10 px
- Undo and redo inside the editor
- Independent source and reference opacity
- Triangles overlay for warp diagnostics
- Connection check that pulls faces apart to reveal unwelded points
- Fullscreen mode for a larger canvas
- Full-document transparent PNG output
- PSD-backed editable project data
- Original / result on-off switch
- Responsive Photopea panel
- No login, backend, or file uploads

## Test locally

1. Install a current version of Node.js.
2. From this folder, run:

   ```bash
   npm run dev
   ```

   Or: `"C:\Program Files\nodejs\node.exe" scripts\serve.mjs`

3. In Photopea, choose **Window → Plugins → Add Plugin** and load `plugin.local.json` or `uv-warp-photopea-local.json`.
4. Open **UV Warp**, capture a Smart Object, and try the Pen tool.

Run the automated checks with:

```bash
npm test
npm run check
```

## Publish with GitHub Pages

The included production manifest expects:

- Repository: `https://github.com/chaxic/photopea-uv-warp`
- Panel: `https://chaxic.github.io/photopea-uv-warp/`

GitHub Pages serves the installer in a normal browser tab and the full plugin panel when the same URL is loaded inside Photopea. The downloadable production manifest is `uv-warp-photopea.json`.

## Implementation notes

Photopea's plugin API can execute scripts, retrieve PNGs with `Document.saveToOE("png")`, and insert an image into the current document with `App.open(url, null, true)`. UV Warp uses those documented interfaces for capture and output. The actual deformation is performed locally with a connected triangle renderer derived from the mesh faces.

This is intentionally not a native Smart Filter. Photopea does not expose reliable creation of custom Perspective Warp meshes through its documented scripting API. The plugin preserves editability by saving its mesh data in the PSD and keeping the source untouched.

## Licence

MIT © 2026 Steven Jurriaans
