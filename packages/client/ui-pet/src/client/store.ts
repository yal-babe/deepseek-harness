/** Client mirror of the Host pet snapshot over a reconnecting `pet.watch()` stream. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PetAgentState, PetSnapshot } from '@deepseek-ai/dsh-pet/types'

/** Pet state published to the renderer. */
export interface PetViewState {
  /** Latest Host frame, absent until the first one arrives. */
  readonly snapshot: PetSnapshot | undefined
  /** Whether the current stream generation is live. */
  readonly connected: boolean
}

/** One accepted-or-not stream item, as delivered by `ctx.remote.$stream`. */
export interface PetStreamItem {
  readonly value: PetSnapshot
  accept(): void
}

/** The reconnecting stream factory slice the store uses. */
export interface PetStreamFactory {
  $stream(options: {
    readonly name: string
    readonly open: (signal: AbortSignal) => AsyncIterable<PetSnapshot>
    readonly ended: (accepted: boolean) => Error
    readonly carrierFailed?: (error: Error) => void
  }): AsyncIterable<PetStreamItem> & { dispose(): Promise<void> }
}

/**
 * Character state shown for a view: a lost connection reads `DISCONNECTED`.
 * @param view - published pet view.
 * @returns the state the character plays.
 */
export function displayedState(view: PetViewState): PetAgentState {
  if (!view.connected) return 'DISCONNECTED'
  return view.snapshot?.primary ?? 'IDLE'
}

/**
 * Whether the pet is shown; before the first frame it is, so the character can report the connection.
 * @param view - published pet view.
 * @returns the Host "show desktop pet" value, defaulting to shown.
 */
export function isPetVisible(view: PetViewState): boolean {
  return view.snapshot?.visible ?? true
}

/** Owns the stream and the published view. */
export class PetStore {
  /** Published view. */
  readonly store: SnapshotStore<PetViewState>
  private readonly stream: AsyncIterable<PetStreamItem> & { dispose(): Promise<void> }
  private disposed = false

  /**
   * @param factory - reconnecting stream factory (`ctx.remote`).
   * @param open - opener of one physical `pet.watch()` generation.
   */
  constructor(factory: PetStreamFactory, open: (signal: AbortSignal) => AsyncIterable<PetSnapshot>) {
    this.store = createSnapshotStore<PetViewState>({ snapshot: undefined, connected: false })
    this.stream = factory.$stream({
      name: 'pet',
      open,
      ended: () => new Error('pet stream ended'),
      carrierFailed: () => { this.publish({ ...this.store.getSnapshot(), connected: false }) },
    })
  }

  /**
   * Consume frames until disposal. A terminal stream failure leaves the view disconnected.
   * @returns settles when the stream ends.
   */
  async run(): Promise<void> {
    try {
      for await (const frame of this.stream) {
        this.publish({ snapshot: frame.value, connected: true })
        frame.accept()
      }
    } catch {
      // Terminal failure: the character shows DISCONNECTED until the plugin reloads.
    }
    this.publish({ ...this.store.getSnapshot(), connected: false })
  }

  /** Stop the stream. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.stream.dispose()
  }

  private publish(next: PetViewState): void {
    if (!this.disposed) this.store.set(next)
  }
}
