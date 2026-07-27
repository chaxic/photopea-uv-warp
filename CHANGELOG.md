# Changelog

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
