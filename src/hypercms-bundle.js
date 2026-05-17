import * as core from './hypercms.js'
import stylesText from './styles.css'

core.installStyles(stylesText)

export const cms = core.cms
export default { cms: core.cms }
