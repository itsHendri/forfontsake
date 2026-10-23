import { FINISHES, PICTURE_EFFECTS, type Finish, type FinishState } from './finish'
import { getGround, type PosterLayout, type SheetFormat, type WordTransform } from './poster'

/**
 * What Compose has selected, which is what its right panel edits.
 *
 * The Figma model, as Hendri asked for it in October: the layers on the
 * left, the properties of whatever is selected on the right, and the sheet
 * itself as the thing that is selected when nothing else is — the way Figma
 * shows the frame. `finishes` is the stack as a whole (the row on a desktop,
 * the chip on a phone); `finish:<id>` is one of them.
 */
export type Selection = 'sheet' | 'word' | 'background' | 'finishes' | `finish:${string}`

/** the finish a selection names, if it names one */
export function finishOf(sel: Selection): Finish | undefined {
  return sel.startsWith('finish:') ? FINISHES.find((f) => `finish:${f.id}` === sel) : undefined
}

/** everything a row needs to say about itself without being opened */
export interface LayerState {
  layout: PosterLayout
  word: string
  format: SheetFormat
  finishes: FinishState
  wordT: WordTransform
  ground: string
  backdrop: string | null
  picture: FinishState
  motionOn: boolean
}

export interface LayerRow {
  sel: Selection
  name: string
  /** what the row says about itself, so the list is worth reading without selecting anything */
  sub: string
  /** a glyph standing in for the kind of layer, as Figma's icons do */
  icon: string
  /** one step in, under the row it belongs to */
  nested?: boolean
}

/** the finishes that are on, in the order the shader applies them */
export function finishesOn(finishes: FinishState): Finish[] {
  return FINISHES.filter((f) => finishes[f.id]?.on)
}

/**
 * The finishes "+ Add finish" offers: the ones that are off. Adding one back
 * brings its dials back as they were left, because a finish turned off keeps
 * its params.
 */
export function addable(finishes: FinishState): Finish[] {
  return FINISHES.filter((f) => !finishes[f.id]?.on)
}

/** the word's own line: where it sits, or that it moves */
function wordSub(s: LayerState): string {
  if (s.motionOn) return '~ moves'
  if (s.layout.id !== 'word') return 'set to the sheet'
  const { dx, dy, scale, rotate } = s.wordT
  return dx === 0 && dy === 0 && scale === 1 && (rotate ?? 0) === 0 ? 'centred' : `placed · ${scale.toFixed(2)}×`
}

function backgroundSub(s: LayerState): string {
  if (!s.backdrop) return getGround(s.ground).name.toLowerCase()
  const on = PICTURE_EFFECTS.filter((f) => s.picture[f.id]?.on).map((f) => f.name.toLowerCase())
  return on.length > 0 ? `picture · ${on.join(' · ')}` : 'picture'
}

/**
 * The sheet as its layers, topmost first, the way every layer list reads.
 *
 * The sheet heads it as the frame does in Figma. The finishes are a group, with
 * a row under it for each one that is on; the word on the Word sheet is named
 * by what it says, the other sheets by their layout.
 */
export function layerRows(s: LayerState): LayerRow[] {
  const on = finishesOn(s.finishes)
  return [
    { sel: 'sheet', name: 'Sheet', sub: `${s.format.name} ${s.format.ratio}`, icon: '#' },
    {
      sel: 'finishes',
      name: 'Finishes',
      sub: on.length > 0 ? on.map((f) => f.name).join(' · ') : 'none',
      icon: '✦',
    },
    ...on.map((f): LayerRow => ({ sel: `finish:${f.id}`, name: f.name, sub: '', icon: '·', nested: true })),
    {
      sel: 'word',
      name: s.layout.id === 'word' && s.word.trim() ? s.word.trim() : s.layout.name,
      sub: wordSub(s),
      icon: 'T',
    },
    { sel: 'background', name: 'Background', sub: backgroundSub(s), icon: '▢' },
  ]
}

/**
 * The sheet in one line — the folded sections when motion is on, and the
 * phone's peek: "Word · Post 4:5 · Still".
 */
export function sheetSummary(s: { layout: PosterLayout; format: SheetFormat; motion: string | null }): string {
  return [s.layout.name, `${s.format.name} ${s.format.ratio}`, s.motion ?? 'Still'].join(' · ')
}
