import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { engine } from 'hyper-html-api'
import {
  componentForScalarRule,
  componentForScalarArrayRule,
  readOptionsOverride,
  injectDefaults,
  injectComponents,
  findTemplate,
} from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm, radioGroupName } from '../src/form-builder.js'
import { parseCropAspect, blobToFile, restampAllSiblings } from '../src/events.js'

function setupDoc(bodyHtml = '') {
  return new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`).window.document
}

// Mirror open(): inject the shape defaults + the components this page's rules
// select, before deriving rules / building the form.
function prepare(doc, rules) {
  injectDefaults(doc)
  injectComponents(doc, rules)
}

// --- 1. componentForScalarRule: named values + inference -------------------

test('componentForScalarRule: each of the 8 data-hcms-component values maps to its key', () => {
  const doc = setupDoc(`
    <div class="image" data-hcms-component="image"></div>
    <a class="file" data-hcms-component="file" href=""></a>
    <span class="checkbox" data-hcms-component="checkbox" data-v=""></span>
    <span class="toggle" data-hcms-component="toggle" data-v=""></span>
    <span class="select" data-hcms-component="select" data-v=""></span>
    <span class="radio" data-hcms-component="radio" data-v=""></span>
    <span class="textarea" data-hcms-component="textarea"></span>
    <span class="number" data-hcms-component="number" data-v=""></span>`)
  assert.equal(componentForScalarRule('.image@data-v', doc), '@image')
  assert.equal(componentForScalarRule('.file@href', doc), '@file')
  assert.equal(componentForScalarRule('.checkbox@data-v', doc), '@checkbox')
  assert.equal(componentForScalarRule('.toggle@data-v', doc), '@toggle')
  assert.equal(componentForScalarRule('.select@data-v', doc), '@select')
  assert.equal(componentForScalarRule('.radio@data-v', doc), '@radio')
  assert.equal(componentForScalarRule('.textarea', doc), '@textarea')
  assert.equal(componentForScalarRule('.number@data-v', doc), '@number')
})

test('componentForScalarRule: unknown data-hcms-component value → @scalar', () => {
  const doc = setupDoc(`<span class="x" data-hcms-component="bogus" data-v=""></span>`)
  assert.equal(componentForScalarRule('.x@data-v', doc), '@scalar')
})

test('componentForScalarRule: EXPLICIT data-hcms-component beats INFERRED @prop', () => {
  // img@src would infer @image, but an explicit file opt-in wins.
  const doc = setupDoc(`<img class="x" data-hcms-component="file" src="">`)
  assert.equal(componentForScalarRule('img.x@src', doc), '@file')
})

test('componentForScalarRule: @checked suffix infers @checkbox', () => {
  const doc = setupDoc()
  assert.equal(componentForScalarRule('.flag@checked', doc), '@checkbox')
})

test('componentForScalarRule: @checked + data-hcms-component="toggle" → @toggle (explicit wins)', () => {
  const doc = setupDoc(`<input class="flag" type="checkbox" data-hcms-component="toggle">`)
  assert.equal(componentForScalarRule('.flag@checked', doc), '@toggle')
})

// --- 2. componentForScalarArrayRule ----------------------------------------

test('componentForScalarArrayRule: attr on the <ul> container resolves chips via closest()', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="chips"><li>a</li><li>b</li></ul>`)
  assert.deepEqual(componentForScalarArrayRule('ul.tags li[]', doc), {
    array: '@chips',
    item: '@chips-item',
  })
})

test('componentForScalarArrayRule: attr directly on the first <li> resolves chips', () => {
  const doc = setupDoc(`<ul class="tags"><li data-hcms-component="chips">a</li><li>b</li></ul>`)
  assert.deepEqual(componentForScalarArrayRule('ul.tags li[]', doc), {
    array: '@chips',
    item: '@chips-item',
  })
})

test('componentForScalarArrayRule: no attr → null', () => {
  const doc = setupDoc(`<ul class="tags"><li>a</li></ul>`)
  assert.equal(componentForScalarArrayRule('ul.tags li[]', doc), null)
})

