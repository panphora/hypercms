# hypercms changelog

## [0.8.1] - 2026-08-21

### Changed
- Synced package-lock.json with published dependency versions
- Updated hypercms



## [Unreleased]

### Changed
- License: relicensed to MIT-0 (MIT No Attribution). Same rights, attribution no longer required.

## [0.8.0] - 2026-08-19

### Added
- clay.upload API with embedding fallback and progress tracking

### Changed
- Update hypercms



## [0.7.2] - 2026-08-16

### Changed
- Sync ecosystem dependencies to latest versions
- Sync package-lock with published dependency versions

### Fixed
- Resolve context-@ leaf controls from their enclosing row



## [0.7.1] - 2026-08-14

### Added
- Nothing

### Changed
- Sync package-lock with published dependencies
- Update hypercms



## [0.7.0] - 2026-08-12

### Added
- Copy-to-clayjs delivery script

### Changed
- Renamed `clay.beforeSave` to `addDocumentTransform` in the platform
- Updated hypercms



## [0.6.2] - 2026-08-11

### Added
- `kind`, `status`, and `url` fields to the `hyper` key

### Changed
- Synced ecosystem dependencies to their latest versions



## [0.6.0] - 2026-06-18

### Added
- Named controls (checkbox, toggle, select, radio, textarea, number, chips) plus crop-on-upload

### Changed
- Bump mirk-interface dependency to 2.2.0 and regenerate theme and vendored mirk.js
- Restyle the file-remove button as a circular × with bevel and ring
- Migrate demos to the hyperclayjs smooth-sailing preset via symlink

### Fixed
- Point build-theme at the renamed mirk-interface and regenerate the theme
- Style the ?cms=true auto-open shell by deferring the fast-path a microtask
- Theme the comprehensive demo's custom templates with mirk classes



## [0.5.0] - 2026-06-07

### Added
- profile upload test page for hypercms
- auto-open the CMS on ?cms=true, toggling to cms=false on close
- opt-in @file/@image upload components
- component mocks demo and a sku field for pixel-quiet
- confirmRemove option for list item deletion
- corner delete button on pixel-quiet object-array cards
- real undo/redo in the Pixel Quiet demo
- @value/@checked CMS field edits are now recorded as undo steps

### Changed
- hypercms sidebar now renders in the Pixel Quiet look with real mirk components

### Fixed
- extension-noise.js symlink added next to the mutation symlink
- build-theme now walks up parent directories to find mirk-ui-kit
- mirk tag chips stay in a row when the tags box is the array slot

### Breaking Changes
- shell Save button now carries [trigger-save], dropping onSave/hcms:save wiring



## 0.2.0 — hardening pass (unreleased)

Response to the first round of code review. All criticals fixed, all should-fix items addressed, nice-to-haves shipped, demo and tests expanded.

- Apply-loop redesign: scalar commits skip the page snapshot entirely (preserves focus + selection on every keystroke); structural commits snapshot only non-shell page content for rollback safety
- Shell isolation helper (`withoutShell`) extracted to a shared module; used by both refresh and structural apply paths
- Form-rules selectors scoped by container path so nested object-arrays don't inflate parent extraction (e.g. extracting `products` no longer returns variant cards)
- Boolean coercion at form layer: `@checked` round-trip preserves `true`/`false` properly (engine stringifies; form unstringifies)
- Sortable callback uses a top-level global (`hypercmsCommit`) compiled via `new Function`, replacing the brittle inline dotted-path string
- `_commit` re-stamps sibling indices on every commit so drag-and-drop reorders settle to contiguous paths
- Fingerprint lifecycle: initialized on open, refreshed on refresh, so external-mutation-then-edit-back-to-prior commits as it should
- Rules tag re-read on refresh: livesync-swapped rules tags + template changes flow through; formRules re-derived every refresh
- Add/remove enforcement: `data-hcms-min-items` / `data-hcms-max-items` / `data-hcms-no-add` / `data-hcms-no-remove` block API calls and hide buttons at boundaries
- Slot validation: slotted templates without their slot (`.hcms-object-fields` / `.hcms-card-fields`) throw a clear authoring error
- mountTo nesting: shell can be mounted to any descendant of pageRoot; the walk-up helper finds the correct ancestor to detach for structural snapshots
- Prototype safety: `__proto__` / `constructor` / `prototype` rejected as rule keys; rules + sort containers use null-prototype objects
- Inline templates stamp per-field `data-hcms-path` so `api.setValue('products.0.name', ...)` targets them
- `buildItem` exported from form-builder; `onAdd` uses it so new cards have all their fields populated
- Style injection: per-document `WeakSet` replaces a module-level boolean; sibling-asset CSS resolution via `import.meta.url`; bundler can mark styles as bundled to suppress link
- API validation: `setValue` rejects non-leaf paths with a clear error; checkbox / radio / img.src / a.href targeted writes
- Action scoping: add/remove ignored outside form root; close/save ignored outside shell
- Focus on open / restore on close: shell takes focus on mount and returns it to the previously focused element on close
- Author diagnostics: warns on unmatched template paths and inline-field keys not in rule shape
- Demo: comprehensive coverage page exercising every shape, path-bound + inline templates, constraints, all API methods, live event log
- Test suite: 33 net new tests (66 → 99) targeting every fix above; cross-realm jsdom helper now refreshes class globals so hyper-morph's `instanceof HTMLInputElement` works across tests

## 0.1.0 — unreleased

Initial release. Live edit-in-place CMS sidebar for any HTML page with a hyper-html-api rules tag.

- Default template system: `@scalar`, `@object`, `@scalar-array`, `@object-array`, `@scalar-array-item`, `@object-array-item`
- Path-bound template overrides via `<template data-hcms-tpl="...">`
- Auto-derived form rules from page rules + templates
- Bidirectional sync: form ↔ engine.extract/apply ↔ page DOM
- Programmatic API: `getData`, `setValue`, `addItem`, `removeItem`, `refresh`
- Page MutationObserver with pause/resume for rollback safety
- Drag-to-reorder via hyperclayjs `[sortable]` custom-attribute
- Apply rollback with snapshot restore
- Right sidebar shell with focus trap and scroll lock
