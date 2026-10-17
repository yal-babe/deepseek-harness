/** Send a quick prompt with optional file attachments from the pet. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PromptContentPart, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Remote operations the quick ask composes; the plugin binds them to `ctx.remote` and `ctx.fileUpload`. */
export interface QuickAskDeps {
  /**
   * Create a Session for a new conversation.
   * @param cwd - working directory, or `undefined` for the Host default.
   */
  readonly createSession: (cwd: string | undefined) => Promise<RemoteResult<{ readonly sessionId: SessionId }>>
  /**
   * Stage one file for a Session.
   * @param sessionId - receiving Session.
   * @param file - file bytes.
   * @param name - file name.
   * @param signal - cancellation.
   */
  readonly upload: (
    sessionId: SessionId, file: Blob, name: string, signal: AbortSignal,
  ) => Promise<RemoteResult<{ readonly receiptId: FileUploadReceiptId }>>
  /**
   * Admit one prompt.
   * @param request - prompt request.
   * @param signal - cancellation.
   */
  readonly prompt: (request: {
    readonly requestId: SessionRequestId
    readonly sessionId: SessionId
    readonly mode: 'queue'
    readonly content: readonly PromptContentPart[]
  }, signal: AbortSignal) => Promise<RemoteResult<{ readonly accepted: true }>>
  /** Mint a request id. */
  readonly requestId: () => SessionRequestId
}

/** Where a quick ask goes. */
export type QuickAskTarget =
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  | { readonly kind: 'new'; readonly cwd?: string | undefined }

/** One quick ask from the pet. */
export interface QuickAskRequest {
  /** Prompt text; may be empty when files are attached. */
  readonly text: string
  /** Attached files, uploaded in order. */
  readonly files: readonly File[]
  /** Destination Session. */
  readonly target: QuickAskTarget
  /** Cancellation. */
  readonly signal: AbortSignal
}

/** Outcome of one quick ask. */
export type QuickAskOutcome =
  | { readonly ok: true; readonly sessionId: SessionId }
  | { readonly ok: false; readonly stage: 'empty' | 'create' | 'upload' | 'prompt'; readonly error?: unknown }

/**
 * Create (when asked), upload attachments, then admit the prompt in queue mode.
 * @param deps - bound Remote operations.
 * @param request - text, files, target, and cancellation.
 * @returns the target Session, or the failed stage.
 */
export async function sendQuickAsk(deps: QuickAskDeps, request: QuickAskRequest): Promise<QuickAskOutcome> {
  const text = request.text.trim()
  if (text.length === 0 && request.files.length === 0) return { ok: false, stage: 'empty' }
  let sessionId: SessionId
  if (request.target.kind === 'session') {
    sessionId = request.target.sessionId
  } else {
    const created = await deps.createSession(request.target.cwd)
    if (!created.ok) return { ok: false, stage: 'create', error: created.error }
    sessionId = created.value.sessionId
  }
  const content: PromptContentPart[] = text.length === 0 ? [] : [{ type: 'text', text }]
  for (const file of request.files) {
    const uploaded = await deps.upload(sessionId, file, file.name, request.signal)
    if (!uploaded.ok) return { ok: false, stage: 'upload', error: uploaded.error }
    content.push({ type: 'file', receiptId: uploaded.value.receiptId })
  }
  const admitted = await deps.prompt({ requestId: deps.requestId(), sessionId, mode: 'queue', content }, request.signal)
  if (!admitted.ok) return { ok: false, stage: 'prompt', error: admitted.error }
  return { ok: true, sessionId }
}
