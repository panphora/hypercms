# hypercms changelog

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
