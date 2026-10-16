import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { CloudProjects } from '../src/projects.ts'
import type { ObjectValue } from '../src/sync-engine.ts'

function mockProjectObject(id: string, title: string, order: number, sessions: string[] = []): ObjectValue {
  return {
    id,
    kind: 'project',
    parentId: null,
    namespace: null,
    version: 1,
    formatVersion: 1,
    encrypted: false,
    payload: { title, order, sessions },
    deleted: false,
    fileRefs: [],
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createRoot() {
  const path = await mkdtemp(join(tmpdir(), 'studio-projects-'))
  roots.push(path)
  return path
}

interface MockWorkspace {
  id: WorkspaceId
  title: string
  sessionIds: string[]
  setTitle: (title: string) => Promise<void>
}

function mockRegistry() {
  const workspaces = new Map<WorkspaceId, MockWorkspace>()
  const order: WorkspaceId[] = []

  const add = (id: string, title: string, sessionIds: string[] = []) => {
    const wsId = id as WorkspaceId
    const ws: MockWorkspace = {
      id: wsId,
      title,
      sessionIds,
      setTitle: async (newTitle: string) => {
        ws.title = newTitle
      },
    }
    workspaces.set(wsId, ws)
    order.push(wsId)
    return ws
  }

  return {
    add,
    registry: {
      get: (id: WorkspaceId) => workspaces.get(id),
      list: () => order.map(id => workspaces.get(id)!),
      insertBefore: async (workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId) => {
        const fromIdx = order.indexOf(workspaceId)
        if (fromIdx !== -1) order.splice(fromIdx, 1)
        if (beforeWorkspaceId === undefined) {
          order.push(workspaceId)
        } else {
          const toIdx = order.indexOf(beforeWorkspaceId)
          if (toIdx !== -1) order.splice(toIdx, 0, workspaceId)
          else order.push(workspaceId)
        }
      },
    },
    getOrder: () => [...order],
  }
}

describe('CloudProjects', () => {
  it('exports local workspace metadata without exposing directory paths', async () => {
    const root = await createRoot()
    const { add, registry } = mockRegistry()
    add('ws-1', 'Project Alpha', ['s-1', 's-2'])
    add('ws-2', 'Project Beta', ['s-3'])

    const projects = new CloudProjects(registry, root, 'http://127.0.0.1:8788', 'user-1')
    const contrib = projects.contribution()
    const exported = await contrib.export()

    expect(exported).toHaveLength(2)
    expect(exported[0]).toMatchObject({
      id: 'project:ws-1',
      kind: 'project',
      payload: { title: 'Project Alpha', order: 0, sessions: ['s-1', 's-2'] },
    })
    expect(JSON.stringify(exported)).not.toContain('/path')
  })

  it('imports cloud project and binds to local workspace', async () => {
    const root = await createRoot()
    const { add, registry } = mockRegistry()
    const ws = add('ws-local', 'Local Name')

    const projects = new CloudProjects(registry, root, 'http://127.0.0.1:8788', 'user-1')
    const contrib = projects.contribution()

    await contrib.import(
      mockProjectObject('cloud-proj-1', 'Cloud Project Title', 0, ['s-remote']),
      new AbortController().signal,
    )

    const listBefore = await projects.list()
    expect(listBefore).toEqual([{ id: 'cloud-proj-1', title: 'Cloud Project Title', localId: null }])

    await projects.bind('cloud-proj-1', 'ws-local' as WorkspaceId, new AbortController().signal)
    expect(ws.title).toBe('Cloud Project Title')

    const listAfter = await projects.list()
    expect(listAfter).toEqual([{ id: 'cloud-proj-1', title: 'Cloud Project Title', localId: 'ws-local' }])
  })

  it('rejects binding duplicate workspaces to different cloud projects', async () => {
    const root = await createRoot()
    const { add, registry } = mockRegistry()
    add('ws-local', 'Local')

    const projects = new CloudProjects(registry, root, 'http://127.0.0.1:8788', 'user-1')
    const contrib = projects.contribution()
    const signal = new AbortController().signal

    await contrib.import(mockProjectObject('proj-1', 'P1', 0), signal)
    await contrib.import(mockProjectObject('proj-2', 'P2', 1), signal)

    await projects.bind('proj-1', 'ws-local' as WorkspaceId, signal)
    await expect(projects.bind('proj-2', 'ws-local' as WorkspaceId, signal)).rejects.toMatchObject({
      code: 'PROJECT_ALREADY_BOUND',
    })
  })

  it('unbinds cloud project from local workspace', async () => {
    const root = await createRoot()
    const { add, registry } = mockRegistry()
    add('ws-local', 'Local')

    const projects = new CloudProjects(registry, root, 'http://127.0.0.1:8788', 'user-1')
    const contrib = projects.contribution()
    const signal = new AbortController().signal

    await contrib.import(mockProjectObject('proj-1', 'P1', 0), signal)
    await projects.bind('proj-1', 'ws-local' as WorkspaceId, signal)
    expect((await projects.list())[0]!.localId).toBe('ws-local')

    await projects.unbind('proj-1', signal)
    expect((await projects.list())[0]!.localId).toBeNull()
  })
})
