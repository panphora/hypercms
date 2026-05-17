# hypercms

Live edit-in-place CMS sidebar for any HTML page with a [`hyper-html-api`](https://github.com/panphora/hyper-html-api) rules tag.

## Quick start

Your page already has a rules tag:

```html
<script id="hyper-html-api" data-rules-version="1" type="application/json">
{
  "title": ".page-title",
  "products": [".product", { "name": ".name", "price": ".price@data-cents" }]
}
</script>
```

Add hypercms:

```html
<script type="module">
  import { cms } from 'https://cdn.jsdelivr.net/npm/hypercms@latest/src/hypercms.js'
  document.querySelector('#edit-btn').addEventListener('click', () => cms.open())
</script>
<button id="edit-btn">Edit</button>
```

That's it. A right sidebar slides in with a form per field. Edits stream live into the page DOM.

## In hyperclayjs apps

hypercms ships bundled in hyperclayjs's `smooth-sailing` and `everything` presets, exposed at `window.hyperclay.hypercms`:

```html
<button onclick="hyperclay.hypercms.open()">Edit</button>
```

## Custom templates

Drop a `<template>` anywhere in the page to override the default form for a given path:

```html
<template data-hcms-tpl="products.*">
  <div class="my-product-card">
    <input data-hcms-field="name" placeholder="Name" />
    <input data-hcms-field="price" placeholder="Price" />
    <button data-hcms-action="remove">×</button>
  </div>
</template>
```

The library picks it up automatically. No registration.

## API

```
cms.open(opts?)
cms.close()
cms.refresh()
cms.isOpen

cms.api.getData()
cms.api.setValue(path, value)
cms.api.addItem(arrayPath)
cms.api.removeItem(itemPath)
```

Events fire on the shell root and bubble: `hcms:open`, `hcms:close`, `hcms:change`, `hcms:save`, `hcms:error`.

## Drag-to-reorder

In hyperclayjs apps, drag works out of the box (hypercms uses hyperclayjs's `[sortable]` custom-attribute). For standalone use, install `sortablejs` separately and the form's add/remove buttons still work without it.

## License

0BSD.
