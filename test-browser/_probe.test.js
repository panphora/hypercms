import { expect } from '@open-wc/testing'

describe('probe failing dom-node assertion', () => {
  it('fails with a DOM element as actual', () => {
    const btn = document.createElement('button')
    btn.innerHTML = '<span>Edit content</span>'
    document.body.appendChild(btn)
    expect(document.querySelector('button')).to.equal(null)
  })
})
