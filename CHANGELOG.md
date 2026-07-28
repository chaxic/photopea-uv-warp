# Changelog

## [0.3.13] - 2026-07-28

### Fixed

- Holding **Ctrl** while drawing now switches the Line/Face toggle UI to Line (with a temporary highlight) and restores Face when released.
- Line/Face controls sit in a cluster immediately beside Draw/Select.

## [0.3.12] - 2026-07-28

### Added

- **Face / Line** draw modes: Face (default) auto-creates triangles/quads when drawn edges close a loop; Line keeps knife-only cuts. Hold **Ctrl** while drawing for temporary Line mode.
- **Select** can click a face; **Del** removes the face and keeps its points and lines.
- Marquee drag in Select mode to box-select points (Shift adds to the selection).

### Fixed

- Closing three edges into a triangle now creates a face in Face mode.

## [0.3.11] - 2026-07-28

### Fixed

- Draw hover now shows the yellow point indicator on the target edge when drawing/cutting from a selected point (not only when inserting a point with nothing selected).

## [0.3.10] - 2026-07-28

### Added

- Mesh stores drawable `edges` so knife cuts and open lines persist independently of faces.

### Changed

- **Draw**: clicking a line with nothing selected inserts a point only (no auto-connect).
- **Draw**: with a point selected, clicking draws/cuts along that path; faces split only along the cut (no auto-diagonals).
- **Select**: clicking a line selects the line alone (not both endpoints).
- **Delete**: with a line selected, removes that line and keeps its endpoints.

## [0.3.9] - 2026-07-28

### Changed

- **Draw** tool: clicking a line inserts a point on it (instead of only selecting the line).
- Drawing from a selected point connects with a line; crossings with existing lines become weld points.
- Selecting a point and clicking a line both inserts the point and connects to it.

## [0.3.8] - 2026-07-28

### Changed

- Removed the Insert mode dropdown. Draw always uses Tri / Quad.
- Preview hotkey is now `P` (was `E`).

## [0.3.7] - 2026-07-28

### Fixed

- **Create output** no longer hangs after creating the UV Warp group. Photopea stalls on `Layer.move(..., INSIDE)` after a cross-document duplicate; the warped layer is now duplicated straight into the group instead.

## [0.3.6] - 2026-07-28

### Fixed

- **Create output** no longer hangs on “Sending output to Photopea…”. The warped PNG is sent as a binary file, then a small follow-up script adds the `[Original]` / `[Warped]` layers. Embedding a multi-megabyte data URL in one script was stalling Photopea (worse after v0.3.3’s larger saved state).

## [0.3.5] - 2026-07-27

### Fixed

- **Create output** no longer hangs. Saved warps stored a full copy of the reference image in the PSD text layer, which made the Photopea script large enough to stall silently.
- Create output now reports a real error instead of spinning forever if Photopea never confirms the result.

### Added

- Adjustable zoom: `+` / `-` to zoom, `0` to reset to fit, scroll wheel to zoom at the pointer.
- Pan the view with `Space`+drag or a middle-mouse drag. The canvas badge shows the current zoom level.

### Changed

- Editing a saved warp re-captures the reference layer from the PSD instead of restoring a stored copy, so the reference is sharper. A reference added with **Load image** is not stored in the PSD and must be loaded again.

## [0.3.4] - 2026-07-27

### Changed

- Renamed the **Pen** tool to **Draw**. Hotkeys are now `D` Draw, `S` Select, and `C` Connections (was `P` / `V` / `3`).

## [0.3.3] - 2026-07-27

### Added

- Editable **Background** colour for the editor canvas.
- Saved warps store reference info so **Edit** reloads both the source and the reference automatically.

### Changed

- **Create output** appends `[Original]` to the source layer name (pixels unchanged) and names the result `{same name} [Warped]`.
- Output instructions updated for the new naming and the Edit → restore flow.

## [0.3.2] - 2026-07-27

### Added

- **Reference tint** overlay toggle with an editable color swatch so the reference can contrast against the source.
- Panel section **Output layers & editing later** explaining what each layer is for and how to reopen a finished warp.

### Changed

- Workflow copy no longer mentions RetopoFlow / PolyPen.
- New outputs use clearer layer names: `UV Warp · … [UVWP:id]`, `Warped Output [id]`, and `Mesh Data — do not edit [id]`. Existing saved warps keep their previous names so updates still find them.

## [0.3.1] - 2026-07-27

### Added

- **Connections** toggle (`3`): faces pull apart so you can see which points are welded — green links are shared points, amber marks single-face points and open edges, red rings are loose points.
- **Clear** buttons for the captured source and the reference.
- Tool hotkeys: `1`/`2` modes, `P`/`V` tools, `E` preview, `M` mesh, `T` triangles, `3` connections, `F` fullscreen, `Esc` clear selection. A hotkey list is in the panel.

### Changed

- Reference **Capture selected** now captures the layer you have selected in Photopea, isolated the same way as the source, instead of everything underneath it.
- **Focus** is now **Fullscreen**.
- The Pen tool welds onto an existing point when you click one, rather than stacking a duplicate point on top of it, and points have a wider catch radius than edges.
- Selected points are drawn with an amber ring and halo, and the point under the cursor is highlighted.

### Fixed

- The panel no longer overlaps the Source and Reference bars at wide window sizes, which hid the source summary. Both now live in one scrolling sidebar.
- The editor keeps a usable height at narrow and short window sizes, and the toolbar wraps instead of clipping.

## [0.3.0] - 2026-07-27

### Added

- PolyPen-style mesh creation in Layout: contextual vertex/edge/triangle/quad growth, edge bridging, snap, and hover preview.
- Separate **Capture reference** and **Load image** for the alignment backdrop (source capture is source-only).
- Source and reference opacity sliders.
- **Triangles** toggle showing the warp triangulation diagonals.
- Pen / Select tools and insert modes (Tri/Quad, Quad strip, Edge only, Vertex only).

### Changed

- Removed mesh templates, Face divisions, Visible side, and Editor view padding. The editor always shows the full document.
- New captures start with a single quad over the source bounds; topology is edited with the Pen tool.
- Project schema version is now 2 (v1 saved warps still load).

### Fixed

- Capture no longer composites other layers into the source image.

## [0.2.1] - 2026-07-27

### Fixed

- Capture no longer hangs on "Capturing source…" by using the PSD-snapshot temporary-document workflow instead of duplicating or mutating the live workfile.
- Capture messaging now follows Photopea's async protocol: request IDs, stage progress, `"done"` handling, timeouts, and out-of-order buffer delivery.

### Changed

- Local test builds show a `v0.2.1 LOCAL` badge when served from `127.0.0.1`.

## [0.2.0] - 2026-07-27

### Added

- Initial public UV Warp panel with layout/warp modes, live preview, PSD-backed project data, and GitHub Pages installer.
