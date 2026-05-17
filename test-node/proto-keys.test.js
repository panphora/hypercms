import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { deriveFormRules } from '../src/form-rules.js'

function setupDoc() {
  return new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window.document
}

// Use JSON.parse to produce an actual own `__proto__` property — the literal
// `{ __proto__: ... }` syntax assigns the prototype instead.
test('deriveFormRules: __proto__ as a rule key throws', () => {
  const doc = setupDoc()
  const rules = JSON.parse('{"__proto__":".x"}')
  assert.throws(() => deriveFormRules(rules, doc), /forbidden/)
})

test('deriveFormRules: constructor as a rule key throws', () => {
  const doc = setupDoc()
  const rules = JSON.parse('{"constructor":".x"}')
  assert.throws(() => deriveFormRules(rules, doc), /forbidden/)
})

test('deriveFormRules: __proto__ nested in object-array item throws', () => {
  const doc = setupDoc()
  const itemShape = JSON.parse('{"__proto__":".x"}')
  assert.throws(
    () => deriveFormRules({ products: ['.p', itemShape] }, doc),
    /forbidden/
  )
})

test('deriveFormRules: null-prototype output prevents prototype pollution', () => {
  const doc = setupDoc()
  const rules = deriveFormRules({ a: '.a' }, doc)
  assert.equal(Object.getPrototypeOf(rules), null)
})
