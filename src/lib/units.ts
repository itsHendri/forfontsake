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
