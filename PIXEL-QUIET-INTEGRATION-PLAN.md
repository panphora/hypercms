# Pixel Quiet × hypercms — integration (as-built record)

**Status: SHIPPED in the working tree, not committed, not published.** All five phases are done,
tested, and browser-verified. hypercms renders its edit-in-place sidebar in the **Pixel Quiet**
look using **real mirk-interface components**, with **mirk.js** wired so the components behave, all
scoped so nothing leaks onto the host page.

- Tests: **158 node + 31 browser, 0 failures.** Build clean.
- Verified live in agent-browser (see Verification) in both light and OS-dark.
- Publishes for hyperclayjs / `@panphora/hyper-cms` remain parked on the `/_/` deploy (project memory).

Goal restated: the Pixel Quiet mockup (`cms-sidebar/pixel-quiet/index.html`) is static, hand-authored
HTML. hypercms *generates* its form from a page's rules plus templates and binds/saves it. This work
bridged the two: the engine emits mirk markup, the shell adopts the pixel-quiet geometry, and the
bundled shell CSS became scoped mirk plus the pixel-quiet token retune.

Sources: look = `cms-sidebar/pixel-quiet/{index.html,overrides.css}`; class mapping + rationale =
`cms-sidebar/cms-sidebar-plan.md`; the phase roadmap that asked for this = `cms-sidebar/pixel-quiet-plan.md` (Phase 4).

## What shipped

A scoped mirk theme pipeline (mirk stays the single source of truth, regenerated at build time and
scoped to `.hcms-shell`), a pixel-quiet shell geometry (scroll-away header, condensed minibar,
in-flow Save, `mirk-button` close/save), mirk-markup default field templates (every `data-hcms-*`
binding hook preserved), a vendored and guarded mirk.js runtime, and a canonical demo page that
drives all of it through real hypercms.

## Files created / modified

| Path | New / Modified | Role |
|---|---|---|
| `scripts/build-theme.js` | new | CSS scoping transform + mirk.js vendoring; generates the two files below |
| `src/theme.generated.css` | new (generated, 1011 lines) | scoped mirk@2.0.1 (lines ~5–605) + pixel-quiet overrides (~606+); the shipped shell CSS |
| `src/theme/pixel-quiet.overrides.css` | new (source) | hypercms-owned token retune + panel geometry, authored on `.hcms-*` hooks |
| `src/vendor/mirk.vendor.js` | new (generated) | vendored mirk.js runtime, guarded for non-browser realms |
| `src/hypercms-bundle.js` | modified | imports `theme.generated.css` (text) + `mirk.vendor.js` (side effect) instead of `styles.css` |
| `src/shell.js` | modified | `mountShell` rewritten to pixel-quiet bands + minibar scroll + `title`/`eyebrow`/`theme` options; fallback link repointed to the generated theme |
| `src/templates.js` | modified | `DEFAULT_TEMPLATES` rewritten as mirk markup |
| `src/hypercms.js` | modified | `open()` threads `title`/`eyebrow`/`theme` to `mountShell` |
| `package.json` | modified | `build:theme` script; `build` runs it first; `./styles.css` + new `./theme.css` exports point at the generated theme |
| `demo/pixel-quiet.html` | new | canonical Page-settings form driven by real hypercms |
| `test-node/theme-generated.test.js` | new (8) | locks the scoping invariants |
| `test-node/mirk-markup.test.js` | new (4) | locks the default templates' mirk output |
| `test-node/shell.test.js` | modified (+3 new, 1 changed) | pixel-quiet geometry, dark pin, custom title/eyebrow; title assertion now "Page content" |
| `test-browser/pixel-quiet.test.js` | new (12) | render + full functional contract |
| `src/styles.css` | untouched | **now orphaned** (no imports anywhere); kept in place, removal is a follow-up |

## The hard problem: scoping mirk to the shell

`mirk.css` styles a whole document: `:root` tokens plus `background`/`color`, `body { font-family }`,
`*, ::before, ::after { box-sizing }`, and an `@font-face` with a **relative** font URL. hypercms
injects a sidebar into an arbitrary host page, so raw mirk would repaint the host body, change its
box model, and fail to load the font. mirk had to be scoped to `.hcms-shell`.

Approach: **generate a scoped copy of mirk at build time** so `mirk-ui-kit/mirk.css` stays the single
source of truth and there is zero drift. Chosen over `@scope` / Shadow DOM for broad browser
compatibility and zero change to hypercms's light-DOM event-delegation architecture.

