# hypercms changelog

## [0.11.5] - 2026-10-17

### Changed
- Updated ecosystem dependencies and package-lock to the latest published versions



## [0.11.4] - 2026-10-15

### Changed
- Updated content-dom.js and region-capabilities.js to match ClayJS

### Fixed
- A select with an excluded option now keeps its selection in the content view



## [0.11.3] - 2026-10-03

### Changed
- Updated ecosystem dependencies to their latest versions

### Fixed
- State copying now works for file, checkbox, and option inputs



## [0.11.2] - 2026-10-01

### Fixed
- A descendant's own region marker is now checked on the element itself in content-dom.js (synced from ClayJS)



## [0.11.1] - 2026-09-27

### Changed
- Build and test against hyper-morph 1.0
- Sync ecosystem dependencies to their latest versions
- Remove the staging-pantry check from the shared runtime test, since hyper-morph 1.0 moves kept nodes without a pantry



## [0.11.0] - 2026-09-19

### Added
- Inline CMS editor mode — edit list rows and text directly on the page
- Inline view — reorder, remove, and add list rows from the page
- Inline text editing in place with richclay
- Hover highlight, click routing, and a field popover for inline view
- Split button, view memory, and handoff to the sidebar
- Packed contract for generated theme styles, shipped in the package

### Changed
- Pin row strips inside their row, revealing them one at a time when they cannot fit
- Place the handle beside a small anchor instead of over it
- Keep the inline popover revealed and above the handles
- Improve toggle styling
- Sync package-lock to published dependencies

### Fixed
- Inline text now survives a live-sync morph
- The author's markup is preserved in the save clone and no longer rewritten when nobody edited
- Strip `hcms-session-open` from the save clone
- Undo no longer reverts a peer's edit, and session chrome stays off sync frames
- Put the caret where the person pressed
- The demo no longer loads two richclay runtimes
- Repair an editor whose element a morph left inert
- Thirty defects found across four rounds of review and browser testing



## [Unreleased]

## [0.12.0] - 2026-10-30

### Added
- `data-cms-view="inline"` on a page's CMS rules tag declares how the page is edited. Without it, the page opens in the sidebar.
- `cms.open({ view })` overrides the declared view, and `?cms=true` auto-open follows the declaration.
- `data-hcms-component:<prop>`, `data-hcms-options:<prop>` and `data-hcms-crop:<prop>` target the rule bound to that property and win over the plain attribute, so one element can carry several controlled rules. The plain attribute never applies to an `@--*` custom-property rule.
- A color picker for rules bound to `--color` or `--color-*`, or marked with `data-hcms-component:<prop>="color"`: swatches from the full Tailwind palette plus a custom picker, writing Tailwind's exact oklch value. `data-hcms-options` narrows it to swatches, hues, shades or literal colors and keeps the custom picker only with `"custom"`, and twelve or fewer swatches show inline. The current value stays visible and selected, and invalid custom input shows an error instead of writing.
- A font menu for rules bound to `--font` or `--font-*`, or marked with `data-hcms-component:<prop>="font"`: the 40 catalog families plus System, each shown in its own face. Picking one writes its full stack, and a stack that is not a catalog font shows as Current font and is never rewritten.
- The page's `link[data-hcms-fonts]` is derived from the font fields and recomputed after every commit, refresh and session start, so undo, live sync and outside edits all end with the right families loaded. It carries `no-undo` and is saved with the page.
- `hypercms/catalogs` exports the 286 Tailwind colors, 40 Google Fonts families with the axis request each supports, and `fontStack`, `fontFromStack` and `fontsHref`.
- A variant control: `data-hcms-component:<attr>="variant"` with `data-hcms-options` tokens like `"2:cols-2"` builds a native radio group of icon tiles. Choosing one writes only that attribute, so the page's own CSS does the layout. Icons come from a fixed catalog in code.
- `cms.hasRules()` tells a launcher whether the page declares CMS rules.
- HyperCMS exposes `prepare`, `quiesce` and `dispose` for ownership, and defers open and auto-open to ClayJS write admission. An upload or preview blocks exit.
- On a ClayJS page the Edit content button appears whenever the person may edit, in view or edit, and follows `clay.canEdit` as it changes. Pressing it switches to edit and opens the CMS, and it steps aside while ClayJS's menu is planned and returns if the menu fails to load.

