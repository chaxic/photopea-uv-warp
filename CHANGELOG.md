# Changelog

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
