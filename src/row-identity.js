/**
 * Row identity supplied to the engine, so two byte-identical rows can still be
 * told apart on a remove or a reorder.
 *
 * The engine matches rows by content, which is exact for every operation the
 * form emits except one: when two rows read identically, "remove row 0" and
 * "remove row 1" produce the same array, and no score can separate them. The
 * form can, because it holds a handle the engine never sees, its own row
 * elements.
 *
 * Those elements are stable across the operations that matter. A keystroke
 * never rebuilds the form (applyWithRollback pauses the mutation observer
 * around apply), and add, remove and move mutate the form DOM in place rather
 * than re-rendering it. By the time commit() runs the form is already in its
 * new shape, so walking its rows in order gives the new item order with each
 * row still carrying the page node it came from. The permutation falls out.
 *
 * refreshForm does re-render the form, through hyper-morph, when the page
 * changes underneath us (livesync, undo, another session). Rows rebuilt there
 * have no entry, identifyRows returns null for them, and the engine's matcher
 * takes over. onRowsApplied re-establishes the pairing on the next apply. That
 * is correct rather than merely tolerable: the form was just built from a fresh
 * read of the page, so index correspondence is exact at that instant.
 */
const boundNode = new WeakMap()

// The engine's trace path as the form writes it in data-hcms-path.
const pathKey = (path) => path.map(String).join('.')

// Rule keys reach the selector verbatim, and a key holding a quote makes
// querySelector throw. Every other path-into-selector site in this package
// escapes the same way; this is that function, kept module-local like the rest.
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
}

// The form rows for one list, in document order, or null when the form has no
// such list. Keys look like "products" or "products.0.variants".
function formRowsAt(formRoot, key) {
  if (!formRoot || !formRoot.querySelector) return null
  const container = formRoot.querySelector(`[data-hcms-path="${cssEscape(key)}"]`)
  const slot = container && container.querySelector('.hcms-array-items')
  if (!slot) return null
  // Direct children, filtered, rather than `:scope > ...`. jsdom's selector
  // engine resolves `:scope >` against the document rather than the slot and
  // returns descendants, so a page with nested lists reported the inner rows as
  // rows of the outer list. The count then failed to match and identity silently
  // fell back to content matching in exactly the shape this exists for.
  return Array.from(slot.children).filter(
    (el) => el.matches && el.matches('[data-hcms-card], [data-hcms-array-item]'),
  )
}

function bind(formRoot, key, nodes) {
  const rows = formRowsAt(formRoot, key)
  if (!rows || rows.length !== nodes.length) return
  rows.forEach((row, i) => {
    if (nodes[i]) boundNode.set(row, nodes[i])
  })
}

/**
 * Establish identity from the extract the form is built from, before any apply
 * has happened.
 *
 * Without this the map is populated only by onRowsApplied, so the FIRST
 * structural operation of a session has nothing to go on and falls back to
 * content matching. Pass `hooks` to the top-level `engine.extract` that feeds
 * buildForm, then call `seed(formRoot)` once the form rows exist. At that
 * moment row i of the form is row i of the page by construction, because the
 * form was built from exactly this read.
 *
 * Never pass these hooks to `apply`: listDiff re-extracts each existing row
 * with a fresh path, which would report nested lists under a truncated one.
 */
export function rowIdentitySeeder() {
  const readNodes = new Map()
  return {
    hooks: {
      onRowsRead(path, nodes) {
        readNodes.set(pathKey(path), nodes)
      },
    },
    seed(formRoot) {
      for (const [key, nodes] of readNodes) bind(formRoot, key, nodes)
      readNodes.clear()
    },
  }
}

export function rowIdentityHooks(formRoot) {
  return {
    identifyRows(path, items) {
      const rows = formRowsAt(formRoot, pathKey(path))
      // A count mismatch means the form and the data disagree about this list,
      // so the form is not a trustworthy witness for it. Say nothing and let
      // the engine match.
      if (!rows || rows.length !== items.length) return null
      return rows.map((row) => boundNode.get(row) || null)
    },
    onRowsApplied(path, nodes) {
      bind(formRoot, pathKey(path), nodes)
    },
  }
}

// Testing seam only: the WeakMap is module state and a test needs to observe it.
export function boundNodeFor(formRow) {
  return boundNode.get(formRow) || null
}
