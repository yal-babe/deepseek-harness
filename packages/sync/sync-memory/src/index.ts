/**
 * Project memory CRUD with FTS retrieval. Matching records reach the model
 * only as logged `user/message` events whose source kind is `sync-memory`.
 * @module @deepseek-ai/dsh-sync-memory
 */

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import {
  MemoryId,
  redactSecrets,
  StudioProjectId,
  type MemoryKind,
  type MemoryRecord,
} from '@deepseek-ai/dsh-sync-protocol'
import { renderMemoryContext } from './render.ts'
import { deleteMemory, insertMemory, openMemoryStore, searchMemories, supersedeMemory } from './store.ts'

export { MEMORY_STORE_SCHEMA_VERSION, openMemoryStore } from './store.ts'
export { renderMemoryContext } from './render.ts'

/** Cordis plugin name used by loader diagnostics and message source kind. */
export const name = 'sync-memory'

const MEMORY_KINDS: ReadonlySet<string> = new Set([
  'goal', 'constraint', 'decision', 'fact', 'progress', 'blocker',
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Project memory store and model-context injector. */
    syncMemory: SyncMemory
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Admitted project-memory snapshot.
     * @persistenceAttribution
     */
    'sync-memory': { kind: 'sync-memory' } & ContextFormed
  }
}

/** Deployment choices for local memory storage and injection bounds. */
export interface Config {
  /** Cloud project that owns stored records. */
  projectId: string
  /** SQLite path; omission uses `$DSH_HOME/sync-memory.sqlite`. */
  storePath?: string
  /** Maximum records admitted in one injection. */
  maxInjectRecords?: number
  /** Maximum concatenated character count admitted in one injection. */
  maxInjectChars?: number
}

/** Fields required to create a memory record. */
export interface CreateMemoryRequest {
  /** Structured kind. */
  readonly kind: MemoryKind
  /** Body; secrets are redacted before storage. */
  readonly text: string
  /** Origin label; secrets are redacted. */
  readonly source?: string
  /** Optional git revision associated with the fact. */
  readonly gitRev?: string
  /** Optional caller-assigned id. */
  readonly id?: string
}

/** Project memory store (`ctx.syncMemory`) with logged model injection. */
export class SyncMemory extends Service {
  static inject = ['agents']

  static Config: z<Config> = z.object({
    projectId: z.string(),
    storePath: z.string().default(''),
    maxInjectRecords: z.number().default(8),
    maxInjectChars: z.number().default(4_000),
  })

  private readonly projectId: StudioProjectId
  private readonly storePath: string
  private readonly maxInjectRecords: number
  private readonly maxInjectChars: number
  private db: DatabaseSync | undefined
  private readonly ready: Promise<void>

  /**
   * @param ctx - plugin context owning the agent registry.
   * @param config - project id, store path, and injection bounds.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'syncMemory')
    if (config.projectId.trim().length === 0) {
      throw new TypeError('sync-memory: projectId is required')
    }
    this.projectId = StudioProjectId(config.projectId)
    this.storePath = config.storePath !== undefined && config.storePath.trim().length > 0
      ? config.storePath
      : join(resolveDshHome(), 'sync-memory.sqlite')
    this.maxInjectRecords = config.maxInjectRecords === undefined ? 8 : config.maxInjectRecords
    this.maxInjectChars = config.maxInjectChars === undefined ? 4_000 : config.maxInjectChars
    if (!Number.isSafeInteger(this.maxInjectRecords) || this.maxInjectRecords < 1) {
      throw new TypeError('sync-memory: maxInjectRecords must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.maxInjectChars) || this.maxInjectChars < 1) {
      throw new TypeError('sync-memory: maxInjectChars must be a positive safe integer')
    }
    let markReady!: () => void
    this.ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    ctx.effect(async () => {
      this.db = await openMemoryStore(this.storePath)
      markReady()
      return () => {
        this.db?.close()
        this.db = undefined
      }
    })
    ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      await this.ready
      const query = latestUserText(agent)
      const records = this.admit(await this.search(query))
      const text = renderMemoryContext(records)
      if (text.length === 0) return decision
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: name, form: 'snapshot', sections: [{ name, text }] },
          }),
        ],
      }
    }, { prepend: true })
  }

  /**
   * Create a redacted memory record.
   * @param request - kind, text, and optional source.
   * @returns the stored record.
   */
  async create(request: CreateMemoryRequest): Promise<MemoryRecord> {
    await this.ready
    if (!MEMORY_KINDS.has(request.kind)) {
      throw new TypeError(`sync-memory: unknown kind ${JSON.stringify(request.kind)}`)
    }
    const text = redactSecrets(request.text.trim())
    if (text.length === 0) throw new Error('sync-memory: text is required')
    const now = Date.now()
    const record: MemoryRecord = {
      id: request.id === undefined ? MemoryId(randomBytes(12).toString('hex')) : MemoryId(request.id),
      projectId: this.projectId,
      kind: request.kind,
      text,
      source: redactSecrets(request.source ?? 'user'),
      createdAt: now,
      updatedAt: now,
      ...request.gitRev === undefined ? {} : { gitRev: request.gitRev },
    }
    insertMemory(this.requireDb(), record)
    return record
  }

  /**
   * Replace a live record by writing a successor and pointing the predecessor at it.
   * @param id - live record to supersede.
   * @param request - successor fields.
   * @returns the successor.
   */
  async revise(id: MemoryId, request: CreateMemoryRequest): Promise<MemoryRecord> {
    const successor = await this.create(request)
    const updated = supersedeMemory(this.requireDb(), id, successor.id, successor.updatedAt)
    if (!updated) throw new Error(`sync-memory: record ${id} is missing or already superseded`)
    return successor
  }

  /**
   * Search live records. An empty query lists the most recently updated rows.
   * @param query - FTS query.
   * @returns matching live records, newest first, capped by `maxInjectRecords`.
   */
  async search(query: string): Promise<MemoryRecord[]> {
    await this.ready
    return searchMemories(this.requireDb(), this.projectId, query, this.maxInjectRecords)
  }

  /**
   * Delete one record and its FTS document.
   * @param id - stored record.
   * @returns after the row is gone.
   */
  async remove(id: MemoryId): Promise<void> {
    await this.ready
    if (!deleteMemory(this.requireDb(), id)) {
      throw new Error(`sync-memory: record ${id} is missing`)
    }
  }

  private admit(records: readonly MemoryRecord[]): MemoryRecord[] {
    const admitted: MemoryRecord[] = []
    let used = 0
    for (const record of records) {
      const extra = record.text.length + 16
      if (used + extra > this.maxInjectChars) break
      admitted.push(record)
      used += extra
    }
    return admitted
  }

  private requireDb(): DatabaseSync {
    if (this.db === undefined) throw new Error('sync-memory: store is not open')
    return this.db
  }
}

export default SyncMemory

function latestUserText(agent: Agent): string {
  for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
    const event = agent.session.eventAt(SessionSeq(seq))
    if (event?.type === 'user/message') {
      return event.data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
    }
  }
  return ''
}