test('componentForScalarArrayRule: ancestor attr with a non-chips value → null', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="grid"><li>a</li></ul>`)
  assert.equal(componentForScalarArrayRule('ul.tags li[]', doc), null)
})

// --- 3. readOptionsOverride -------------------------------------------------

test('readOptionsOverride: "low medium high" → tokens', () => {
  const doc = setupDoc(`<span class="pr" data-hcms-options="low medium high"></span>`)
  assert.deepEqual(readOptionsOverride('.pr@data-pr', doc), ['low', 'medium', 'high'])
})

test('readOptionsOverride: extra whitespace collapsed', () => {
  const doc = setupDoc(`<span class="pr" data-hcms-options="  low   medium\thigh  "></span>`)
  assert.deepEqual(readOptionsOverride('.pr@data-pr', doc), ['low', 'medium', 'high'])
})

test('readOptionsOverride: attr absent → null; empty/whitespace-only → null', () => {
  const absent = setupDoc(`<span class="pr"></span>`)
  assert.equal(readOptionsOverride('.pr@data-pr', absent), null)
  const empty = setupDoc(`<span class="pr" data-hcms-options=""></span>`)
  assert.equal(readOptionsOverride('.pr@data-pr', empty), null)
  const ws = setupDoc(`<span class="pr" data-hcms-options="   "></span>`)
  assert.equal(readOptionsOverride('.pr@data-pr', ws), null)
})

// --- 4. parseCropAspect + blobToFile ---------------------------------------

test('parseCropAspect: ratios parse, free/empty/garbage → null', () => {
  assert.equal(parseCropAspect('1:1'), 1)
  assert.equal(parseCropAspect('16:9'), 16 / 9)
  assert.equal(parseCropAspect('4/3'), 4 / 3)
  assert.equal(parseCropAspect('free'), null)
  assert.equal(parseCropAspect(''), null)
  assert.equal(parseCropAspect('garbage'), null)
})

test('blobToFile: mime → extension, base keeps original name minus old ext', () => {
  const webp = blobToFile(new Blob(['x'], { type: 'image/webp' }), 'photo.png')
  assert.equal(webp.name, 'photo.webp')
  assert.equal(webp.type, 'image/webp')
  const jpg = blobToFile(new Blob(['x'], { type: 'image/jpeg' }), 'shot.gif')
  assert.equal(jpg.name, 'shot.jpg')
  const png = blobToFile(new Blob(['x'], { type: 'application/octet-stream' }), 'thing.bmp')
  assert.equal(png.name, 'thing.png')
})

// --- 5. buildForm — @select -------------------------------------------------

test('buildForm: @select renders a populated select with the page value selected and humanized labels', () => {
  const doc = setupDoc(`<span class="pr" data-pr="medium" data-hcms-component="select" data-hcms-options="low medium high"></span>`)
  const rules = { pr: '.pr@data-pr' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { pr: 'medium' }, doc })
  const select = frag.querySelector('select.mirk-select__field[data-hcms-field="pr"]')
  assert.ok(select, 'select widget cloned')
  const opts = select.querySelectorAll('option')
  assert.equal(opts.length, 3, 'three options')
  assert.equal(select.value, 'medium', 'current page value selected')
  assert.equal(opts[0].value, 'low')
  assert.equal(opts[0].textContent, 'Low', 'label humanized')
})

test('buildForm: @select prepends the current value when it is not in the options list', () => {
  const doc = setupDoc(`<span class="pr" data-pr="urgent" data-hcms-component="select" data-hcms-options="low medium high"></span>`)
  const rules = { pr: '.pr@data-pr' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { pr: 'urgent' }, doc })
  const select = frag.querySelector('select.mirk-select__field[data-hcms-field="pr"]')
  const opts = select.querySelectorAll('option')
  assert.equal(opts.length, 4, 'current value added as a fourth option')
  assert.equal(opts[0].value, 'urgent', 'current value is first')
  assert.equal(select.value, 'urgent', 'current value selected')
})

// --- 6. buildForm — @radio --------------------------------------------------

test('buildForm: @radio renders one row per option, shared name, matching value checked, humanized labels', () => {
  const doc = setupDoc(`<span class="st" data-st="in-progress" data-hcms-component="radio" data-hcms-options="todo in-progress done"></span>`)
  const rules = { status: '.st@data-st' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { status: 'in-progress' }, doc })
  const rows = frag.querySelectorAll('label.mirk-radio')
  assert.equal(rows.length, 3, 'three radio rows')
  const radios = frag.querySelectorAll('input[type="radio"][data-hcms-field="status"]')
  const names = new Set(Array.from(radios).map((r) => r.name))
  assert.equal(names.size, 1, 'all radios share one name')
  assert.ok([...names][0].startsWith('hcms-'), 'name is hcms-derived')
  const checked = Array.from(radios).filter((r) => r.checked).map((r) => r.value)
  assert.deepEqual(checked, ['in-progress'], 'only the page value is checked')
  const labels = Array.from(frag.querySelectorAll('.mirk-radio__label')).map((l) => l.textContent)
  assert.deepEqual(labels, ['Todo', 'In progress', 'Done'], 'labels humanized')
})

test('buildForm: @radio with no data-hcms-options shows the error and renders zero rows', () => {
  const doc = setupDoc(`<span class="st" data-st="" data-hcms-component="radio"></span>`)
  const rules = { status: '.st@data-st' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { status: '' }, doc })
  assert.equal(frag.querySelectorAll('.mirk-radio').length, 0, 'no radio rows')
  const err = frag.querySelector('.hcms-error')
  assert.ok(err && !err.hidden, 'error slot visible')
  assert.equal(err.textContent, 'data-hcms-options required (space-separated values)')
})

// --- 7. buildForm — @checkbox / @toggle ------------------------------------

test('buildForm: @checked-inferred checkbox renders a checked input[type=checkbox] for value "true"', () => {
  const doc = setupDoc(`<input class="flag" type="checkbox">`)
  const rules = { active: '.flag@checked' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { active: 'true' }, doc })
  const cb = frag.querySelector('input[type="checkbox"][data-hcms-field="active"]')
  assert.ok(cb, 'checkbox cloned')
  assert.equal(cb.checked, true, 'checked per value "true"')
  assert.ok(frag.querySelector('.mirk-checkbox'), 'checkbox chrome present')
})

test('buildForm: toggle override renders the .mirk-toggle chrome', () => {
  const doc = setupDoc(`<input class="flag" type="checkbox" data-hcms-component="toggle">`)
  const rules = { active: '.flag@checked' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { active: 'true' }, doc })
  assert.ok(frag.querySelector('.mirk-toggle'), 'toggle chrome present')
  const cb = frag.querySelector('input[type="checkbox"][data-hcms-field="active"]')
  assert.equal(cb.checked, true)
  assert.equal(frag.querySelector('.mirk-checkbox'), null, 'not the checkbox chrome')
})

// --- 8. buildForm — chips ---------------------------------------------------

test('buildForm: chips array renders one chip per item with matching values', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="chips"><li class="tag">a</li></ul>`)
  const rules = { tags: 'ul.tags li[]' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { tags: ['red', 'green'] }, doc })
  const arrayNode = frag.querySelector('.mirk-tags.hcms-array-items')
  assert.ok(arrayNode, 'chip list slot present')
  const host = frag.querySelector('[data-hcms-item-tpl="@chips-item"]')
  assert.ok(host, 'array node stamped with the chips item template key')
  const chips = arrayNode.querySelectorAll('.mirk-tags__chip')
  assert.equal(chips.length, 2, 'one chip per item')
  const inputs = arrayNode.querySelectorAll('input.hcms-chip-field')
  assert.equal(inputs.length, 2)
  assert.equal(inputs[0].value, 'red')
  assert.equal(inputs[1].value, 'green')
})

