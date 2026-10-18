/**
 * Wire-safe Studio Pet snapshot types shared by the Host `pet` Remote and its
 * Client renderers. This module imports only branded identity types, so a
 * Client program can read it without resolving Host services.
 * @module @deepseek-ai/dsh-pet/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PetPackManifest } from './pack.ts'
import type { PetLineTable } from './lines.ts'
import type { PetMoment } from './time-context.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** `pet.pin()` named a Session the pet does not track (unknown, disposed, or an excluded subagent). */
    'pet/session-not-tracked': { readonly sessionId: SessionId }
  }
}

/**
 * Identity of one `approval/asked` audit event. It carries the same brand as
 * `ApprovalRequestId` from `@deepseek-ai/dsh-user-approval/types`, whose
 * module also declares Host-only Context augmentation.
 */
export type PetApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Agent-layer state of one Session or of the aggregated pet. `DISCONNECTED`
 * is produced only by Clients whose `pet.watch()` stream is not open.
 */
export type PetAgentState = 'IDLE' | 'THINKING' | 'WORKING' | 'WAITING' | 'SUCCESS' | 'ERROR' | 'DISCONNECTED'

/** Tool classification used to select a working animation. */
export type PetWorkActivity = 'search' | 'edit' | 'command' | 'test' | 'tool'

/** Todo progress read from the latest `todo/write` event of a Session. */
export interface PetProgress {
  /** Completed todo items. */
  readonly completed: number
  /** All todo items. */
  readonly total: number
  /** One-based index of the last in-progress item, when one exists. */
  readonly current?: number
}

/** Aggregated state of one top-level Session (or subagent, when configured). */
export interface PetSessionView {
  /** Session identity. */
  readonly sessionId: SessionId
  /** Latest `session/title` value. */
  readonly title?: string
  /** Last path segment of the Session working directory. */
  readonly project?: string
  /** Absolute working directory recorded in the Session header. */
  readonly cwd?: string
  /** Effective state after pending approvals and hold windows are applied. */
  readonly state: PetAgentState
  /** Working classification while `state` is `WORKING`. */
  readonly activity?: PetWorkActivity
  /** Tool name of the most recent open tool call. */
  readonly tool?: string
  /** Latest todo progress of the current turn. */
  readonly progress?: PetProgress
  /** Whether the Session header marks it as a subagent child. */
  readonly subagent: boolean
  /** Whether the last turn ended with a result the user has not acknowledged through `pet.acknowledge()`. */
  readonly unseenResult: boolean
  /** Unix epoch milliseconds of the last event that changed this view. */
  readonly updatedAt: number
}

/** One approval that has an `approval/asked` audit event and no `approval/decided` yet. */
export interface PetPendingApproval {
  /** Audit identity pairing the ask with its decision. */
  readonly id: PetApprovalRequestId
  /** Session whose agent asked. */
  readonly sessionId: SessionId
  /** Tool whose operation needs a decision. */
  readonly toolName: string
  /** Exact tool call, when the asker supplied one. */
  readonly callId?: ToolCallId
  /** Human-readable reason recorded in the audit event. */
  readonly reason?: string
  /** Unix epoch milliseconds of the ask. */
  readonly askedAt: number
  /** Whether the pet settings route this tool to the main window instead of the pet approval card. */
  readonly restrictedInPet: boolean
}

/** One background job registered and not yet settled. */
export interface PetJobView {
  /** Job identity. */
  readonly jobId: JobId
  /** Session that owns the job. */
  readonly owner: SessionId
  /** Producer label. */
  readonly label: string
  /** Producer kind. */
  readonly kind: string
  /** Unix epoch milliseconds of registration. */
  readonly startedAt: number
}

/** Snapshot change that can raise a system notification: a new approval, a finished turn, or a failed turn. */
export type PetNoticeKind = 'waiting' | 'success' | 'error'

/** Pet settings stored in the Host `pet` profile entry that every pet surface applies. */
export interface PetSettingsView {
  /** Whether only tools outside {@link restrictedTools} can be approved from the pet. */
  readonly restrictTools: boolean
  /** Tool names that must be approved in the main window while {@link restrictTools} is on. */
  readonly restrictedTools: readonly string[]
  /** System notification categories; the device-local master switch and snooze still apply. */
  readonly notify: Readonly<Record<PetNoticeKind, boolean>>
}

