import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { commit } from '../src/events.js'
import { refreshForm } from '../src/refresh.js'

// Tier 1b (6b): refreshForm calls morphForm (which rebuilds the form and wipes
// inline .hcms-error slots) and then applyErrorState to re-stamp them. Commit a
// validation error so an inline slot is rendered, then refreshForm, and assert
// the slot reappears with the same message on a freshly-rebuilt node.
// events.test.js covers the initial stamp; nothing asserts the survive-refresh
// restore that refresh.js:34-37 promises.

const PAGE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">A</h1>
</body></html>`

function buildCtx(pageRules, data) {
  const doc = document
  injectDefaults(doc)
  const formRules = deriveFormRules(pageRules, doc)
  const formHost = doc.createElement('div')
  formHost.setAttribute('data-hcms-form-root', '')
  doc.body.appendChild(formHost)
  const fragment = buildForm({ pageRules, formRules, data, doc })
  formHost.appendChild(fragment)
  const errorEl = doc.createElement('div')
  errorEl.hidden = true
  return {
    doc,
    pageRoot: doc.body,
    pageRules,
    formRules,
    formRoot: formHost,
    rulesSource: 'cms',
    errorEl,
    lastFingerprint: null,
    lastData: null,
    lastErrors: null,
    observerHandle: null,
    dispatch: () => {},
    updateFingerprint: () => {},
  }
}

function titleErrorSlot(ctx) {
  return ctx.formRoot.querySelector('[data-hcms-path="title"] > .hcms-error')
}

test('refresh re-stamps the inline error slot after morphForm wipes it', () => {
  const dom = loadPage(PAGE)
  const ctx = buildCtx({ title: '.title' }, { title: 'A' })
  try {
    // Object where the title scalar is expected → ShapeMismatch at path "title",
    // which stamps the inline error slot under the title field.
    const result = commit({ title: { bad: 'shape' } }, { path: 'title', structural: false }, ctx)
    assert.equal(result.ok, false, 'the apply failed as expected')

    const slotBefore = titleErrorSlot(ctx)
    assert.ok(slotBefore, 'inline error slot exists after the failed commit')
    assert.equal(slotBefore.hidden, false, 'inline error slot is visible')
    assert.ok(slotBefore.textContent.length > 0, 'inline error slot carries the message')
    const messageBefore = slotBefore.textContent

    // morphForm wipes the inline slot's content as part of rebuilding the form.
    // Prove the morph really clears it: with applyErrorState removed from the
    // path, the slot would morph back empty/hidden. We confirm the slot starts
    // populated, then assert it is repopulated after the full refresh.
    refreshForm(ctx)

    const slotAfter = titleErrorSlot(ctx)
    assert.ok(slotAfter, 'inline error slot still exists after refresh')
    assert.equal(slotAfter.hidden, false, 'the error slot is still visible after refresh')
    assert.equal(
      slotAfter.textContent,
      messageBefore,
      'applyErrorState re-stamps the same message onto the slot after the morph',
    )
  } finally {
    dom.window.close()
  }
})
