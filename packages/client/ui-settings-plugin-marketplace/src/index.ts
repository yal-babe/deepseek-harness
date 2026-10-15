/**
 * Plugin marketplace settings surface, node half. Empty apply so the package
 * appears in the host cordis.yml / Loader; the browser half owns the section
 * through exports["./client"].
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
