import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionSeq,
  SessionLogOffset,
  type SessionHeader,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type {
  SessionHandle,
  SessionPersistence,
  SessionPersistenceCreateOptions,
  SessionPersistenceRevision,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { CloudSessions, type SessionSyncServices } from '../src/cloud-sessions.ts'
import { encodeCompletedSession } from '../src/session-codec.ts'
import { CloudFiles } from '../src/cloud-files.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createRoot() {
  const path = await mkdtemp(join(tmpdir(), 'studio-continuation-'))
  roots.push(path)
  return path
}

function mockPersistence() {
  const createdSessions: { header: SessionHeader; options?: SessionPersistenceCreateOptions; events: SessionEvent[] }[] = []

  const persistence: Pick<SessionPersistence, 'create' | 'stat'> = {
    create: async (header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> => {
      const recorded: { header: SessionHeader; options?: SessionPersistenceCreateOptions; events: SessionEvent[] } = {
        header,
        ...(options !== undefined ? { options } : {}),
        events: [],
      }
      createdSessions.push(recorded)
      const handle: SessionHandle = {
        id: header.id,
        access: 'write',
        header,
        inheritedEventCount: options?.inheritedEventCount ?? SessionLogOffset(0),
        read: async () => ({ eventState: 'detached', events: recorded.events }),
        append: async (events: readonly SessionEvent[]) => {
          recorded.events.push(...events)
        },
        flush: async () => {},
        close: async () => {},
        [Symbol.asyncDispose]: async () => {},
      }
      return handle
    },
    stat: async (id: SessionId): Promise<SessionPersistenceSnapshot | undefined> => {
      const match = createdSessions.find(s => s.header.id === id)
      if (!match) return undefined
      return {
        header: match.header,
        revision: 'rev-1' as SessionPersistenceRevision,
        formatStatus: 'current',
        eventCount: match.events.length,
      }
    },
  }

  return { persistence: persistence as SessionPersistence, createdSessions }
}

function mockWorkspace(id: string, path: string) {
  const attached: SessionId[] = []
  const workspace: Pick<Workspace, 'id' | 'path' | 'attachSession'> = {
    id: id as WorkspaceId,
    path,
    attachSession: async (sessionId: SessionId) => {
      attached.push(sessionId)
    },
  }
  return { workspace: workspace as Workspace, attached }
}

describe('CloudSessions.fork', () => {
  it('creates an isolated local branch session with preserved parentage, cwd, and seed events', async () => {
    const root = await createRoot()
    const { persistence, createdSessions } = mockPersistence()
    const { workspace, attached } = mockWorkspace('ws-local-1', '/local/project/dir')
    const services: SessionSyncServices = {
      persistence,
      attachments: {} as AttachmentStore,
      sessions: undefined,
    }

    const cloudSessions = new CloudSessions(root, services, 1048576)
    const files = new CloudFiles(root)

    const parentHeader: SessionHeader = {
      id: SessionId('remote-parent-session'),
      version: SESSION_FORMAT_VERSION,
      createdAt: 1000,
      isSeeded: false,
      cwd: '/remote/original/cwd',
    }
    const parentEvents: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1000, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: SessionSeq(1),
        time: 1010,
        surfaceOp: 'append',
        data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
      },
      { type: 'turn/end', seq: SessionSeq(2), time: 1020, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const encoded = encodeCompletedSession(parentHeader, parentEvents, 0)!
    const chunkRef = await files.stage(Buffer.from(encoded.text))

    const historyRecord = {
      version: 1,
      histories: {
        'hist-test-1': {
          objectId: 'hist-test-1',
          version: 1,
          manifest: {
            format: 'dsh-session-1',
            sessionFormatVersion: SESSION_FORMAT_VERSION,
            sourceSessionId: 'remote-parent-session',
            parentSourceSessionId: null,
            inheritedEventCount: 0,
            createdAt: 1000,
            throughSeq: 2,
            title: 'Test Conversation',
            chunks: [chunkRef],
            attachments: [],
          },
          missing: [],
        },
      },
    }
    await writeFileAtomic(join(root, 'histories.json'), `${JSON.stringify(historyRecord)}\n`, { mode: 0o600 })

    const requestId = randomUUID()
    const result = await cloudSessions.fork('hist-test-1', {
      workspace,
      preset: 'coding-agent',
      requestId,
    })

    expect(result.sessionId).toBeDefined()
    expect(createdSessions).toHaveLength(1)
    const created = createdSessions[0]!
    expect(created.header.parentSession).toBe('remote-parent-session')
    expect(created.header.cwd).toBe('/local/project/dir')
    expect(created.header.agentPreset).toBe('coding-agent')
    expect(created.header.isSeeded).toBe(true)
    expect(created.options?.inheritedEventCount).toBe(3) // boundary (2) + 1

    expect(created.events.some(e => e.type === 'working-directory/change' && (e.data as { cwd: string }).cwd === '/local/project/dir')).toBe(true)
    expect(created.events.some(e => e.type === 'agent-preset/selected' && (e.data as { agentPreset: string }).agentPreset === 'coding-agent')).toBe(true)
    expect(attached).toContain(created.header.id)

    // Idempotency: second call with same requestId returns identical sessionId
    const repeatResult = await cloudSessions.fork('hist-test-1', {
      workspace,
      preset: 'coding-agent',
      requestId,
    })
    expect(repeatResult.sessionId).toBe(result.sessionId)
    expect(createdSessions).toHaveLength(1)
  })

  it('fails with LOCAL_HISTORY_MISSING if history is not downloaded', async () => {
    const root = await createRoot()
    const { persistence } = mockPersistence()
    const { workspace } = mockWorkspace('ws-local-1', '/local/project/dir')
    const cloudSessions = new CloudSessions(root, { persistence, attachments: {} as AttachmentStore, sessions: undefined }, 1048576)

    await expect(
      cloudSessions.fork('missing-hist', { workspace, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'LOCAL_HISTORY_MISSING' })
  })

  it('folds token activity across multiple downloaded histories', async () => {
    const root = await createRoot()
    const { persistence } = mockPersistence()
    const cloudSessions = new CloudSessions(root, { persistence, attachments: {} as AttachmentStore, sessions: undefined }, 1048576)
    const files = new CloudFiles(root)

    const header: SessionHeader = {
      id: SessionId('session-tokens'),
      version: SESSION_FORMAT_VERSION,
      createdAt: 1000,
      isSeeded: false,
      cwd: '/cwd',
    }
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1000, data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(1), time: 1005, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: SessionSeq(2),
        time: 1010,
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          stream: [],
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'response' }],
            source: { provider: 'deepseek-official', model: 'deepseek-chat' },
          }),
          usage: { inputTokens: 40, outputTokens: 15, totalTokens: 65, cacheReadTokens: 10, reasoningTokens: 5 },
        },
      },
      { type: 'step/end', seq: SessionSeq(3), time: 1015, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: SessionSeq(4), time: 1020, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const encoded = encodeCompletedSession(header, events, 0)!
    const chunkRef = await files.stage(Buffer.from(encoded.text))

    const historyRecord = {
      version: 1,
      histories: {
        'hist-tokens': {
          objectId: 'hist-tokens',
          version: 1,
          manifest: {
            format: 'dsh-session-1',
            sessionFormatVersion: SESSION_FORMAT_VERSION,
            sourceSessionId: 'session-tokens',
            parentSourceSessionId: null,
            inheritedEventCount: 0,
            createdAt: 1000,
            throughSeq: 4,
            title: 'Tokens Conversation',
            chunks: [chunkRef],
            attachments: [],
          },
          missing: [],
        },
      },
    }
    await writeFileAtomic(join(root, 'histories.json'), `${JSON.stringify(historyRecord)}\n`, { mode: 0o600 })

    const activity = await cloudSessions.tokenActivity()
    expect(activity).toEqual({
      totalTokens: 65,
      inputTokens: 40,
      outputTokens: 15,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      cacheWriteUnknown: true,
      reasoningTokens: 5,
      turnsCount: 1,
      sessionsCount: 1,
    })
  })
})