// --- 9. buildForm — crop copy ----------------------------------------------

test('buildForm: @image copies data-hcms-crop from the page element onto the built field', () => {
  const doc = setupDoc(`<img class="av" src="x.png" data-hcms-crop="1:1">`)
  const rules = { avatar: 'img.av@src' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { avatar: 'x.png' }, doc })
  const field = frag.querySelector('.hcms-upload--image')
  assert.ok(field, 'image widget cloned')
  assert.equal(field.getAttribute('data-hcms-crop'), '1:1', 'crop attr copied to the field')
})

// --- 10. injectComponents ---------------------------------------------------

test('injectComponents: a chips rule injects BOTH @chips and @chips-item templates', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="chips"><li class="tag">a</li></ul>`)
  injectDefaults(doc)
  injectComponents(doc, { tags: 'ul.tags li[]' })
  assert.ok(findTemplate(doc, '@chips'), '@chips injected')
  assert.ok(findTemplate(doc, '@chips-item'), '@chips-item injected')
})

test('injectComponents: a select rule injects @select', () => {
  const doc = setupDoc(`<span class="pr" data-hcms-component="select" data-hcms-options="a b" data-pr=""></span>`)
  injectDefaults(doc)
  injectComponents(doc, { pr: '.pr@data-pr' })
  assert.ok(findTemplate(doc, '@select'), '@select injected')
})

test('injectComponents: a plain rule injects none of the named-control templates', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  injectComponents(doc, { title: '.title' })
  assert.equal(findTemplate(doc, '@select'), null)
  assert.equal(findTemplate(doc, '@radio'), null)
  assert.equal(findTemplate(doc, '@chips'), null)
  assert.equal(findTemplate(doc, '@checkbox'), null)
})

// --- 11. deriveFormRules ----------------------------------------------------

test('deriveFormRules: select component emits a select[data-hcms-field]@value selector', () => {
  const doc = setupDoc(`<span class="pr" data-hcms-component="select" data-hcms-options="a b" data-pr=""></span>`)
  const rules = { pr: '.pr@data-pr' }
  prepare(doc, rules)
  const formRules = deriveFormRules(rules, doc)
  assert.equal(formRules.pr, 'select[data-hcms-field="pr"]@value')
})

test('deriveFormRules: inferred checkbox emits input[type="checkbox"]…@checked', () => {
  const doc = setupDoc(`<input class="flag" type="checkbox">`)
  const rules = { active: '.flag@checked' }
  prepare(doc, rules)
  const formRules = deriveFormRules(rules, doc)
  assert.equal(formRules.active, 'input[type="checkbox"][data-hcms-field="active"]@checked')
})

test('deriveFormRules: radio component emits input[type="radio"]:checked@value', () => {
  const doc = setupDoc(`<span class="st" data-hcms-component="radio" data-hcms-options="a b" data-st=""></span>`)
  const rules = { status: '.st@data-st' }
  prepare(doc, rules)
  const formRules = deriveFormRules(rules, doc)
  assert.equal(formRules.status, 'input[type="radio"][data-hcms-field="status"]:checked@value')
})

test('deriveFormRules: chips array item leaf emits an input…@value selector', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="chips"><li class="tag">a</li></ul>`)
  const rules = { tags: 'ul.tags li[]' }
  prepare(doc, rules)
  const formRules = deriveFormRules(rules, doc)
  assert.ok(Array.isArray(formRules.tags), 'scalar-array rule is the [containerSel, itemSel] form')
  const [, itemSel] = formRules.tags
  assert.equal(itemSel, 'input[data-hcms-field]@value', 'item leaf derived from the @chips-item template')
})

