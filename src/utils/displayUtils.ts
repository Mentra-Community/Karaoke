/**
 * displayUtils
 *
 * Workaround for a packaging quirk in @mentra/sdk@3.0.0-alpha.4: the
 * public `@mentra/sdk/display-utils` subpath re-exports from the
 * workspace-internal `@mentra/display-utils` package, which isn't
 * published, so TS resolution fails for downstream consumers.
 *
 * The actual implementation lives at `@mentra/sdk/dist/display-utils`
 * inside the SDK's dist tree. Bun's resolver finds it at runtime, but
 * `tsc --moduleResolution nodenext` won't traverse the index.d.ts
 * unless it's imported as a directory through an exports map.
 *
 * Until the SDK fixes the type re-export, declare a local module
 * shape with just the surface we use. Runtime is unchanged — Bun
 * loads the bundled JS via the public subpath.
 *
 * TODO: drop this file once @mentra/sdk@3.0.0 stable ships with
 * inlined types.
 */

import type {LRCLine} from "../types"

export interface FontMetrics {
  glyphWidths: Map<string, number>
  defaultGlyphWidth: number
  renderFormula: (glyphWidth: number) => number
}

export interface DisplayProfile {
  id: string
  name: string
  displayWidthPx: number
  maxLines: number
  fontMetrics: FontMetrics
}

export interface WrapOptions {
  maxWidthPx?: number
  maxLines?: number
  maxBytes?: number
}

export interface WrapResult {
  lines: string[]
}

export interface TextMeasurer {
  measureText(text: string): {widthPx: number}
}

export interface TextWrapper {
  wrap(text: string, opts: WrapOptions): WrapResult
}

// Runtime: resolve via the SDK's public subpath. Bun handles this fine.
// TypeScript can't follow the broken re-export, so we cast through unknown.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dispMod: any = require("@mentra/sdk/display-utils")

export const G1_PROFILE: DisplayProfile = dispMod.G1_PROFILE
export const G1_PROFILE_LEGACY: DisplayProfile = dispMod.G1_PROFILE_LEGACY

const TextMeasurerCtor = dispMod.TextMeasurer as new (profile: DisplayProfile) => TextMeasurer
const TextWrapperCtor = dispMod.TextWrapper as new (
  measurer: TextMeasurer,
  options?: {breakMode?: "character" | "word" | "strict-word"; hyphenChar?: string; minCharsBeforeHyphen?: number},
) => TextWrapper

export {TextMeasurerCtor as TextMeasurer, TextWrapperCtor as TextWrapper}

// Hint TS that the types are also exported as types
export type {LRCLine} // re-export for convenience