## Theme pipeline (`scripts/build-theme.js`)

`npm run build:theme` runs the script, which writes **both** `src/theme.generated.css` and
`src/vendor/mirk.vendor.js`. `npm run build` runs `build:theme` first, then esbuild bundles
`src/hypercms-bundle.js` with `--loader:.css=text` so the theme text is inlined into the dist IIFE.
`theme-generated.test.js` asserts the generator is deterministic (regenerating yields identical bytes).

Constants in the script: `SCOPE = '.hcms-shell'`, `MIRK_VERSION = '2.0.1'`, `FONT_CDN` (the absolute
jsDelivr font URL). `transformBlock()` is a small token-aware CSS walker that recurses through
`@layer` / `@media` / `@supports` / `@scope` and leaves `@font-face` / `@keyframes` selectors alone.

`scopeOne()` classifies each selector into exactly three buckets:

1. **Root** (`:root`, `body`, `html`) becomes `.hcms-shell`.
2. **Theme flag** (`.light`, `.dark`, `[data-theme…`) concatenates onto the shell, e.g. `.hcms-shell.dark`.
3. **Descendant** (everything else, e.g. `.mirk-input`, `*`, `button`) is prefixed `.hcms-shell ` (a space).

`rewriteFontFace()` replaces the relative `…DepartureMono-Regular.woff2` URL with
`https://cdn.jsdelivr.net/npm/mirk-interface@2.0.1/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2`,
so the font loads from any host. After the scoped mirk, the script appends
`src/theme/pixel-quiet.overrides.css` (authored against `.hcms-shell`, not the mockup's compare-harness
selectors), so plain overrides win over mirk's `@layer components` with zero `!important`.

Gotchas for future maintainers: `rewriteFontFace()` keys on the filename, so renaming the font in
mirk silently leaves the URL unrewritten; the `[data-theme` match uses `startsWith` (no word
boundary); the `.light`/`.dark` match uses `\b`.

## Shell geometry (`src/shell.js`)

`mountShell({ mountTo, side='right', overlay=false, showSaveButton=false, title='Page content',
eyebrow='Edit', theme=null, doc })`. `open()` threads `title`/`eyebrow`/`theme` through from its opts.

Root element: `<div data-hcms-shell save-remove save-ignore tabindex="-1" role="dialog"
aria-modal="true" aria-labelledby="{titleId}">`, class
`hcms-shell pixel-quiet hcms-side-{side}` plus optional ` hcms-overlay` and a theme class
(`''` / ` dark` / ` light`). `theme=null` follows the OS via `prefers-color-scheme`.

Structure:

- `.hcms-shell-minibar` (`aria-hidden`): minibar title + a `mirk-button` close, revealed on scroll.
- `.hcms-shell-body` (the scroll region) holds:
  - `<header class="hcms-shell-header">` with `.hcms-shell-heading` (`.hcms-shell-eyebrow` +
    `h2.hcms-shell-title#{titleId}`) and a `mirk-button` close.
  - `.hcms-shell-error[role=alert][hidden]`.
  - `<div data-hcms-form-root class="hcms-form">` (the engine fills this).
  - `<footer class="hcms-shell-footer">` (in-flow, after the form), with a `mirk-button` Save,
    `hidden` unless `showSaveButton`.

Close and Save carry `data-hcms-action="close"` / `"save"` and a `<span class="mirk-button__label">`.
`title`/`eyebrow` are HTML-escaped (`escapeHtml`). `installCondenseOnScroll` adds a passive `scroll`
listener on `.hcms-shell-body` that toggles `.is-condensed` on the root once `scrollTop` passes
`header.offsetHeight - 12`; it returns `{ detach() }` and is cleaned up in `destroy()`.

Preserved behavior: focus trap, dialog ARIA, `destroy()` (detaches trap + scroll listener, removes the
root and the body chrome classes), and `restoreChrome()` / `reensureStyles()` (re-assert the
stylesheet and body classes after a full-document morph, since the `<style>` lives in `<head>` and the
chrome classes on `<body>`, both outside the save-ignore shell subtree). `ensureStyles` injects a
`<style id="hcms-shell-styles" save-remove>` from `installStyles` text, or falls back to a `<link>` to
`./theme.generated.css` via `import.meta.url`.

## Default templates → mirk markup (`src/templates.js`)

`DEFAULT_TEMPLATES` rewritten so the generated form is pixel-quiet out of the box, with every
`data-hcms-*` hook intact (shape, label, field, action, the `.hcms-array-items` / `.hcms-card-fields`
slots, the `.hcms-error` inline slots), so extract / apply / add / remove / reorder are unchanged.

