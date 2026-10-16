/**
 * Host Remote that folds unarchived Session logs into local usage statistics.
 */

import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assembleSnapshot, foldSessionUsage } from './fold.ts'
import type { UsageSnapshot } from './types.ts'

export type * from './types.ts'
export { assembleSnapshot, dayKey, foldSessionUsage } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageStats: UsageStats
  }
}

/** Local usage fold over session-query, excluding workspace-archived sessions. */
export class UsageStats extends TypertRemoteService {
  static inject = ['sessionQuery']

  /** @param ctx - Host with sessionQuery; workspaceRegistry is optional. */
  constructor(ctx: Context) {
    super(ctx, 'usageStats')
  }

  /**
   * Fold unarchived sessions into calendar-day, model, and tool totals.
   * @param timezoneOffsetSeconds - seconds east of UTC for local day buckets.
   * @returns a snapshot that contains no event bodies or credentials.
   */
  @Remote
  async snapshot(timezoneOffsetSeconds: number): Promise<UsageSnapshot> {
    const offset = Number.isFinite(timezoneOffsetSeconds) ? timezoneOffsetSeconds : 0
    const archived = new Set(
      (this.ctx.get('workspaceRegistry')?.archivedSessionIds ?? []).map(id => String(id)),
    )
    const records = await this.ctx.sessionQuery.listSessions()
    const folded = []
    for (const record of records) {
      const sessionId = String(record.header.id)
      if (archived.has(sessionId)) continue
      let events
      try {
        events = (await this.ctx.sessionQuery.readSession(record.header.id)).events
      } catch (_unreadableLog) {
        continue
      }
      folded.push(foldSessionUsage(sessionId, await this.titleOf(record.header.id, sessionId), events, offset))
    }
    return assembleSnapshot(offset, Date.now(), folded)
  }

  /**
   * @param id - session whose title is requested.
   * @param fallback - session id string used when the title is missing.
   * @returns the stored title, or `fallback`.
   */
  private async titleOf(id: SessionId, fallback: string): Promise<string> {
    try {
      return titleFrom(await this.ctx.sessionQuery.readTitle(id), fallback)
    } catch (_unreadTitle) {
      return fallback
    }
  }
}

export default UsageStats

function titleFrom(snapshot: { title?: string } | undefined, fallback: string): string {
  return snapshot?.title !== undefined && snapshot.title.length > 0 ? snapshot.title : fallback
}
