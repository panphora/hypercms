import HyperMorph from 'hyper-morph'

export function morphForm(formRoot, newFragment, { ignoreActiveValue = true } = {}) {
  HyperMorph.morph(formRoot, newFragment, {
    morphStyle: 'innerHTML',
    ignoreActiveValue,
    restoreFocus: true,
    formStateSync: 'property',
  })
}