/** Complete pet state streamed by `pet.watch()`. Each frame replaces the previous one. */
export interface PetSnapshot {
  /** Monotonic frame counter of the Host service instance. */
  readonly revision: number
  /** Aggregated state the character displays. */
  readonly primary: PetAgentState
  /** Session the bubble describes, when any Session is tracked. */
  readonly focusSessionId?: SessionId
  /** Session pinned through `pet.pin()`. */
  readonly pinnedSessionId?: SessionId
  /** Tracked Sessions ordered by state priority, then by recency. */
  readonly sessions: readonly PetSessionView[]
  /** Pending approvals across all Sessions, oldest first. */
  readonly pending: readonly PetPendingApproval[]
  /** Unsettled background jobs, oldest first. */
  readonly jobs: readonly PetJobView[]
  /** "Show desktop pet" setting; hiding keeps the Host service and this stream running. */
  readonly visible: boolean
  /** Shared pet settings. */
  readonly settings: PetSettingsView
  /** Host-local time of day, day kind, and festival that select greeting and festival lines. */
  readonly moment?: PetMoment
}

/** Character pack and optional media offered by the Host. */
export interface PetPackView {
  /** Validated `pet.json`. */
  readonly manifest: PetPackManifest
  /** Frame image URLs or data URLs, keyed by pack-relative path. */
  readonly assets: Readonly<Record<string, string>>
  /** Loaded through `DSH_PET_DEV`, unsigned; the Client marks it. */
  readonly dev: boolean
  /** Built-in transparent video clips, loaded on demand by Chromium. */
  readonly motion?: PetMotionView
  /** Validated local line table named by `persona.lines`; the Client picks lines from it. */
  readonly lines?: PetLineTable
}

/** Result of `pet.pack()`: the offered pack, if any, and why other candidate packs were skipped. */
export interface PetPackState {
  readonly pack: PetPackView | null
  readonly problems: readonly string[]
}

/** One built-in transparent video and its playback semantics. */
export interface PetMotionClip {
  readonly url: string
  readonly loop: boolean
  readonly durationMs: number
  readonly sheet?: {
    readonly columns: number
    readonly rows: number
    /** Number of frames played, starting at startFrame. */
    readonly frames: number
    /** Zero-based starting cell in row-major order; omitted means zero. */
    readonly startFrame?: number
  }
  /** The clip ends facing the other way; the character keeps the new facing. */
  readonly turn?: boolean
  /** `false` when the clip must never be mirrored, such as clips with text. */
  readonly mirror?: boolean
  /** Pack-provided menu name, used when no Client dictionary names the clip. */
  readonly label?: { readonly zh: string; readonly en: string }
  /**
   * Measured travel of an in-place gait: cumulative source pixels at each
   * frame start along `direction` of the unmirrored artwork.
   */
  readonly move?: {
    readonly direction: 'left' | 'right'
    readonly travel: readonly number[]
    readonly leadMs: number
    readonly tailMs: number
  }
}

/** One category of the weighted animation chain and the action menu. */
export interface PetMotionCategoryView {
  /** Stable category identity. */
  readonly id: string
  /** Pack-provided category name. */
  readonly label: { readonly zh: string; readonly en: string }
  /** Relative chance among the categories eligible for the current life state. */
  readonly weight: number
  /** Life states whose autonomous chain draws from the category; empty means menu only. */
  readonly life: readonly ('idle' | 'play')[]
  /** Clip names in menu order. */
  readonly clips: readonly string[]
}

/** Browser-decodable media, separate from the initial client bundle. */
export interface PetMotionView {
  readonly width: number
  readonly height: number
  readonly clips: Readonly<Record<string, PetMotionClip>>
  /** Categories of the weighted animation chain and the action menu, in menu order. */
  readonly categories?: readonly PetMotionCategoryView[]
  /** Top-level chain weights of the idle state: draw from the categories (`idle`), turn, or walk. */
  readonly chain?: { readonly idle: number; readonly turn: number; readonly move: number }
}