- `@scalar`: `label.hcms-field` > `.hcms-label` + `input.mirk-input` + `.hcms-error`.
- `@object`: `section.hcms-object` > `h3.hcms-object-title` + `.hcms-object-fields` slot + error.
- `@scalar-array`: `section.hcms-array.hcms-scalar-array` > header/title + `ul.hcms-array-items` slot +
  error + a `.hcms-add.mirk-button.mirk-button--small` add button.
- `@scalar-array-item`: `li.hcms-array-item[draggable]` > `input.mirk-input` + sr-only move buttons +
  `.hcms-remove` (×) + error.
- `@object-array`: `section.hcms-array.hcms-object-array.hcms-array--cards` (note the extra
  `hcms-array--cards` class, scalar-array does not get it) > header/title + `.hcms-array-items` slot +
  error + add button.
- `@object-array-item`: `article.hcms-card.mirk-sortable__item[draggable]` > `SORTABLE_GRIP` +
  `.hcms-card-body.mirk-sortable__body` (wrapping the `.hcms-card-fields` slot + a `.hcms-card-controls`
  row of move/remove buttons) + `.hcms-error`. The error sits **outside** the card body, at article
  level. `SORTABLE_GRIP` renders exactly **8** `.mirk-sortable__dot` spans inside
  `.hcms-drag-handle.mirk-sortable__grip`.

`templates.test.js` and `form-builder.test.js` were **not** modified: they query the preserved hooks
and stayed green untouched. New template coverage lives in `mirk-markup.test.js`.

## mirk.js runtime (`src/vendor/mirk.vendor.js`)

The vendored copy is wrapped by the build script in `if (typeof window !== "undefined" && typeof
document !== "undefined") { … }`, so it is import-safe in Node (mirk.js references `window`/`document`
as bare globals). It keeps mirk's own `if (window.__mirk) return` idempotency. The bundle entry imports
it for its side effect, so the delegated component runtime installs when hypercms loads in the browser.

## Theme overrides (`src/theme/pixel-quiet.overrides.css`)

- **Tokens:** light block on `.hcms-shell.pixel-quiet`; a dark block on
  `.hcms-shell.pixel-quiet.dark, …[data-theme="dark"]`; and an auto-dark
  `@media (prefers-color-scheme: dark)` block guarded by `:not(.light):not([data-theme="light"])`. The
  dark token set is written in both the explicit block and the media block (CSS has no mixins).
- **Geometry:** fixed dock, `width: 380px`, `z-index: 2147483000`, right-docked by default; a
  `.hcms-side-left` variant flips to the left edge; `body.hcms-open` push padding (380px) for non-overlay
  mode; overlay locks body scroll; a `max-width: 799px` breakpoint goes full-width with no push padding.
- **Chrome:** minibar reveal via `opacity` + `translateY(-100%)` transition (140ms / 160ms); the
  eyebrow/title header; the form rhythm (26px gaps); cards (`.hcms-card.mirk-sortable__item`) with
  borderless inner fields so the engine's child `.hcms-field`s read as quiet sortable rows; a shared
  `.hcms-remove` × control; the error banner; and the sr-only move buttons (visible on keyboard focus).

## Demo (`demo/pixel-quiet.html`)

The canonical "Page settings" field set via a `data-rules-name="cms"` JSON block: `title`, `tagline`,
`bio`, `published`, `priority`, `color`, `tags` (`ul.tags li[]`), `products` (object-array). Title,
tagline, and products ride the mirk defaults. Per-field mirk templates: `bio` → `mirk-textarea`,
`published` → `mirk-toggle`, `priority` → `mirk-select`, `color` → `mirk-radio`, `tags` → mirk chips.

**Tags chips, wired through the scalar-array machinery:** the container template makes
`.hcms-array-items` itself the `.mirk-tags` box, kept a **direct child** of the path node so the
engine's `> .hcms-array-items > [item]` selector resolves; the `tags.*` item template is a
`.mirk-tags__chip[data-hcms-array-item]` holding an inline-editable `.pq-chip-field[data-hcms-field]`
(CSS `field-sizing: content`) plus a `.hcms-remove[data-hcms-action="remove"]`; a `+ tag`
`mirk-button[data-hcms-action="add"]` adds chips. All add / remove / reorder / edit route through the
standard hooks.

`?theme=light|dark` URL param pins the panel for showcasing; otherwise it follows the OS.

