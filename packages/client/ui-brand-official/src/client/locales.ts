/** Studio brand dictionary namespace. */
export const NS = 'studio-brand'
/** Simplified Chinese product copy. */
export const zh = { name: 'DSH Studio' } as const
/** Keys owned by the Studio brand. */
export type BrandKey = keyof typeof zh
/** English product copy. */
export const en: Record<BrandKey, string> = { name: 'DSH Studio' }
