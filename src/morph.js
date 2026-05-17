import HyperMorph from 'hyper-morph'

export function morphForm(formRoot, newFragment) {
  HyperMorph.morph(formRoot, newFragment, {
    morphStyle: 'innerHTML',
    ignoreActiveValue: true,
    restoreFocus: true,
    formStateSync: 'property',
  })
}
