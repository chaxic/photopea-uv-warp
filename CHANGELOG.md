# Changelog

## [0.2.1] - 2026-07-27

### Fixed

- Capture no longer hangs on "Capturing source…" by using the PSD-snapshot temporary-document workflow instead of duplicating or mutating the live workfile.
- Capture messaging now follows Photopea's async protocol: request IDs, stage progress, `"done"` handling, timeouts, and out-of-order buffer delivery.

### Changed

- Local test builds show a `v0.2.1 LOCAL` badge when served from `127.0.0.1`.

## [0.2.0] - 2026-07-27

### Added

- Initial public UV Warp panel with layout/warp modes, live preview, PSD-backed project data, and GitHub Pages installer.
