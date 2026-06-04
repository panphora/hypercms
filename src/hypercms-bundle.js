import * as core from './hypercms.js'
import themeText from './theme.generated.css'
// Install mirk's delegated component runtime (tags chips, number stepper, etc.)
// as a side effect. Idempotent + document-delegated, so safe to include once.
import './vendor/mirk.vendor.js'

core.installStyles(themeText)

export const cms = core.cms
export default { cms: core.cms }
