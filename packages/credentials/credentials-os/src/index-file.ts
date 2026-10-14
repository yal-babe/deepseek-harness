/**
 * YAML index of OS-stored credential references and record kinds. The document
 * never holds secret values: those live in {@link OsSecretStore}.
 * @module @deepseek-ai/dsh-credentials-os/index-file
 */

import { Document, parseDocument, type YAMLError } from 'yaml'
import { credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Basename of the OS-credentials index inside the harness home. */
export const INDEX_FILENAME = '.credentials-os-index.yaml'

/** The index layout this build reads and writes. */
export const INDEX_VERSION = 1

/** One parsed index: reference names and record kinds, keyed as written. */
export interface CredentialsOsIndex {
  /** Reference names that have a secret in the OS store. */
  refs: Set<string>
  /** Stored record kinds, keyed by {@link CredentialKey}. */
  records: Map<string, CredentialRecord['kind']>
}

/**
 * Describe one YAML parse failure without quoting the source.
 * @param error - the parser's error.
 * @returns the error code with its line and column.
 */
function describeYamlError(error: YAMLError): string {
  const at = error.linePos?.[0]
  /* v8 ignore next -- `prettyErrors` populates linePos on every error; the guard answers its optional type */
  const where = at === undefined ? '' : ` at line ${String(at.line)}, column ${String(at.col)}`
  return `${error.code}${where}`
}

/**
 * Parse one OS-credentials index. Everything is rejected rather than skipped —
 * an unversioned root, an unknown top-level key, a key that is not addressable,
 * a wrong-typed value — because a silently ignored entry reads as "the
 * credential I stored has no effect". An empty document is an empty index and
 * needs no version.
 * @param text - the document's text.
 * @param filename - absolute path, quoted in errors.
 * @returns the parsed reference names and record kinds.
 */
export function parseCredentialsOsIndex(text: string, filename: string): CredentialsOsIndex {
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(`credentials-os: invalid index at ${filename}: ${
      document.errors.map(describeYamlError).join('; ')}`)
  }
  const root: unknown = document.toJS() ?? {}
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new TypeError(`credentials-os: ${filename} must be a mapping`)
  }
  const fields = root as Record<string, unknown>
  const keys = Object.keys(fields)
  if (keys.length === 0) return { refs: new Set(), records: new Map() }
  if (!('version' in fields)) {
    throw new Error(
      `credentials-os: ${filename} has no version; this build reads version ${INDEX_VERSION}`,
    )
  }
  if (fields['version'] !== INDEX_VERSION) {
    throw new Error(
      `credentials-os: ${filename} declares version ${JSON.stringify(fields['version'])};`
      + ` this build reads version ${INDEX_VERSION}`,
    )
  }
  for (const key of keys) {
    if (key !== 'version' && key !== 'refs' && key !== 'records') {
      throw new Error(`credentials-os: unknown top-level key "${key}" in ${filename}`)
    }
  }
  return { refs: parseRefs(fields['refs'], filename), records: parseRecords(fields['records'], filename) }
}

/** Admit a `refs` section: POSIX-identifier keys over the presence marker `true`. */
function parseRefs(section: unknown, filename: string): Set<string> {
  const refs = new Set<string>()
  for (const [key, value] of Object.entries(asSection(section, 'refs', filename))) {
    credentialRef(key)
    if (value !== true) {
      throw new TypeError(`credentials-os: the value for "${key}" in ${filename} must be true`)
    }
    refs.add(key)
  }
  return refs
}

/** Admit a `records` section: `<scope>/<id>` keys over `api-key` or `grant`. */
function parseRecords(section: unknown, filename: string): Map<string, CredentialRecord['kind']> {
  const records = new Map<string, CredentialRecord['kind']>()
  for (const [key, value] of Object.entries(asSection(section, 'records', filename))) {
    parseCredentialKey(key)
    if (value !== 'api-key' && value !== 'grant') {
      throw new Error(
        `credentials-os: record "${key}" in ${filename} has unknown kind ${JSON.stringify(value)}`,
      )
    }
    records.set(key, value)
  }
  return records
}

/** One section of the index as a plain mapping; absent and null both mean empty. */
function asSection(section: unknown, name: string, filename: string): Record<string, unknown> {
  if (section === undefined || section === null) return {}
  if (typeof section !== 'object' || Array.isArray(section)) {
    throw new TypeError(`credentials-os: "${name}" in ${filename} must be a mapping`)
  }
  return section as Record<string, unknown>
}

/**
 * Render an index document. Machine-written: no comment preservation.
 * @param index - the reference names and record kinds to persist.
 * @returns the text to persist, always ending with a newline when non-empty.
 */
export function renderCredentialsOsIndex(index: CredentialsOsIndex): string {
  const document = new Document({ version: INDEX_VERSION })
  if (index.refs.size > 0) {
    const refs: Record<string, true> = {}
    for (const ref of [...index.refs].sort()) refs[ref] = true
    document.set('refs', refs)
  }
  if (index.records.size > 0) {
    const records: Record<string, CredentialRecord['kind']> = {}
    for (const [key, kind] of [...index.records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      records[key] = kind
    }
    document.set('records', records)
  }
  return document.toString()
}