// --- 12. shadowing console.info --------------------------------------------

test('buildForm: a custom path template shadowing a named component logs console.info once', () => {
  const doc = setupDoc(`<span class="pr" data-pr="medium" data-hcms-component="select" data-hcms-options="low medium high"></span>`)
  // A custom template at the field's path outranks the named component.
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', 'pr')
  tpl.innerHTML = `<label class="hcms-field custom" data-hcms-shape="scalar"><span data-hcms-label></span><input data-hcms-field /><div class="hcms-error" hidden></div></label>`
  doc.head.appendChild(tpl)
  const rules = { pr: '.pr@data-pr' }
  prepare(doc, rules)

  const original = console.info
  const messages = []
  console.info = (...args) => messages.push(args.join(' '))
  try {
    buildForm({ pageRules: rules, formRules: null, data: { pr: 'medium' }, doc })
  } finally {
    console.info = original
  }
  assert.equal(messages.length, 1, 'console.info fired once')
  assert.ok(messages[0].includes('declares component'), 'message names the declared component')
  assert.ok(messages[0].includes('wins'), 'message says the custom template wins')
})

// --- 13. review fixes: number value-guard, options error, inferred shadow ---

test('componentForScalarRule: @number falls back to @scalar when the value is not number-shaped', () => {
  const doc = setupDoc(`
    <p class="price" data-hcms-component="number">$5</p>
    <p class="qty" data-hcms-component="number">7</p>
    <em class="pad" data-hcms-component="number"> 100 </em>
    <span class="attr" data-hcms-component="number" data-n=" 7 "></span>`)
  assert.equal(componentForScalarRule('.price', doc), '@scalar', 'non-numeric text falls back')
  assert.equal(componentForScalarRule('.qty', doc), '@number', 'plain numeric stays @number')
  assert.equal(componentForScalarRule('.pad', doc), '@number', 'text extracts trim, so padded text stays @number')
  assert.equal(componentForScalarRule('.attr@data-n', doc), '@scalar', 'attrs extract raw, padded attr falls back')
})

