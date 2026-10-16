/** Cloud project metadata and per-device bindings; directory paths never enter the cloud contribution. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SyncContribution } from './sync-engine.ts'
import { CloudError } from './transport.ts'

const metadata = z
  .object({ title: z.string(), order: z.number().int().nonnegative(), sessions: z.array(z.string()) })
  .strict()
const document = z.object({
  version: z.literal(1),
  projects: z.record(
    z.string(),
    z.object({
      metadata,
      localId: z
        .string()
        .transform(value => value as WorkspaceId)
        .nullable(),
    }),
  ),
})
/** Workspace operations required by CloudProjects. */
export interface CloudProjectWorkspaceOps {
  id: WorkspaceId
  title: string
  sessionIds: readonly (string | SessionId)[]
  setTitle(title: string): Promise<void>
}

/** Workspace registry operations required by CloudProjects. */
export interface CloudProjectWorkspaceRegistryOps {
  get(id: WorkspaceId): CloudProjectWorkspaceOps | undefined
  list(): CloudProjectWorkspaceOps[]
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<readonly WorkspaceId[] | void>
}

/** Account-local metadata repository; mappings reference existing local workspace identities only. */
export class CloudProjects {
  private state: z.infer<typeof document> | undefined
  /**
   * @param registry - live workspace operations.
   * @param root - private local state root.
   * @param origin - issuer origin.
   * @param user - issuer identity.
   */
  constructor(
    private readonly registry: CloudProjectWorkspaceRegistryOps,
    private readonly root: string,
    private readonly origin: string,
    private readonly user: string,
  ) {}
  private path(): string {
    return join(
      this.root,
      createHash('sha256')
        .update(JSON.stringify([this.origin, this.user]))
        .digest('hex'),
      'projects.json',
    )
  }
  private async load(): Promise<z.infer<typeof document>> {
    if (this.state) return this.state
    try {
      this.state = document.parse(JSON.parse(await readFile(this.path(), 'utf8')))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.state = { version: 1, projects: {} }
    }
    return this.state
  }
  private async save(): Promise<void> {
    await writeFileAtomic(this.path(), `${JSON.stringify(this.state)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  /**
   * Produce the project sync contribution descriptor.
   * @returns The versioned project owner declaration; it exports metadata without directory paths.
   */
  contribution(): SyncContribution {
    return {
      namespace: 'studio.projects',
      version: 1,
      fields: ['title', 'order', 'sessions'],
      export: async () => {
        const state = await this.load()
        return this.registry.list().map((workspace, order) => {
          const mapped = Object.entries(state.projects).find(([, project]) => project.localId === workspace.id)
          return {
            id: mapped?.[0] ?? `project:${workspace.id}`,
            kind: 'project',
            payload: { title: workspace.title, order, sessions: workspace.sessionIds.map(String) },
          }
        })
      },
      import: async (item, signal) => {
        if (item.deleted) throw new CloudError('LOCAL_DELETE_CONFIRMATION_REQUIRED')
        const value = metadata.parse(item.payload),
          state = await this.load(),
          prior = state.projects[item.id]
        state.projects[item.id] = { metadata: value, localId: prior?.localId ?? null }
        await this.save()
        if (signal.aborted) throw new CloudError('CANCELLED')
        if (prior?.localId) {
          const workspace = this.registry.get(prior.localId)
          if (!workspace) throw new CloudError('PROJECT_BINDING_REQUIRED')
          await workspace.setTitle(value.title)
          await this.applyOrder(signal)
        }
      },
    }
  }
  /**
   * List cloud project metadata and local bindings.
   * @returns Cloud metadata and explicit binding status; paths are device-local and absent.
   */
  async list(): Promise<{ id: string; title: string; localId: string | null }[]> {
    const state = await this.load()
    return Object.entries(state.projects).map(([id, project]) => ({
      id,
      title: project.metadata.title,
      localId: project.localId,
    }))
  }
  /**
   * Bind downloaded metadata to a user-selected existing workspace; no directory is created or uploaded.
   * @param id - cloud project identity previously imported through preview.
   * @param localId - existing local workspace identity.
   * @param signal - account lifetime; cancellation stops before local changes.
   * @returns after binding and the selected title are stored.
   */
  async bind(id: string, localId: WorkspaceId, signal: AbortSignal): Promise<void> {
    const state = await this.load(),
      project = state.projects[id],
      workspace = this.registry.get(localId)
    if (!project || !workspace) throw new CloudError('PROJECT_BINDING_REQUIRED')
    if (Object.entries(state.projects).some(([other, value]) => other !== id && value.localId === localId))
      throw new CloudError('PROJECT_ALREADY_BOUND')
    if (signal.aborted) throw new CloudError('CANCELLED')
    await workspace.setTitle(project.metadata.title)
    project.localId = localId
    await this.save()
    await this.applyOrder(signal)
  }
  /**
   * Remove binding between a cloud project and a local workspace.
   * @param id - cloud project identity.
   * @param signal - abort signal.
   */
  async unbind(id: string, signal: AbortSignal): Promise<void> {
    const state = await this.load(),
      project = state.projects[id]
    if (!project) throw new CloudError('PROJECT_BINDING_REQUIRED')
    if (signal.aborted) throw new CloudError('CANCELLED')
    project.localId = null
    await this.save()
  }
  private async applyOrder(signal: AbortSignal): Promise<void> {
    const state = await this.load()
    const bound = Object.values(state.projects)
      .flatMap(project => (project.localId !== null && this.registry.get(project.localId) !== undefined
        ? [{ localId: project.localId, order: project.metadata.order }]
        : []))
      .sort((left, right) => left.order - right.order)
    for (let i = 0; i < bound.length - 1; i++) {
      if (signal.aborted) throw new CloudError('CANCELLED')
      const curr = bound[i]?.localId
      const next = bound[i + 1]?.localId
      if (curr && next) await this.registry.insertBefore(curr, next)
    }
  }
}
