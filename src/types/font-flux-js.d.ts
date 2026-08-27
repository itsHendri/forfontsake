/**
 * Minimal typings for font-flux-js — it ships none. Covers only what the
 * engine uses; widen as needed rather than reaching for `any` at call sites.
 */
declare module 'font-flux-js' {
  export interface FluxPoint {
    x: number
    y: number
    onCurve: boolean
  }

  /** a reference to another glyph, optionally offset and transformed */
  export interface FluxComponent {
    glyphIndex: number
    flags?: { argsAreXYValues?: boolean }
    argument1?: number
    argument2?: number
    xScale?: number
    yScale?: number
    scale01?: number
    scale10?: number
    scale?: number
  }

  export interface FluxGlyph {
    name: string
    unicode?: number
    unicodes?: number[]
    advanceWidth: number
    leftSideBearing?: number
    /** absent on composite glyphs, which carry components instead */
    contours?: FluxPoint[][]
    components?: FluxComponent[]
  }

  export interface FluxInfo {
    familyName: string
    styleName: string
    fullName?: string
    postScriptName?: string
    uniqueID?: string
    version?: string
    designer?: string
    description?: string
    copyright?: string
    license?: string
    licenseURL?: string
    trademark?: string
    manufacturer?: string
    vendorURL?: string
    designerURL?: string
    unitsPerEm: number
    ascender?: number
    descender?: number
    [key: string]: unknown
  }

  export interface ValidationReport {
    valid: boolean
    errors?: string[]
    warnings?: string[]
    issues?: string[]
  }

  export interface ExportOptions {
    format?: 'sfnt' | 'woff' | 'woff2' | 'cff' | 'ttf' | 'otf'
  }

  export interface HintingTables {
    cvt?: unknown
    fpgm?: unknown
    prep?: unknown
    gasp?: unknown
  }

  export class FontFlux {
    static open(input: ArrayBuffer | Uint8Array | string): FontFlux
    static create(options: Record<string, unknown>): FontFlux
    static svgToContours(d: string, format?: string): FluxPoint[][]
    static contoursToSVG(contours: FluxPoint[][]): string

    readonly glyphs: FluxGlyph[]
    readonly info: FluxInfo
    readonly glyphCount: number
    readonly format: 'truetype' | 'cff' | 'cff2'
    readonly kerning: Array<{ left: string; right: string; value: number }>

    getGlyph(id: string | number): FluxGlyph
    hasGlyph(id: string | number): boolean
    listGlyphs(): string[]
    getInfo(): FluxInfo
    setInfo(partial: Partial<FluxInfo>): void
    getHinting(): HintingTables
    setHinting(data: HintingTables): void
    convertOutlines(target: 'truetype' | 'cff'): FontFlux
    validate(): ValidationReport
    export(options?: ExportOptions): ArrayBuffer
    toJSON(indent?: number): string
  }

  export function initWoff2(): Promise<void>
}