test('buildForm: @number fallback renders a text input that preserves the value, and logs the fallback', () => {
  const doc = setupDoc(`<p class="price" data-hcms-component="number">$5</p>`)
  const rules = { price: '.price' }
  prepare(doc, rules)
  const original = console.info
  const messages = []
  console.info = (...args) => messages.push(args.join(' '))
  let frag
  try {
    frag = buildForm({ pageRules: rules, formRules: null, data: { price: '$5' }, doc })
  } finally {
    console.info = original
  }
  const input = frag.querySelector('input[data-hcms-field="price"]')
  assert.ok(input, 'leaf input rendered')
  assert.notEqual(input.getAttribute('type'), 'number', 'not a number input')
  assert.equal(input.value, '$5', 'value preserved, not blanked')
  assert.ok(messages.some((m) => m.includes('@number') && m.includes('preserved')), 'fallback logged')
  // The derived form rule matches the rendered control, so extract sees the value.
  const formRules = deriveFormRules(rules, doc)
  assert.ok(!String(formRules.price).includes('type="number"'), 'derived selector is not number-typed')
})

test('buildForm: missing data-hcms-options with a NON-empty value still shows the error (select renders the value)', () => {
  const doc = setupDoc(`<span class="pr" data-pr="medium" data-hcms-component="select"></span>`)
  const rules = { pr: '.pr@data-pr' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { pr: 'medium' }, doc })
  const err = frag.querySelector('.hcms-error')
  assert.ok(err && !err.hidden, 'error visible despite the non-empty value')
  assert.equal(err.textContent, 'data-hcms-options required (space-separated values)')
  const options = frag.querySelectorAll('option')
  assert.equal(options.length, 1, 'current value rendered as the single option')
  assert.equal(options[0].value, 'medium')
  assert.equal(frag.querySelector('select').value, 'medium', 'value round-trips')
})

test('buildForm: missing data-hcms-options with a NON-empty value still shows the error (radio renders the value)', () => {
  const doc = setupDoc(`<span class="co" data-co="red" data-hcms-component="radio"></span>`)
  const rules = { co: '.co@data-co' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { co: 'red' }, doc })
  const err = frag.querySelector('.hcms-error')
  assert.ok(err && !err.hidden, 'error visible despite the non-empty value')
  const radios = frag.querySelectorAll('input[type="radio"]')
  assert.equal(radios.length, 1, 'current value rendered as the single radio')
  assert.equal(radios[0].value, 'red')
  assert.ok(radios[0].checked, 'current value checked')
})

test('buildForm: a custom template shadowing an INFERRED component does NOT log (only explicit declarations do)', () => {
  const doc = setupDoc(`<img class="av" src="x.png">`)
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', 'avatar')
  tpl.innerHTML = `<label class="hcms-field custom" data-hcms-shape="scalar"><span data-hcms-label></span><input data-hcms-field /><div class="hcms-error" hidden></div></label>`
  doc.head.appendChild(tpl)
  const rules = { avatar: 'img.av@src' }
  prepare(doc, rules)
  const original = console.info
  const messages = []
  console.info = (...args) => messages.push(args.join(' '))
  try {
    buildForm({ pageRules: rules, formRules: null, data: { avatar: 'x.png' }, doc })
  } finally {
    console.info = original
  }
  assert.equal(messages.length, 0, 'no shadowing notice for inferred @image')
})

// --- 14. codex fixes: all-match guards, restamped radio names, shadow purity -

test('componentForScalarRule: under an array the @number guard checks EVERY matching element', () => {
  const itemPath = ['items', '*', 'qty']
  const doc = setupDoc(`
    <div class="item"><span class="qty" data-hcms-component="number">5</span></div>
    <div class="item"><span class="qty">TBD</span></div>`)
  assert.equal(componentForScalarRule('.qty', doc, itemPath), '@scalar', 'one non-numeric card vetoes the rule')
  const allNumeric = setupDoc(`
    <div class="item"><span class="qty" data-hcms-component="number">5</span></div>
    <div class="item"><span class="qty">12</span></div>`)
  assert.equal(componentForScalarRule('.qty', allNumeric, itemPath), '@number', 'all numeric stays @number')
})

