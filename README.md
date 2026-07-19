# hypercms

Live edit-in-place CMS sidebar for any HTML page that carries a [`hyper-html-api`](https://github.com/panphora/hyper-html-api) rules tag. The rules tag tells the engine what's data. hypercms builds a form from those rules, mounts it as a right-side panel, and streams edits back into the page DOM in real time.

## Quick start

You have a page with a rules tag:

```html
<script data-rules-name="cms" data-rules-version="1" type="application/json">
{
  "title": ".page-title",
  "products": [".product", { "name": ".name", "price": ".price@data-cents" }]
}
</script>
```

`cms.open()` looks up a rules tag by the token `cms` (`data-rules-name~="cms"`).
A single tag can carry several space-separated tokens (e.g.
`data-rules-name="api cms collection"`) to serve more than one consumer.

Add hypercms and a trigger:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/hyperclayjs@latest/src/utilities/mutation.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@panphora/hyper-cms@latest/dist/hypercms.min.js"></script>
<script>
  document.getElementById('edit-btn').addEventListener('click', () => hypercms.cms.open())
</script>
<button id="edit-btn">Edit</button>
```

That's the whole integration. The bundle exposes a global `hypercms` and
installs its own styles, so nothing else is needed.

Loading from a bundler instead:

```js
import { cms } from '@panphora/hyper-cms'
import '@panphora/hyper-cms/styles.css'
```

Note the package's `.` export (`src/hypercms.js`) imports `hyper-html-api`
by bare specifier, so it only resolves through a bundler or an import map.
Loading that path straight from a CDN will fail. Use `dist/hypercms.min.js`
in the browser, or jsDelivr's `+esm` route, which rewrites the bare imports
for you but leaves you to call `installStyles()` yourself.

`cms.open()` also accepts an explicit rules source:

```js
cms.open()                       // default token "cms"
cms.open({ rules: 'collection' })// a tag with data-rules-name~="collection"
cms.open({ rules: { title: '.title' } })  // a literal rules object, passed by hand
```

## Auto-open with `?cms=true`

Load any hypercms page with `?cms=true` in the URL and the CMS opens by itself once the DOM is ready — no trigger, no `cms.open()` call. The auto-open uses the host defaults (`document.body` as both `pageRoot` and `mountTo`), and it never double-mounts: if your page also calls `cms.open()`, the second open is a no-op.

When the user closes the CMS, hypercms rewrites the param to `cms=false` via `history.replaceState` (the param is kept, no reload), so refreshing or sharing the post-close URL does not auto-reopen:

```
example.com/page?cms=true   →  CMS opens on load
                            →  user closes
example.com/page?cms=false  →  refresh / share: stays closed
```

The rewrite only touches the URL when `cms=true` is actually present; other params and the hash are preserved, and a page opened without a `cms` param never has one injected. Auto-open is ungated — it fires for every visitor, not just the page owner. (A non-owner's edits stay local to their DOM; in a hyperclayjs app the save path shows its "changes are local only" notice.)

## Hard requirement: `window.hyperclay.Mutation`

hypercms uses [`hyperclayjs`'s Mutation utility](https://github.com/panphora/hyperclayjs/blob/main/src/utilities/mutation.js) as its page-change backend. It's a singleton that already understands `save-ignore`, `save-freeze`, `save-remove`, and `mutations-ignore`, which lets hypercms ignore its own DOM activity without per-event bookkeeping.

If `window.hyperclay.Mutation` is missing when you call `cms.open()`, it throws. Load the utility before initializing, either as a side-effect import (above) or by loading the full hyperclayjs library, which installs it automatically.

## How it works

1. On `open()`, the engine reads your page via `engine.extract(pageRoot, rules)` and builds a form whose fields match every leaf in the rule tree.
2. As you type, `input`/`change` events trigger `engine.apply(pageRoot, rules, formData)`, which writes back to the page DOM.
3. The Mutation observer watches the page. When anything outside the sidebar changes, hypercms re-extracts and morphs the form to match. The sidebar marks itself with `data-hcms-shell` + `save-ignore`, so its own mutations are filtered out at the observer level and skipped by the engine.
4. Form rendering uses a small default template set, overridable per path with `<template data-hcms-tpl="...">`.

## The rules tag

The full grammar lives in the [hyper-html-api docs](https://github.com/panphora/hyper-html-api). The shapes you'll see in form rendering:

| Rule shape | Example | Form widget |
|---|---|---|
| Scalar (text) | `"title": ".page-title"` | input |
| Scalar (attr) | `"href": "a.link@href"` | input |
| Scalar (`@checked`) | `"checked": "input.cb@checked"` | [checkbox](#checkbox-and-toggle-checkbox-toggle) (inferred) |
| Scalar (`@src`) | `"avatar": "img.avatar@src"` | [image upload](#image-upload-image) (inferred) |
| Scalar array | `"tags": "ul.tags li[]"` | list of inputs |
| Object | `"author": { "name": ".name", "email": ".email" }` | grouped fields |
| Object array | `"products": [".product", { "name": ".name" }]` | list of cards |
| Nested | object arrays inside object arrays | recurses |

## Field controls

How the sidebar picks a control for each leaf, in order:

1. If the page element the rule points at carries `data-hcms-component`, that control wins. Explicit beats inferred. Values: `checkbox`, `toggle`, `select`, `radio`, `textarea`, `number`, `image`, `file` on scalar fields, `chips` on list containers.
2. Otherwise a rule ending in `@src` gets the **image upload** control, and a rule ending in `@checked` gets a **checkbox**.
3. Otherwise the rule's shape picks one of the defaults below, unless a [custom template](#custom-form-templates) overrides it.

A custom `<template data-hcms-tpl>` matching the field's path always outranks a named component (the author's template is the stronger signal); when that happens the sidebar logs a `console.info` naming the shadowed component.

One component per element: `data-hcms-component` applies to every rule bound to that element, so give each controlled field its own element (e.g. one hidden `<span data-priority="medium" data-hcms-component="select">` per value, not three values on one element).

One control per rule: in a card list the same rule binds one element per card, and `data-hcms-component`, `data-hcms-options`, and `data-hcms-crop` are sampled from the first matching element and apply to every card — there's no per-card variation. Set them on the first card (or all cards, identically). The number and checkbox/toggle value guards, by contrast, check **every** card's value: one card holding `TBD` falls the whole rule back to text inputs so nothing gets blanked.

The six shape templates are injected into every managed page; all opt-in components are injected on demand the first time a field selects one, so pages using none stay clean.

### Text input (`@scalar`)

The default for every scalar leaf — element text (`".page-title"`), attributes (`"a.link@href"`), props (`"input.name@value"`). One label, one input, inline error slot.

Use it for: headlines, taglines, button labels, prices, link URLs — any one-line copy.

### Field group (`@object`)

An object rule renders a titled section wrapping its children, which each pick their own control.

Use it for: a hero block (title + subtitle + CTA), an author card, a footer contact block — copy that belongs together and should read as one unit in the sidebar.

### List of inputs (`@scalar-array`)

A `[]` rule renders one input per item with add, remove, and reorder.

Use it for: tags, feature bullets, badge lists, nav labels — repeated single values.

### Card list (`@object-array`)

An `["item", { … }]` rule renders draggable cards — grip, per-card fields, add/remove/move controls. Removing a card asks for confirmation by default (`confirmRemove`); scalar-array chips remove instantly.

Use it for: pricing plans, products, testimonials, FAQ entries, team members — repeated structures with several fields each.

### Checkbox and toggle (`checkbox`, `toggle`)

A rule ending in `@checked` gets a checkbox automatically; any other boolean-ish field opts in with `data-hcms-component="checkbox"`, or `"toggle"` for a switch. Both bind the same machinery; the difference is purely the chrome. Booleans round-trip as real booleans (`"true"`/`"false"` page attributes coerce both ways). An opted-in field whose current value isn't `true`/`false` (e.g. `yes`) falls back to a text input with a console note — a checkbox can only ever write back `true`/`false`, which would clobber the value on the next commit.

Use it for: published/draft flags, feature switches, "show section" booleans stored in a `data-*` attribute.

### Dropdown (`select`)

`data-hcms-component="select"` plus `data-hcms-options="low medium high"` (space-separated values; labels derive automatically, `in-progress` reads as "In progress"). If the page's current value isn't in the list it's prepended, so opening the editor never silently changes data. Missing options render an inline field error instead of a dead control.

Use it for: a status, a priority, a size, a theme name — one value from a known short list.

### Radio group (`radio`)

Same opt-in and options syntax as select: `data-hcms-component="radio"` + `data-hcms-options`. Renders one themed radio per value with a per-field group name, so sibling fields and array items never cross-group.

Use it for: the same data as select when the choices deserve to be visible at a glance (2 to 5 options).

### Big text (`textarea`)

`data-hcms-component="textarea"` renders a multi-line box (3 rows) instead of the one-line input.

Use it for: bios, descriptions, testimonial quotes, any copy that wraps.

### Number (`number`)

`data-hcms-component="number"` renders a numeric input. Values still round-trip as strings (the engine stores what the page stores). If any bound value isn't a plain number (`$5`, `7 items` — in a card list, any card's value), the field falls back to a text input with a console note, because a number input physically can't hold such a value and would blank it on the next commit.

Use it for: quantities, prices without currency symbols, ratings, column counts.

### Chip list (`chips`)

`data-hcms-component="chips"` on the list container (the `<ul>` the array rule's items live in) swaps the stacked input list for inline editable chips with add/remove.

Use it for: tags, keywords, badge lists — short repeated values where a full row each is overkill.

### Image upload (`@image`)

Selected automatically for `@src` rules; forced anywhere else with `data-hcms-component="image"` on the page element — e.g. a logo URL stored in a `data-icon` attribute, where the suffix can't be inferred.

An "Upload image" button (`accept="image/*"`) sends the file through the host uploader (`window.hyperclay.uploadFileBasic` in a hyperclay app) and writes the served URL into the page's `img src`; the field shows a thumbnail with an × that clears it. Standalone (no host uploader) the widget still works with a temporary `blob:` preview — deliberately non-persistent. Upload errors render inline in the field and fire `hcms:error`; closing the editor mid-upload aborts cleanly.

**Crop on upload:** add `data-hcms-crop` to the page element and the picked image routes through [quickcrop](https://github.com/panphora/quickcrop) (`window.hyperclay.quickcrop`, bundled in hyperclayjs's `smooth-sailing`/`everything` presets) before uploading. Values: `"1:1"`, `"16:9"` (any `W:H`), or `"free"` for an unconstrained crop. Cancelling the crop aborts the upload. Output is webp, longest edge capped at 2048px. Without quickcrop on the page the file uploads uncropped — the attribute never blocks.

Use it for: avatars, hero/cover images, per-card product photos (each card in an object array uploads independently), any image an owner should swap without touching URLs. Add crop for anything that must fit a fixed frame: avatars (`1:1`), hero banners (`16:9`).

### File upload (`@file`)

Never inferred — opt in with `data-hcms-component="file"` on the element. A bare `a@href` stays a plain URL field: editing a link is far more common than uploading a file.

A "Choose" button uploads the file, writes the URL into the `a href`, and shows the decoded filename as the link text; × clears both.

Use it for: a resume PDF, a downloadable spec or whitepaper, a press kit — links whose target the owner should replace by picking a file.

### Everything else: custom templates

Anything past the built-ins — multi-select, sliders, color pickers, bespoke layouts, option labels that differ from their values — is [custom template](#custom-form-templates) territory over the same machinery. Living examples: `demo/index.html` (the `quantity` template, a wildcard-path override) and `demo/pixel-quiet.html` (the `bio` template).

## Attributes you can use in your page HTML

| Attribute | On | Effect |
|---|---|---|
| `save-ignore` | any element | Engine skips during extract and apply. Mutation observer ignores changes inside. The shell sets this on itself. |
| `save-freeze`, `save-remove`, `mutations-ignore` | any element | Same observer-ignore behavior as `save-ignore`. Use whichever fits your save-pipeline convention. |
| `cms-template` | any element matching a list rule | Engine treats it as a seed template, not real data. Used to grow lists from empty. See [Template seeding](#template-seeding) below. |
| `data-hcms-component="…"` | the page element a rule points at | Picks a [named control](#field-controls): `checkbox`, `toggle`, `select`, `radio`, `textarea`, `number`, `image`, `file` (scalars) or `chips` (list containers). Explicit beats inferred; `@src`/`@checked` rules upgrade automatically without it. |
| `data-hcms-options="low medium high"` | the same element, with `select`/`radio` | Space-separated values for the dropdown/radio group. Labels derive automatically (`in-progress` → "In progress"). |
| `data-hcms-crop="1:1"` | the page element of an image field | Crop-on-upload via quickcrop. Any `W:H` ratio, or `free`. See [Image upload](#image-upload-image). |
| `data-hcms-min-items="N"` | a `<template data-hcms-tpl>` | Sidebar refuses to remove below N items. Hides the remove button when at the floor. |
| `data-hcms-max-items="N"` | a `<template data-hcms-tpl>` | Sidebar refuses to add above N items. Hides the add button at the ceiling. |
| `data-hcms-no-add` | a `<template data-hcms-tpl>` | No add button. |
| `data-hcms-no-remove` | a `<template data-hcms-tpl>` | No remove buttons. |
| `data-hcms-no-reorder` | a `<template data-hcms-tpl>` | No drag handles or move buttons. |
| `data-hcms-confirm-remove` | the root element inside a custom array template | Per-list delete confirmation. A string replaces the prompt; `off` (or `false`/`no`/`0`) disables asking for that list. Wins over the `confirmRemove` open() option. |

## Template seeding

The engine seeds new list items by cloning an existing one. When a list reaches zero items (because the user removed them all, or because addItem created a new parent whose nested arrays empty out), there's nothing to clone. Without a fallback, the engine throws `EmptyListInsert`.

To make growing-from-zero work, mark one element per growable list with `cms-template` and hide it however suits you:

```html
<div class="variants">
  <div class="variant">…real data…</div>
  <div class="variant">…real data…</div>
  <div class="variant" cms-template hidden>
    <strong class="variant-label"></strong>
    <em class="variant-stock"></em>
  </div>
</div>
```

The engine ignores `cms-template` elements during extract and apply (they're never read as data, never written into). When a list needs to grow from zero, the engine walks up from the parent context looking for a matching element with `cms-template`, clones it, strips the attribute from the clone, and inserts. The original template stays in place.

This is the panphora-style colocation pattern: extras live in the DOM, marked, ready when needed.

## Custom form templates

Drop a `<template>` anywhere in the page to override the default form for a given path or shape:

```html
<template data-hcms-tpl="products.*">
  <article class="my-product-card">
    <input data-hcms-field="name" />
    <input data-hcms-field="price" />
    <button data-hcms-action="remove">×</button>
  </article>
</template>
```

The `data-hcms-tpl` value resolves in order:

1. Exact path (`products.0.name`)
2. Wildcard path (`products.*`, `products.*.variants`, `products.*.variants.*`)
3. Shape key (`@scalar`, `@object`, `@object-array`, `@scalar-array`)

Inside a template, the engine looks for these slots:

| Marker | Purpose |
|---|---|
| `data-hcms-field` | Input/textarea/select that holds a scalar value. Optionally `data-hcms-field="name"` to bind by key inside an object template. |
| `data-hcms-label` | Where the field label gets written. |
| `data-hcms-action="add"` | Add-item button for a list. |
| `data-hcms-action="remove"` | Remove-item button on a card. |
| `data-hcms-action="move-up"` / `"move-down"` | Reorder buttons. |
| `.hcms-object-fields` or `.hcms-card-fields` | Slot where child fields render. Required on slotted templates that aren't fully inline. |

## API

```js
import { cms } from '@panphora/hyper-cms'

cms.open(opts?)
cms.close()
cms.refresh()
cms.isOpen           // getter

cms.api.getData()                     // current form data (object)
cms.api.setValue(path, value)         // write a scalar leaf
cms.api.addItem(arrayPath)            // push a new item
cms.api.removeItem(itemPath)          // drop an item by index
```

### `open(opts)`

| Option | Default | Effect |
|---|---|---|
| `pageRoot` | `document.body` | Where extract/apply run. |
| `mountTo` | `document.body` | Where the shell DOM mounts. Can be a descendant of pageRoot. |
| `side` | `'right'` | `'right'` or `'left'`. |
| `overlay` | `false` | If true, sidebar covers the page; if false, page content gets a padding offset. |
| `showSaveButton` | `false` | Renders a Save button in the shell footer. The button carries the `trigger-save` attribute: in hyperclayjs apps the host save system handles the click (with a "changes are local only" notice for non-owners). Standalone hosts delegate it themselves — see below. |
| `confirmRemove` | confirm cards, not chips | Delete-confirmation policy for all lists: `true` confirms every removal, `false` never asks, a string confirms with that prompt. Per-list `data-hcms-confirm-remove` wins over this. |
| `onChange(data, info)` | none | Per-commit callback. |
| `onError(err)` | none | Per-commit error callback. |

Standalone `[trigger-save]` handling (no hyperclayjs on the page):

```js
document.addEventListener('click', (e) => {
  if (e.target.closest('[trigger-save]')) {
    persistSomehow(document.documentElement.outerHTML) // or cms.api.getData()
  }
})
```

### Path syntax

Dotted strings with integer indices for arrays: `products.0.variants.1.label`. Helpers exposed at `cms.path` (`fromString`, `toString`, `getRuleAtPath`).

## Events

All events dispatch on the shell root and bubble through the document.

| Event | Detail | When |
|---|---|---|
| `hcms:open` | `{ pageRoot }` | After mount, before first interaction. |
| `hcms:change` | `{ data, path, structural }` | Per successful commit. `structural` is true for add/remove/reorder. |
| `hcms:error` | `{ error, attemptedData }` | When apply throws (shape mismatch, missing template, etc.). |
| `hcms:close` | `null` | Before teardown. |

`hcms:change` is cancelable.

## Lifecycle

```
open()
  → engine.findRules(page, source)  // resolve rules (token "cms" by default, or an object/named token)
  → engine.extract(page, rules)     // read data (skips [data-hcms-shell] and [cms-template])
  → deriveFormRules + buildForm     // build sidebar DOM
  → mountShell                      // append to mountTo
  → installObserver                 // subscribe to Mutation.onAnyChange
  → focusFirstIn(shell)
  → dispatch('hcms:open')

per-keystroke:
  input event
  → extractFormData                 // read form into js object
  → fingerprint compare             // skip if unchanged
  → applyWithRollback
      pause observer
      engine.apply(page, rules, data, { skip, templateAttr })
      resume observer
  → dispatch('hcms:change')

per-page-change-from-outside:
  Mutation.onAnyChange (debounced 100ms, filtered by save-ignore)
  → refreshForm
      engine.findRules (re-resolve by source; livesync may have swapped a token tag)
      engine.extract
      buildForm into fragment
      morphForm(formRoot, fragment)  // hyper-morph preserves focus + values
```

## Errors

Apply runs inside a try/catch. On failure:

- The error is shown inline in the shell header.
- `hcms:error` is dispatched with `{ error, attemptedData }`.
- For structural commits, the affected page subtree is restored from a snapshot taken just before apply.
- For scalar commits, the page may diverge from the form temporarily; the next refresh will bring them back in sync.

Common errors thrown by the engine:

| Name | Cause | Fix |
|---|---|---|
| `ShapeMismatch` | Form data shape doesn't match rule shape (e.g. scalar received an object). | Bug in form rendering; report it. |
| `EmptyListInsert` | List needs to grow but has zero items and no `cms-template`. | Add a `cms-template` element per growable list, OR set `data-hcms-min-items="1"`. |
| `MaxRuleDepthExceeded` | Rules nest beyond the engine's depth limit. | Flatten the rules; this almost certainly indicates a mistake. |

## Drag-to-reorder

In hyperclayjs apps, drag works out of the box (hypercms's object-array templates carry the `[sortable]` custom-attribute, which hyperclayjs upgrades). For standalone use, install `sortablejs` and either upgrade the `[sortable]` attribute yourself or replace the template with your own reorder UX. Add/remove still work without sortable.

## Build, develop, test

```sh
npm install
npm run build          # bundle to dist/hypercms.min.js (esbuild, IIFE)
npm test               # node --test test-node/**/*.test.js
npm run demo           # http-server on port 5694 → /demo/
```

Tests run against jsdom. Test helpers stub `window.hyperclay.Mutation` so the hard requirement is satisfied without pulling in the real library.

## License

0BSD.
