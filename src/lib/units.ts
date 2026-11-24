import type { ParamSpec } from '../engine/treatments/registry'

/** the value as the panel writes it, in the spec's unit */
export function shown(v: number, spec: ParamSpec): string {
  if (spec.unit === '%') return `${Math.round(v * 100)}%`
  if (spec.unit === '×') return `${v.toFixed(2)}×`
  return String(v)
}

/** what was typed, read back in the spec's unit: "35", "35%" and "35 %" are all 0.35 on a % dial */
export function typed(raw: string, spec: ParamSpec): number | null {
  const n = Number.parseFloat(raw.replace(',', '.'))
  if (Number.isNaN(n)) return null
  return spec.unit === '%' ? n / 100 : n
}

/** how many decimals the step implies: 0.1 shows one, 1 shows none */
function decimals(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

/** snap to the spec's step and keep it inside the range */
export function settle(v: number, spec: ParamSpec): number {
  const snapped = Math.round((v - spec.min) / spec.step) * spec.step + spec.min
  return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toFixed(decimals(spec.step)))
}