test('componentForScalarRule: a decorative second match does NOT veto a top-level scalar (engine binds only the first)', () => {
  const doc = setupDoc(`
    <h1 class="price" data-hcms-component="number">42</h1>
    <p class="price">Call for quote</p>
    <span class="pub" data-hcms-component="checkbox" data-v="true"></span>
    <span class="pub" data-v="yes"></span>`)
  assert.equal(componentForScalarRule('.price', doc, ['price']), '@number', 'the bound first match is numeric')
  assert.equal(componentForScalarRule('.pub@data-v', doc, ['published']), '@checkbox', 'the bound first match is canonical')
})

test('componentForScalarRule: value guards ignore cms-template seeds and the shell (extraction never reads them)', () => {
  const doc = setupDoc(`
    <div class="item" cms-template><span class="qty" data-hcms-component="number">…</span></div>
    <div class="item"><span class="qty">5</span></div>
    <div data-hcms-shell><span class="qty">draft text</span></div>`)
  assert.equal(componentForScalarRule('.qty', doc, ['items', '*', 'qty']), '@number', 'seed placeholder and shell text get no vote')
})

test('componentForScalarRule: explicit checkbox/toggle fall back to @scalar when the value is not true/false', () => {
  const doc = setupDoc(`
    <span class="yes" data-hcms-component="checkbox" data-v="yes"></span>
    <span class="tru" data-hcms-component="checkbox" data-v="true"></span>
    <span class="fal" data-hcms-component="toggle" data-v="false"></span>
    <span class="emp" data-hcms-component="toggle" data-v=""></span>
    <span class="on" data-hcms-component="toggle" data-v="on"></span>`)
  assert.equal(componentForScalarRule('.yes@data-v', doc), '@scalar', '"yes" would be clobbered to "false"')
  assert.equal(componentForScalarRule('.tru@data-v', doc), '@checkbox')
  assert.equal(componentForScalarRule('.fal@data-v', doc), '@toggle')
  assert.equal(componentForScalarRule('.emp@data-v', doc), '@toggle', 'empty means unchecked, faithful')
  assert.equal(componentForScalarRule('.on@data-v', doc), '@scalar', '"on" is not canonical')
  const mixed = setupDoc(`
    <div class="item"><span class="ok" data-hcms-component="checkbox" data-v="true"></span></div>
    <div class="item"><span class="ok" data-v="yes"></span></div>`)
  assert.equal(
    componentForScalarRule('.ok@data-v', mixed, ['items', '*', 'ok']),
    '@scalar',
    'under an array, one non-canonical card vetoes the rule'
  )
})

test('componentForScalarRule: @checked rules are exempt from the canonical-bool guard', () => {
  // checked="checked" is non-canonical as a string, but @checked round-trips
  // the checked PROPERTY, so the guard must not fire.
  const doc = setupDoc(`<input class="flag" type="checkbox" checked="checked" data-hcms-component="toggle">`)
  assert.equal(componentForScalarRule('.flag@checked', doc), '@toggle')
})

test('buildForm: checkbox fallback renders a text input that preserves the value, and logs the fallback', () => {
  const doc = setupDoc(`<span class="pub" data-hcms-component="checkbox" data-v="yes"></span>`)
  const rules = { published: '.pub@data-v' }
  prepare(doc, rules)
  const original = console.info
  const messages = []
  console.info = (...args) => messages.push(args.join(' '))
  let frag
  try {
    frag = buildForm({ pageRules: rules, formRules: null, data: { published: 'yes' }, doc })
  } finally {
    console.info = original
  }
  const input = frag.querySelector('input[data-hcms-field="published"]')
  assert.ok(input, 'leaf input rendered')
  assert.notEqual(input.getAttribute('type'), 'checkbox', 'not a checkbox')
  assert.equal(input.value, 'yes', 'value preserved, not coerced to false')
  assert.ok(messages.some((m) => m.includes('@checkbox') && m.includes('preserved')), 'fallback logged')
})

test('buildForm: a custom template shadowing @select is NOT mutated (no injected options, no error)', () => {
  const doc = setupDoc(`<span class="pr" data-pr="medium" data-hcms-component="select" data-hcms-options="low medium high"></span>`)
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', 'pr')
  tpl.innerHTML = `<label class="hcms-field custom" data-hcms-shape="scalar"><span data-hcms-label></span><select data-hcms-field><option value="medium">Med</option></select><div class="hcms-error" hidden></div></label>`
  doc.head.appendChild(tpl)
  const rules = { pr: '.pr@data-pr' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { pr: 'medium' }, doc })
  const select = frag.querySelector('select[data-hcms-field="pr"]')
  assert.equal(select.querySelectorAll('option').length, 1, "author's single option untouched")
  assert.equal(select.value, 'medium', 'value still written')
  const err = frag.querySelector('.hcms-error')
  assert.ok(err.hidden, 'no options-required error injected into the custom UI')
})