**Gotcha — the no-op `window.hyperclay.Mutation` stub:** hypercms's change observer requires
`window.hyperclay.Mutation`. The demo provides a no-op stub (all `on*` return an empty unsubscribe;
`pause`/`resume` are no-ops) for two reasons: (1) the real hyperclayjs utility imports
`./extension-noise.js`, which 404s when served from `demo/` (it resolves relative to the served URL,
not the symlink target); (2) a `document.body`-observing shim caused a refresh loop, because hypercms's
form rebuild mutates the shell, which the observer then re-triggers. The demo edits flow form → page →
save, which do not need the observer, so the stub is sufficient. It must stay until those two issues
are addressed.

## Tests

- `test-node/theme-generated.test.js` (**8**): generated theme exists and is non-trivial; mirk
  components scoped under `.hcms-shell`; `:root`/`body`/universal bound to the shell, not the page; no
  unscoped `body{`/`:root`; theme flags concatenate; `@font-face` URL is the absolute CDN; pixel-quiet
  tokens + geometry present and scoped; vendored runtime guarded; generator is deterministic.
- `test-node/mirk-markup.test.js` (**4**): default scalar renders a bound `.mirk-input`; scalar-array
  add button is a `mirk-button` and items use `.mirk-input`; object-array item is a
  `.mirk-sortable__item` card with an 8-dot grip + body slot; add button still toggles via constraint
  visibility (action hook preserved).
- `test-node/shell.test.js` (**11**, +3 new, 1 changed): new pixel-quiet geometry (minibar, scroll
  body, `mirk-button` close/save), dark theme pin, custom title/eyebrow; the dialog-ARIA assertion now
  resolves `aria-labelledby` to title text "Page content".
- `test-browser/pixel-quiet.test.js` (**12**): a render block (pixel-quiet shell + `mirk-button`
  close/save + minibar; default scalars are `mirk-input`; toggle/select/radio/chips; sortable cards
  with 8 dots; hydration of toggle/select/radio from the page) and a binding block (edit a scalar →
  page; toggle flips an attr; select writes an attr; remove a tag drops the page `li`; add a product
  appends a card + a page product; reorder reorders the page; Save fires `hcms:save` with the full data).

Totals: `npm run test:node` → **158 pass, 0 fail**; `npm run test:browser` → **6 files, 31 pass, 0 fail**.
The full existing suite stayed green (no regressions).

## Verification (agent-browser, invisible local browser)

On `demo/pixel-quiet.html`: the sidebar mounted with all components; editing Title updated the page
`<h1>`; the toggle flipped `data-published` to `false`; the select wrote `data-priority="high"`;
removing a tag dropped the page list to `bar,baz`; adding a product appended a third card and page
product; move-up reordered to `Gadget,Widget`; Save fired `hcms:save` with all field keys. The panel
rendered correctly in both **light** (pinned) and **OS-dark** (auto). Critically, the **host page kept
its own sans-serif font and background**, proving mirk did not leak: scoping holds. Departure Mono
loaded from the CDN.

## Decisions (as-built)

1. **Pixel Quiet is the look, not a toggle.** The shell always carries `pixel-quiet`; the generated
   theme is the only shell stylesheet.
2. **Dark = `.dark` opt-in + `prefers-color-scheme`.** Default light; `open({ theme:'dark' })` pins
   dark; the media block auto-flips on OS dark unless `.light`/`[data-theme="light"]` pins light.
3. **Tags = inline-editable mirk chips via the scalar-array machinery** (add/remove/reorder/edit all
   wired). The default `@scalar-array` template is a plain mirk list; chips are a per-page treatment.
   "Type + Enter to add" through mirk.js's own tag handler is a deferred follow-up.
4. **Generate, do not hand-copy, the scoped mirk CSS**, so mirk stays the single source of truth.
5. **No publish.** Built + tested locally. hyperclayjs / `@panphora/hyper-cms` publishes remain parked
   on the `/_/` deploy per project memory.

## Open follow-ups

- **Tags "type + Enter to add"** through mirk.js's chip handler, bridged to hypercms's data model.
- **Remove the orphaned `src/styles.css`** (no imports remain; the `./styles.css` export now points at
  the generated theme). Left in place for now to avoid deleting a checked-in source file unasked.
- **Demo Mutation stub** must remain until the `extension-noise.js` resolution path and the
  body-observer refresh loop are solved (then the demo could use the real hyperclayjs Mutation).
- **Publishes** (hyperclayjs vendored bundle, `@panphora/hyper-cms`) stay gated on the `/_/` deploy.
