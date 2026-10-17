/** Character frames are embedded in the ui-pet client bundle as data URLs. */
declare module '*.webp' {
  const url: string
  export default url
}

/** Pack manifests are bundled as JSON values and validated with `parsePetPack` before use. */
declare module '*/pet.json' {
  const manifest: unknown
  export default manifest
}