test('buildForm: a custom template shadowing @image does NOT receive the crop stamp', () => {
  const doc = setupDoc(`<img class="av" src="x.png" data-hcms-crop="1:1">`)
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', 'avatar')
  tpl.innerHTML = `<label class="hcms-field custom" data-hcms-shape="scalar"><span data-hcms-label></span><input data-hcms-field /><div class="hcms-error" hidden></div></label>`
  doc.head.appendChild(tpl)
  const rules = { avatar: 'img.av@src' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { avatar: 'x.png' }, doc })
  const field = frag.querySelector('.custom')
  assert.ok(field, 'custom template won')
  assert.equal(field.hasAttribute('data-hcms-crop'), false, 'crop not grafted onto the custom UI')
})

test('buildForm: a custom template shadowing chips keeps default items and gets no data-hcms-item-tpl stamp', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="chips"><li class="tag">a</li></ul>`)
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', 'tags')
  tpl.innerHTML = `<section class="hcms-array custom" data-hcms-shape="scalar-array"><h3 data-hcms-label></h3><ul class="hcms-array-items"></ul><button type="button" data-hcms-action="add">+</button><div class="hcms-error" hidden></div></section>`
  doc.head.appendChild(tpl)
  const rules = { tags: 'ul.tags li[]' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { tags: ['red', 'green'] }, doc })
  assert.ok(frag.querySelector('.custom'), 'custom array template won')
  assert.equal(frag.querySelector('[data-hcms-item-tpl]'), null, 'no chips item-template stamp')
  assert.equal(frag.querySelectorAll('.mirk-tags__chip').length, 0, 'no chip chrome grafted in')
  const items = frag.querySelectorAll('li.hcms-array-item')
  assert.equal(items.length, 2, 'default scalar-array items render')
  assert.equal(items[0].querySelector('input[data-hcms-field]').value, 'red')
})

test('restampAllSiblings: radio group names follow restamped paths, so a re-added sibling cannot collide', () => {
  const doc = setupDoc(`
    <div class="items">
      <div class="item"><span class="pr" data-pr="low" data-hcms-component="radio" data-hcms-options="low high"></span></div>
      <div class="item"><span class="pr" data-pr="high"></span></div>
    </div>`)
  const rules = { items: ['.item', { pr: '.pr@data-pr' }] }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { items: [{ pr: 'low' }, { pr: 'high' }] }, doc })
  const mount = doc.createElement('div')
  mount.appendChild(frag)
  const cards = mount.querySelectorAll('[data-hcms-card]')
  assert.equal(cards.length, 2)
  const nameOf = (card) => card.querySelector('input[type="radio"]').name
  const name0 = nameOf(cards[0])
  const name1 = nameOf(cards[1])
  assert.notEqual(name0, name1, 'sibling cards start in distinct groups')
  assert.equal(name0, radioGroupName('items.0.pr'), 'name derives from the path formula')

  // Remove card 0 the way the sidebar does, then restamp. The survivor moves
  // to index 0 and its radios must move group with it — otherwise an item
  // added later at index 1 would share the survivor's stale group and uncheck
  // it (null extract → whole-form commit clobbers the page value).
  cards[0].remove()
  restampAllSiblings(mount)
  const survivor = mount.querySelector('[data-hcms-card]')
  assert.equal(survivor.getAttribute('data-hcms-path'), 'items.0', 'path restamped')
  const radios = survivor.querySelectorAll('input[type="radio"]')
  assert.ok(radios.length >= 2, 'radio rows present')
  for (const r of radios) {
    assert.equal(r.name, radioGroupName('items.0.pr'), 'group name follows the restamped path')
  }
  const checked = Array.from(radios).filter((r) => r.checked).map((r) => r.value)
  assert.deepEqual(checked, ['high'], 'checked state survives the restamp')
})

// --- 15. verification round: reorder collision, chips lockstep, author names -

test('restampAllSiblings: a reorder does not uncheck sibling radios (transient name collision)', () => {
  const doc = setupDoc(`
    <div class="items">
      <div class="item"><span class="pr" data-pr="low" data-hcms-component="radio" data-hcms-options="low high"></span></div>
      <div class="item"><span class="pr" data-pr="high"></span></div>
    </div>`)
  const rules = { items: ['.item', { pr: '.pr@data-pr' }] }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { items: [{ pr: 'low' }, { pr: 'high' }] }, doc })
  const mount = doc.createElement('div')
  mount.appendChild(frag)
  const slot = mount.querySelector('.hcms-array-items')
  const cards = slot.querySelectorAll('[data-hcms-card]')
  // Move card 1 above card 0 the way onMove / a sortable drop reorders the
  // DOM, then restamp. Mid-restamp, card 1's radios are renamed into card 0's
  // still-stale group; without the checked snapshot one of the two checked
  // radios is permanently lost.
  slot.insertBefore(cards[1], cards[0])
  restampAllSiblings(mount)
  const byCard = Array.from(mount.querySelectorAll('[data-hcms-card]')).map((card) =>
    Array.from(card.querySelectorAll('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value)
  )
  assert.deepEqual(byCard, [['high'], ['low']], 'each card keeps its own checked radio through the reorder')
  const names = Array.from(mount.querySelectorAll('[data-hcms-card]')).map(
    (card) => card.querySelector('input[type="radio"]').name
  )
  assert.deepEqual(names, [radioGroupName('items.0.pr'), radioGroupName('items.1.pr')], 'names follow the new order')
})

test('lockstep: an overridden @chips-item plus a shadowing custom array template still round-trips', () => {
  const doc = setupDoc(`<ul class="tags" data-hcms-component="chips"><li class="tag">a</li></ul>`)
  // The author overrides the chips ITEM template with a non-<input> leaf…
  const itemTpl = doc.createElement('template')
  itemTpl.setAttribute('data-hcms-tpl', '@chips-item')
  itemTpl.innerHTML = `<span class="my-chip" data-hcms-array-item><textarea data-hcms-field></textarea><button type="button" data-hcms-action="remove">×</button></span>`
  doc.head.appendChild(itemTpl)
  // …AND a custom array template shadows @chips at the path. The shadow
  // verdict must reach BOTH the builder (item chrome) and deriveFormRules
  // (item leaf selector), or extraction reads null for every item.
  const arrTpl = doc.createElement('template')
  arrTpl.setAttribute('data-hcms-tpl', 'tags')
  arrTpl.innerHTML = `<section class="hcms-array custom" data-hcms-shape="scalar-array"><h3 data-hcms-label></h3><ul class="hcms-array-items"></ul><button type="button" data-hcms-action="add">+</button><div class="hcms-error" hidden></div></section>`
  doc.head.appendChild(arrTpl)
  const rules = { tags: 'ul.tags li[]' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { tags: ['red', 'green'] }, doc })
  const mount = doc.createElement('div')
  mount.appendChild(frag)
  doc.body.appendChild(mount)
  const formRules = deriveFormRules(rules, doc)
  const extracted = engine.extract(mount, formRules)
  assert.equal(JSON.stringify(extracted), JSON.stringify({ tags: ['red', 'green'] }), 'derived selector matches the rendered leaf')
})

test('restampAllSiblings: inline-template radios keep their author-set names', () => {
  const doc = setupDoc(`
    <div class="items">
      <div class="item"><span class="c" data-c="red"></span></div>
      <div class="item"><span class="c" data-c="blue"></span></div>
    </div>`)
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', 'items.*')
  tpl.innerHTML = `<div class="card-inline"><input type="radio" name="author-c" value="red" data-hcms-field="c"><input type="radio" name="author-c" value="blue" data-hcms-field="c"></div>`
  doc.head.appendChild(tpl)
  const rules = { items: ['.item', { c: '.c@data-c' }] }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { items: [{ c: 'red' }, { c: 'blue' }] }, doc })
  const mount = doc.createElement('div')
  mount.appendChild(frag)
  const cards = mount.querySelectorAll('[data-hcms-card]')
  assert.equal(cards.length, 2)
  cards[0].remove()
  restampAllSiblings(mount)
  const survivor = mount.querySelector('[data-hcms-card]')
  const radios = survivor.querySelectorAll('input[type="radio"]')
  for (const r of radios) {
    assert.equal(r.name, 'author-c', 'author-minted name untouched by the restamp')
  }
  const checked = Array.from(radios).filter((r) => r.checked).map((r) => r.value)
  assert.deepEqual(checked, ['blue'], 'checked state intact')
})
