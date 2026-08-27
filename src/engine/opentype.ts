// opentype.js resolves to its ESM build under Vite (named exports) and to CJS
// under Node (a single default export). Normalise so engine code imports one way.
import * as OT from 'opentype.js'

const impl = ((OT as unknown as { default?: typeof OT }).default ?? OT) as typeof OT

export const { Font, Glyph, Path, parse } = impl
export type { Font as FontType, Glyph as GlyphType, PathCommand } from 'opentype.js'
