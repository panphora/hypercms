import { ruleAttrIndex } from 'hyper-html-api/engine'
import { getRuleAtPath } from './path.js'

export function humanize(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

// The default templates emit real mirk-interface markup so the generated form
// renders in the Pixel Quiet look out of the box. Every data-hcms-* hook
// (shape, label, field, action, the .hcms-array-items / .hcms-card-fields slots,
// the .hcms-error inline slots) is preserved exactly, so the engine, events,
// add/remove/reorder, and inline-error placement bind unchanged. The CSS that
// dresses these lives in src/theme.generated.css (scoped mirk + pixel-quiet).
const SORTABLE_GRIP = `<div class="hcms-drag-handle mirk-sortable__grip" aria-hidden="true"><div class="mirk-sortable__dots"><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span></div></div>`

// Crisp-line × (square caps + crispEdges): a plain pixel-sharp close glyph that
// stays hard-edged inside the small square corner button on object-array cards.
const CLOSE_ICON = `<svg class="hcms-x" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path></svg>`

const DEFAULT_TEMPLATES = {
  // The default scalar is a one-row auto-growing textarea, not an <input>:
  // page copy is prose and routinely wraps. Growth comes from field-sizing:
  // content in the theme, with a scrollHeight fallback (enhance.js).
  '@scalar': `
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <textarea class="mirk-textarea" rows="1" data-hcms-field></textarea>
      <div class="hcms-error" hidden></div>
    </label>
  `,
  '@object': `
    <section class="hcms-object" data-hcms-shape="object">
      <h3 class="hcms-object-title" data-hcms-label></h3>
      <div class="hcms-object-fields"></div>
      <div class="hcms-error" hidden></div>
    </section>
  `,
  '@scalar-array': `
    <section class="hcms-array hcms-scalar-array" data-hcms-shape="scalar-array">
      <header class="hcms-array-header">
        <h3 class="hcms-array-title" data-hcms-label></h3>
      </header>
      <ul class="hcms-array-items"></ul>
      <div class="hcms-error" hidden></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
    </section>
  `,
  '@scalar-array-item': `
    <li class="hcms-array-item" draggable="true">
      <input class="mirk-input" data-hcms-field />
      <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">↑</button>
      <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">↓</button>
      <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove">×</button>
      <div class="hcms-error" hidden></div>
    </li>
  `,
  '@object-array': `
    <section class="hcms-array hcms-object-array hcms-array--cards" data-hcms-shape="object-array">
      <header class="hcms-array-header">
        <h3 class="hcms-array-title" data-hcms-label></h3>
      </header>
      <div class="hcms-array-items"></div>
      <div class="hcms-error" hidden></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
    </section>
  `,
  '@object-array-item': `
    <article class="hcms-card mirk-sortable__item" draggable="true">
      ${SORTABLE_GRIP}
      <div class="hcms-card-body mirk-sortable__body">
        <div class="hcms-card-fields"></div>
        <div class="hcms-card-controls">
          <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">↑</button>
          <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">↓</button>
          <button type="button" class="hcms-remove hcms-remove--card" data-hcms-action="remove" aria-label="Remove">${CLOSE_ICON}</button>
        </div>
      </div>
      <div class="hcms-error" hidden></div>
    </article>
  `,
  // Opt-in upload components. Built on the kit's consolidated mirk chrome (all
  // themed in theme.generated.css), with interactive hooks kept on data-hcms-*
  // so the vendored mirk runtime (which keys off .mirk-*__input / .mirk-*__remove)
  // never double-handles a CMS field. The bound value is the leaf's URL: the
  // <a href> for @file, the <img src> for @image. Empty/filled chrome is driven
  // by that attribute in CSS (.hcms-upload* in pixel-quiet.overrides.css), no JS.
  '@file': `
    <div class="hcms-field hcms-upload hcms-upload--file" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-file mirk-file--compact mirk-file--round">
        <label class="mirk-button mirk-button--round mirk-button--small">
          <input type="file" data-hcms-upload />
          <span class="mirk-button__label">Choose</span>
        </label>
        <a class="mirk-file__name" data-hcms-field></a>
        <button type="button" class="hcms-upload-clear" data-hcms-action="clear-upload" aria-label="Remove file">${CLOSE_ICON}</button>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@image': `
    <div class="hcms-field hcms-upload hcms-upload--image" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-image mirk-image--compact mirk-image--rounded">
        <label class="mirk-button mirk-button--small mirk-image__upload">
          <input type="file" accept="image/*" data-hcms-upload />
          <span class="mirk-button__label">Upload image</span>
        </label>
        <figure class="mirk-image__thumb">
          <span class="mirk-image__frame"><img class="mirk-image__preview" data-hcms-field alt="" /></span>
          <button type="button" class="hcms-upload-clear hcms-upload-clear--badge" data-hcms-action="clear-upload" aria-label="Remove image">${CLOSE_ICON}</button>
        </figure>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  // Named built-in controls, opt-in via data-hcms-component on the page element
  // a rule points at. Promoted from the demo custom templates (mirk chrome,
  // already themed in theme.generated.css), so the easy path needs no template
  // authoring. @checkbox/@toggle bind the same input[type=checkbox]@checked
  // machinery; @select/@radio get their entries from data-hcms-options (the
  // form-builder populates the empty <select> / clones the radio prototype).
  '@checkbox': `
    <div class="hcms-field hcms-field--row" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <label class="mirk-checkbox">
        <input type="checkbox" class="mirk-sr-only" data-hcms-field />
        <span class="mirk-checkbox__box"><span class="mirk-checkbox__mark"></span></span>
      </label>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@toggle': `
    <div class="hcms-field hcms-field--row" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <label class="mirk-toggle">
        <input type="checkbox" role="switch" class="mirk-sr-only" data-hcms-field />
        <span class="mirk-toggle__track"><span class="mirk-toggle__thumb"></span></span>
      </label>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@select': `
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-select">
        <select class="mirk-select__field" data-hcms-field></select>
        <span aria-hidden="true" class="mirk-select__chevron">›</span>
      </div>
      <div class="hcms-error" hidden></div>
    </label>
  `,
  '@radio': `
    <div class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="hcms-radio-row">
        <label class="mirk-radio">
          <input type="radio" class="mirk-sr-only" data-hcms-field />
          <span class="mirk-radio__ring"><span class="mirk-radio__fill"></span><span class="mirk-radio__dot"></span></span>
          <span class="mirk-radio__label"></span>
        </label>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@textarea': `
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <textarea class="mirk-textarea" rows="3" data-hcms-field></textarea>
      <div class="hcms-error" hidden></div>
    </label>
  `,
  // Rich-text surface for @innerHTML-bound rules: a contenteditable div whose
  // value interface is innerHTML (fieldPropertyFor), so links and inline
  // formatting survive the round-trip. richclay mounts on it when the host
  // page ships it (enhance.js); otherwise it stays a plain contenteditable.
  '@richtext': `
    <div class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-textarea hcms-richtext" contenteditable="true" data-hcms-field></div>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@number': `
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <input class="mirk-input" type="number" data-hcms-field />
      <div class="hcms-error" hidden></div>
    </label>
  `,
  '@chips': `
    <div class="hcms-field hcms-chips" data-hcms-shape="scalar-array">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-tags hcms-array-items"></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@chips-item': `
    <span class="mirk-tags__chip" data-hcms-array-item>
      <input class="hcms-chip-field" data-hcms-field aria-label="Item" placeholder="…" />
      <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove">×</button>
    </span>
  `,
}

// Shape templates fill-the-gaps on every managed page. The opt-in components
// (@file/@image uploads + the named controls) are injected on demand the first
// time a field selects them (the Slice-2 component seam), so pages using none
// stay clean.
const ALWAYS_INJECT_KEYS = [
  '@scalar',
  '@object',
  '@scalar-array',
  '@scalar-array-item',
  '@object-array',
  '@object-array-item',
]

export function injectDefaults(doc) {
  const head = doc.head || doc.documentElement
  if (!head) return
  for (const key of ALWAYS_INJECT_KEYS) injectTemplate(doc, head, key)
}

// Inject one opt-in component template if the page hasn't already defined its
// own. Called by the component-selection seam the first time a field resolves
// to a component.
export function injectComponentTemplate(doc, key) {
  if (!DEFAULT_TEMPLATES[key]) return null
  const head = doc && (doc.head || doc.documentElement)
  if (!head) return null
  return injectTemplate(doc, head, key)
}

// Named-component selection. Explicit beats inferred: a data-hcms-component
// attribute on the page element a rule points at wins over the @prop-suffix
// inference, so a checked-bound field can still opt into the @toggle look.
// Inference stays narrow: @src means image upload (the dominant image-CMS
// workflow) and @checked means checkbox (a text input showing the literal word
// "true" helps nobody). @href is NOT inferred: editing a link/URL is far more
// common than uploading a file, so an a@href rule stays a plain URL field and
// the file upload is opt-in. Suffix is split like the engine (ruleAttrIndex,
// see engine/extract.js). Returns a DEFAULT_TEMPLATES key.
const PROP_TO_COMPONENT = { src: '@image', checked: '@checkbox', innerHTML: '@richtext' }
// data-hcms-component values for scalar rules. "chips" is array-only (below).
const SCALAR_COMPONENT_BY_NAME = {
  image: '@image',
  file: '@file',
  checkbox: '@checkbox',
  toggle: '@toggle',
  select: '@select',
  radio: '@radio',
  textarea: '@textarea',
  number: '@number',
  richtext: '@richtext',
}
// Every opt-in component injects on demand; only the 6 shape templates are
// always present.
const ON_DEMAND_COMPONENT_KEYS = new Set([
  ...Object.values(SCALAR_COMPONENT_BY_NAME),
  '@chips',
  '@chips-item',
])

export function componentForScalarRule(rule, doc, pathArr, pageRules) {
  if (typeof rule !== 'string') return '@scalar'
  const at = ruleAttrIndex(rule)
  const host = hostSelectorOf(rule, at, pathArr, pageRules)
  const override = readElementAttr(host, doc, 'data-hcms-component')
  if (override && SCALAR_COMPONENT_BY_NAME[override]) {
    const key = SCALAR_COMPONENT_BY_NAME[override]
    // Value guards check exactly the elements the engine binds: under an array
    // the same rule binds one element per item (every match votes), while a
    // plain scalar binds only the FIRST match — a decorative second element
    // sharing the selector must not veto the control.
    const multi = Array.isArray(pathArr) && pathArr.some((s) => s === '*' || typeof s === 'number')
    if (key === '@number' && !currentScalarValues(rule, at, doc, multi, host).every(numberInputCanHold)) {
      return '@scalar'
    }
    if (
      (key === '@checkbox' || key === '@toggle') &&
      (at < 0 || rule.slice(at + 1) !== 'checked') &&
      !currentScalarValues(rule, at, doc, multi, host).every(checkboxCanHold)
    ) {
      return '@scalar'
    }
    return key
  }
  if (at >= 0) {
    const prop = rule.slice(at + 1)
    if (PROP_TO_COMPONENT[prop]) return PROP_TO_COMPONENT[prop]
  }
  return '@scalar'
}

// The data-hcms-component key the page element explicitly declares for this
// rule, or null (absent / unknown name / value-guard fallback). Lets the
// builder tell "author asked for this" apart from suffix inference when
// logging shadowing notices.
export function declaredComponentKey(rule, doc, pathArr, pageRules) {
  if (typeof rule !== 'string') return null
  const at = ruleAttrIndex(rule)
  const name = readElementAttr(hostSelectorOf(rule, at, pathArr, pageRules), doc, 'data-hcms-component')
  return (name && SCALAR_COMPONENT_BY_NAME[name]) || null
}

// A number input physically rejects any value that isn't a plain number — it
// reads back '' — and the whole-form commit would then blank the page value on
// the next edit of ANY field. When any bound value isn't number-shaped, fall
// back to the plain text control. This runs inside componentForScalarRule so
// the builder and deriveFormRules stay in lockstep (both call it).
const NUMBER_VALUE_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/

function numberInputCanHold(value) {
  if (value == null || value === '') return true
  return NUMBER_VALUE_RE.test(String(value))
}

// A checkbox/toggle extracts its checked property — 'true' or 'false' — so any
// other bound value ("yes", "on", "1") would be clobbered to 'false' on the
// next whole-form commit. @checked projections are exempt in the caller: they
// round-trip the checked state faithfully by construction.
function checkboxCanHold(value) {
  return value == null || value === '' || value === 'true' || value === 'false'
}

// Read the page values the rule binds, the way the engine extracts them:
// trimmed textContent for text projections (adapter.text trims), the live
// property for @value, the raw attribute otherwise. Mirrors extraction's
// skips: cms-template seeds and the shell are never extracted, so their
// values don't get a vote. `multi` mirrors the engine's binding: all matches
// under an array (one element per item), only the first match otherwise.
function currentScalarValues(rule, at, doc, multi, selector) {
  if (!doc || !doc.querySelectorAll) return []
  if (!selector || selector === '.') return []
  let els = null
  try {
    els = doc.querySelectorAll(selector)
  } catch {
    return []
  }
  const prop = at >= 0 ? rule.slice(at + 1) : null
  const out = []
  for (const el of els) {
    if (el.closest && el.closest('[cms-template], [data-hcms-shell]')) continue
    if (prop) {
      if (prop === 'value' && 'value' in el) out.push(el.value)
      else out.push(el.getAttribute ? el.getAttribute(prop) : null)
    } else {
      out.push((el.textContent || '').trim())
    }
    if (!multi) break
  }
  return out
}

// Array-level component selection: data-hcms-component="chips" on the list
// container (or any ancestor of the items) swaps the scalar-array chrome for
// the chip list. Resolved through the first item the rule's selector matches,
// then closest(), so the natural authoring spot — the <ul> — works even though
// the selector targets the items. Growable-from-zero lists carry a cms-template
// item, so the item selector always has something to match.
export function componentForScalarArrayRule(rule, doc) {
  if (typeof rule !== 'string' || !rule.endsWith('[]')) return null
  if (!doc || !doc.querySelector) return null
  const selector = rule.slice(0, -2).trim()
  if (!selector) return null
  let item = null
  try {
    item = doc.querySelector(selector)
  } catch {
    return null
  }
  const host = item && item.closest ? item.closest('[data-hcms-component]') : null
  const name = host && host.getAttribute ? host.getAttribute('data-hcms-component') : null
  if (name === 'chips') return { array: '@chips', item: '@chips-item' }
  return null
}

// Template resolution shared by the builder and deriveFormRules: a custom
// template at the exact path wins, then a wildcard-path one, then the default.
export function resolveTemplate(pathArr, defaultKey, doc) {
  const pathStr = pathArr.join('.')
  const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
  return (
    (pathStr && findTemplate(doc, pathStr)) ||
    (wildcardKey && wildcardKey !== pathStr && findTemplate(doc, wildcardKey)) ||
    findTemplate(doc, defaultKey)
  )
}

// The declared array component, but only when its array template actually
// wins at this path — a custom path/wildcard template that shadows it returns
// null. The form-builder (item chrome) and deriveFormRules (item leaf
// selector) MUST share this verdict: if they diverge, the derived selector
// stops matching the rendered item leaf, every item extracts null, and the
// whole-form commit writes those nulls back over real page data.
export function winningScalarArrayComponent(rule, pathArr, doc) {
  const comp = componentForScalarArrayRule(rule, doc)
  if (!comp) return null
  const winner = resolveTemplate(pathArr, comp.array, doc)
  if (winner && winner.getAttribute('data-hcms-tpl') === comp.array) return comp
  return null
}

// Option list for @select/@radio: data-hcms-options="low medium high" on the
// same page element as data-hcms-component. Space-separated value tokens (the
// data-rules-name idiom); labels derive via humanize() like every other label.
export function readOptionsOverride(rule, doc, pathArr, pageRules) {
  if (typeof rule !== 'string') return null
  const at = ruleAttrIndex(rule)
  const raw = readElementAttr(hostSelectorOf(rule, at, pathArr, pageRules), doc, 'data-hcms-options')
  if (raw == null) return null
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  return tokens.length ? tokens : null
}

// Crop opt-in for @image: data-hcms-crop="1:1" | "16:9" | "free" on the page
// element. The form-builder copies it onto the built field so the upload path
// reads it without a second page lookup.
export function readCropOverride(rule, doc, pathArr, pageRules) {
  if (typeof rule !== 'string') return null
  const at = ruleAttrIndex(rule)
  return readElementAttr(hostSelectorOf(rule, at, pathArr, pageRules), doc, 'data-hcms-crop')
}

function scalarSelectorOf(rule, at) {
  return at >= 0 ? rule.slice(0, at) : rule
}

// The page element that carries this rule's authoring attributes
// (data-hcms-component / -options / -crop), and whose values the guards read.
//
// A rule that binds its own context element — a lone "." or a leading "@attr" —
// has no selector of its own: scalarSelectorOf yields "" or ".". Inside a list
// that context element IS the row, so the element to read is the row, and the
// row selector is the enclosing array's item selector. That is the "state is
// content" case (data-status on the card), and without this it can never carry
// a named control. Outside any list the context is the document root, so there
// is still no element to read and we return "" — readElementAttr and
// currentScalarValues both treat that as "nothing declared", exactly as before.
//
// The component is chosen per RULE, not per row, so any ONE matching row
// answers the question; readElementAttr's querySelector taking the first match
// is correct rather than a shortcut.
function hostSelectorOf(rule, at, pathArr, pageRules) {
  const own = scalarSelectorOf(rule, at)
  if (own && own !== '.') return own
  return enclosingArraySelector(pageRules, pathArr)
}

// The descendant-joined item selectors of every array rule crossed on the way
// to pathArr, or "" when the path crosses none (or does not resolve). Mirrors
// the scope chain hyperclay's resolveControl builds for the same path, so the
// generator stamps the attribute on exactly the elements read back here.
function enclosingArraySelector(pageRules, pathArr) {
  if (pageRules == null || !Array.isArray(pathArr)) return ''
  const scope = []
  let node = pageRules
  for (const seg of pathArr) {
    if (node == null || typeof node === 'string') break
    if (Array.isArray(node)) {
      if (typeof node[0] !== 'string') return ''
      if (seg !== '*' && typeof seg !== 'number') return ''
      scope.push(node[0])
      node = node[1]
      continue
    }
    if (typeof node !== 'object') return ''
    if (!Object.prototype.hasOwnProperty.call(node, seg)) return ''
    node = node[seg]
  }
  return scope.join(' ')
}

// The only branch that reads the page DOM during selection.
function readElementAttr(selector, doc, attrName) {
  if (!doc || !doc.querySelector) return null
  if (!selector || selector === '.') return null
  let el = null
  try {
    el = doc.querySelector(selector)
  } catch {
    return null
  }
  return el && el.getAttribute ? el.getAttribute(attrName) : null
}

// Pre-inject the component templates this page's rules actually select, so
// both deriveFormRules (selectors) and buildForm (DOM) resolve them. Walks the
// same rule shapes as buildTemplateMap; idempotent and author-template-safe.
export function injectComponents(doc, pageRules) {
  if (!doc || pageRules == null) return
  walk(pageRules, [])

  // The path is carried so componentForScalarRule can resolve a context leaf
  // ("." / "@attr") against its enclosing row, the same way the builder does.
  // Without it a row-level named control resolves to @scalar here, its template
  // is never injected, and buildScalar then throws on the missing template.
  function walk(rule, pathArr) {
    const kind = shapeKindOf(rule)
    if (kind === 'scalar') {
      const key = componentForScalarRule(rule, doc, pathArr, pageRules)
      if (ON_DEMAND_COMPONENT_KEYS.has(key)) injectComponentTemplate(doc, key)
      return
    }
    if (kind === 'scalar-array') {
      const comp = componentForScalarArrayRule(rule, doc)
      if (comp) {
        injectComponentTemplate(doc, comp.array)
        injectComponentTemplate(doc, comp.item)
      }
      return
    }
    if (kind === 'object') {
      for (const [k, child] of Object.entries(rule)) walk(child, [...pathArr, k])
      return
    }
    if (kind === 'object-array') {
      const itemShape = rule[1]
      const itemPath = [...pathArr, '*']
      if (itemShape && typeof itemShape === 'object' && !Array.isArray(itemShape)) {
        for (const [k, child] of Object.entries(itemShape)) walk(child, [...itemPath, k])
      } else {
        walk(itemShape, itemPath)
      }
    }
  }
}

function injectTemplate(doc, head, key) {
  const existing = findTemplate(doc, key)
  if (existing) return existing
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', key)
  tpl.setAttribute('save-remove', '')
  tpl.innerHTML = DEFAULT_TEMPLATES[key].trim()
  head.appendChild(tpl)
  return tpl
}

export function findTemplate(doc, key) {
  if (!doc || !doc.querySelector) return null
  return doc.querySelector(`template[data-hcms-tpl="${cssEscape(key)}"]`)
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
}

export function shapeKindOf(rule) {
  if (typeof rule === 'string') {
    return rule.endsWith('[]') ? 'scalar-array' : 'scalar'
  }
  if (Array.isArray(rule)) return 'object-array'
  if (typeof rule === 'object' && rule !== null) return 'object'
  return 'scalar'
}

const SHAPE_TO_DEFAULT_KEY = {
  scalar: '@scalar',
  object: '@object',
  'scalar-array': '@scalar-array',
  'object-array': '@object-array',
}

const SHAPE_TO_ITEM_KEY = {
  'scalar-array': '@scalar-array-item',
  'object-array': '@object-array-item',
}

export function templateKeyForPath(pathArr, pageRules) {
  const rule = getRuleAtPath(pageRules, pathArr)
  const shape = shapeKindOf(rule)
  return SHAPE_TO_DEFAULT_KEY[shape] || '@scalar'
}

export function itemTemplateKeyForArrayPath(pathArr, pageRules) {
  const rule = getRuleAtPath(pageRules, pathArr)
  const shape = shapeKindOf(rule)
  return SHAPE_TO_ITEM_KEY[shape] || null
}

export function buildTemplateMap(pageRules, doc) {
  const map = new Map()
  walk([], pageRules)
  return map

  function walk(pathArr, rule) {
    const pathStr = pathArr.join('.')
    const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
    const shape = shapeKindOf(rule)
    const arrayComp = shape === 'scalar-array' ? componentForScalarArrayRule(rule, doc) : null
    // Items follow the WINNING component (a shadowed chips array renders
    // default items), matching buildScalarArray.
    const winningComp = shape === 'scalar-array' ? winningScalarArrayComponent(rule, pathArr, doc) : null
    const defaultKey =
      shape === 'scalar'
        ? componentForScalarRule(rule, doc, pathArr)
        : (arrayComp && arrayComp.array) || SHAPE_TO_DEFAULT_KEY[shape] || '@scalar'

    let tpl =
      (pathStr && findTemplate(doc, pathStr)) ||
      (wildcardKey && wildcardKey !== pathStr && findTemplate(doc, wildcardKey)) ||
      findTemplate(doc, defaultKey)

    map.set(pathStr, tpl)

    if (shape === 'object') {
      for (const [k, child] of Object.entries(rule)) walk([...pathArr, k], child)
    } else if (shape === 'object-array' || shape === 'scalar-array') {
      const itemPath = [...pathArr, '*']
      const itemKey = itemPath.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
      const itemShape = shape === 'object-array' ? 'object-array-item' : 'scalar-array-item'
      const itemTpl =
        findTemplate(doc, itemKey) ||
        (winningComp && findTemplate(doc, winningComp.item)) ||
        findTemplate(doc, '@' + itemShape)
      map.set(itemKey, itemTpl)
      if (shape === 'object-array') {
        const itemRule = rule[1]
        if (itemRule && typeof itemRule === 'object' && !Array.isArray(itemRule)) {
          for (const [k, child] of Object.entries(itemRule)) walk([...itemPath, k], child)
        }
      }
    }
  }
}

export function isInlineTemplate(tplEl) {
  if (!tplEl) return false
  const root = tplEl.content || tplEl
  return !!root.querySelector('[data-hcms-field]')
}

export function slotSelectorFor(kind) {
  switch (kind) {
    case 'object':
      return '.hcms-object-fields'
    case 'object-array-item':
      return '.hcms-card-fields'
    case 'scalar-array':
    case 'object-array':
      return '.hcms-array-items'
    default:
      return null
  }
}
