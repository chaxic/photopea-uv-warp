# UV Warp for Photopea

UV Warp is a panel plugin that adds an editable, connected mesh warp workflow to Photopea. It renders the deformation inside the plugin instead of relying on Photopea's scripted Perspective Warp command.

## Workflow

1. Convert the source image to a Smart Object and select it.
2. Click **Capture selected**. The panel captures the isolated source and the visible document underneath as an alignment reference.
3. In **Layout**, place the connected mesh over the source image.
4. In **Warp**, drag the corresponding points onto the reference.
5. Toggle **Preview** to compare the live result with the original.
6. Click **Create output** to add the warped image to the PSD.

The plugin creates:

```text
UV Warp — Source [UVWP:id]
├─ UV Warp Result [id]
└─ UV Warp Data [id]  (hidden)
```

The original source is hidden, not modified. The hidden data layer stores the source layout, warp points, topology, project identity, and editor settings in the PSD. Use the **Saved warp** menu to reopen and update it.

## Features

- Separate Layout and Warp modes
- Live piecewise-affine preview
- Connected building, regular grid, and custom grid meshes
- Shared draggable vertices and Shift multi-selection
- Arrow-key nudging; Shift + arrow for 10 px
- Undo and redo inside the editor
- Reference opacity and editor framing controls
- Focus mode for a larger canvas
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

3. In Photopea, choose **Window → Plugins → Add Plugin** and load `plugin.local.json`.
4. Open **UV Warp (Local)**.
5. Open a PSD, select a Smart Object, and click **Capture selected**.

Run the automated checks with:

```bash
npm test
npm run check
```

## Publish with GitHub Pages

The included production manifest expects:

- Repository: `https://github.com/chaxic/photopea-uv-warp`
- Panel: `https://chaxic.github.io/photopea-uv-warp/`

Enable GitHub Pages from the repository root, then load the hosted `plugin.json` through Photopea's plugin window.

## Implementation notes

Photopea's plugin API can execute scripts, retrieve PNGs with `Document.saveToOE("png")`, and insert an image into the current document with `App.open(url, null, true)`. UV Warp uses those documented interfaces for capture and output. The actual deformation is performed locally with a connected triangle renderer derived from the visible quad mesh.

This is intentionally not a native Smart Filter. Photopea does not expose reliable creation of custom Perspective Warp meshes through its documented scripting API. The plugin preserves editability by saving its mesh data in the PSD and keeping the source untouched.

## Licence

MIT © 2026 Steven Jurriaans