### Changed
- The floating toggle now only opens and closes the editing view.
- The default page root is the whole document, so a rule on `html` or `body` such as `html@--color-accent` is read and written. Event payloads still use `<body>`.
- Style fields come first in the sidebar form. Color, font and variant fields bound to `html`, `body` or `:root` render together in a Page style group at the top, and style fields come before content fields inside every other group and list card. Data paths are unchanged.
- In the inline view, style fields are no longer hover or click targets and get no pencil. A section's style fields open from a Style chip in its top-left corner, a list row's from Style in its gear menu, and the page's from a Page style button in the bar, and each popover shows exactly that group's fields. Style, script, link and meta elements are never text targets.
- The fonts link keeps an existing entry for a family the catalog lacks and is left alone when it already loads the families in use, and author font links are never touched.
- `--font-size-*`, `--font-weight-*` and `--color-scheme` no longer get font or color pickers.

### Fixed
- Fields that share a key no longer overwrite each other. A repeated key is scoped by its `data-hcms-path`, exact outside a list and the part after the row inside one, with row indices as `*`. Unique keys keep their bare selector.
- A card's title and its links' titles no longer share a selector, and a template whose root is the input reads again.
- A plain object's inline template is found at its own path, so two objects with their own templates no longer read each other's fields.
- The Page style group no longer duplicates a root scalar rule or objects an inline template renders.
- A list row's variant control resolves when the template map is built.
- The color picker refuses a typed value that the engine's custom property check refuses, such as a function left unclosed.
- Bare rules (`@x` and `.`) address `<body>` as before.
- Arrow keys move through the row menu.

### Removed
- The toggle's arrow and view menu, and the remembered per-browser view choice.

## [0.11.6] - 2026-10-22

### Changed
- The floating edit button now takes the page's font and ink, and paints itself on
  an opaque surface picked for contrast against that ink, so it reads correctly on
  a dark hero, a dark footer, or a page whose text colour fights its own background.
- The button can be restyled with ordinary CSS: any `#hcms-toggle` rule of yours outranks
  ours. Its placement, stacking and surface are pinned against hostile page resets, so those
  go through `--hcms-toggle-bg`, `--hcms-toggle-offset` and `--hcms-toggle-z` instead;
  `position` is always `fixed`.

### Fixed
- On a screen narrower than 800px the button was positioned off the left edge while
  the CMS was open, because it shifted by the docked sidebar's width even though the
  sidebar was full-viewport there.
- The button's accessible name was frozen at "Toggle content editor" while it read
  "Edit content" or "Close editor", so speech input could not activate it and screen
  readers never heard it change state.
- The button no longer loses its position or its surface to a page that resets
  everything with `!important`, and no longer fails to appear on a page that already
  uses the id `hcms-toggle`.

## [0.10.0] - 2026-08-28

### Added
- Tests covering row identity

### Changed
- Synced ecosystem dependencies to their latest versions
- Updated hypercms

### Fixed
- Prevented stale dependencies from being used in vendor builds



## [0.9.0] - 2026-08-28

### Fixed
- Editing a field no longer rebuilds the row from a clone of the first row, so anything the row's markup carried that the rules do not describe survives an edit. Lists whose rows have one or two fields were affected on every keystroke.
- Removing or reordering a row now moves the row you acted on even when two rows read identically. The form supplies the page node each row came from, which the data alone cannot express.
- Reordering rows whose fields read identically now moves them. Such a reorder produces no change in the extracted data, so the unchanged-data guard used to skip it before the page was ever touched. That guard now applies to plain edits only, since a structural operation is never a no-op even when the data matches.

### Changed
- Requires `hyper-html-api` 0.7.0 or later, for the list hooks the above depends on. The hooks are optional in the engine, so an older engine would leave row identity silently inactive rather than failing.


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
