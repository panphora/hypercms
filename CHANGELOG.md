# hypercms changelog

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
