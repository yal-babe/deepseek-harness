import { describe, expect, it } from 'vitest'
import { classifyTool, PetReducer } from '../src/reducer.ts'
import type { PetReducerOptions } from '../src/reducer.ts'
import {
  approvalId, asked, child, decided, ev, jobRegistered, jobSettled, S1, S2, stepStart, SUB, toolCall, toolResult, top, turnEnd, turnStart,
} from './fixtures.ts'

const OPTIONS: PetReducerOptions = {
  includeSubagents: false,
  successHoldMs: 1000,
  errorHoldMs: 5000,
  maxSessions: 8,
  waitingPreempts: true,
}
const INPUTS = { revision: 1, visible: true, pinnedSessionId: undefined }

function reducer(options: Partial<PetReducerOptions> = {}): PetReducer {
  return new PetReducer({ ...OPTIONS, ...options })
}

describe('PetReducer turn lifecycle', () => {
  it('starts empty and idle', () => {
    const snapshot = reducer().snapshot(0, INPUTS)
    expect(snapshot).toEqual({ revision: 1, primary: 'IDLE', sessions: [], pending: [], jobs: [], visible: true })
  })

  it('moves THINKING -> WORKING -> THINKING -> SUCCESS -> IDLE after the hold', () => {
    const fold = reducer()
    expect(fold.apply(top(S1), turnStart(10))).toBe(true)
    expect(fold.snapshot(10, INPUTS).primary).toBe('THINKING')
    // step/start between tool rounds carries no state change of its own.
    expect(fold.apply(top(S1), stepStart(11))).toBe(false)
    fold.apply(top(S1), toolCall(12, 'c1', 'bash'))
    const working = fold.snapshot(12, INPUTS)
    expect(working.primary).toBe('WORKING')
    expect(working.sessions[0]).toMatchObject({ sessionId: S1, project: 'dsh-studio', activity: 'command', tool: 'bash' })
    fold.apply(top(S1), toolResult(13, 'c1'))
    expect(fold.snapshot(13, INPUTS).primary).toBe('THINKING')
    fold.apply(top(S1), turnEnd(20, { kind: 'completed' }))
    const done = fold.snapshot(20, INPUTS)
    expect(done.primary).toBe('SUCCESS')
    expect(done.sessions[0]?.unseenResult).toBe(true)
    expect(fold.nextExpiry(20)).toBe(1020)
    expect(fold.snapshot(1020, INPUTS).primary).toBe('IDLE')
    expect(fold.nextExpiry(1020)).toBeUndefined()
  })

  it('maps error to ERROR with the longer hold and other reasons to IDLE', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), turnEnd(2, { kind: 'error', error: { message: 'boom', code: 'test' } }))
    expect(fold.snapshot(2, INPUTS).primary).toBe('ERROR')
    expect(fold.nextExpiry(2)).toBe(5002)
    fold.apply(top(S2), turnStart(3))
    fold.apply(top(S2), turnEnd(4, { kind: 'aborted', reason: { kind: 'legacy' } }))
    expect(fold.snapshot(4, INPUTS).sessions.find(view => view.sessionId === S2)?.state).toBe('IDLE')
    fold.apply(top(S2), turnStart(5))
    fold.apply(top(S2), turnEnd(6, { kind: 'max-tokens' }))
    expect(fold.snapshot(6, INPUTS).sessions.find(view => view.sessionId === S2)?.state).toBe('SUCCESS')
  })

  it('keeps WORKING while a parallel tool is still open', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), toolCall(2, 'a', 'grep'))
    fold.apply(top(S1), toolCall(3, 'b', 'edit_file'))
    fold.apply(top(S1), toolResult(4, 'b', true))
    expect(fold.snapshot(4, INPUTS).sessions[0]).toMatchObject({ state: 'WORKING', activity: 'search', tool: 'grep' })
  })

  it('records todo progress and titles', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), ev('todo/write', 2, {
      todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ],
    }))
    fold.apply(top(S1), ev('session/title', 3, { title: 'Fix login', messageSeqs: [], source: { kind: 'fallback' } }))
    expect(fold.snapshot(3, INPUTS).sessions[0]).toMatchObject({ title: 'Fix login', progress: { completed: 1, total: 3, current: 2 } })
    fold.apply(top(S1), ev('todo/write', 4, { todos: [{ content: 'a', status: 'completed' }] }))
    expect(fold.snapshot(4, INPUTS).sessions[0]?.progress).toEqual({ completed: 1, total: 1 })
    fold.apply(top(S1), ev('todo/write', 5, { todos: [] }))
    expect(fold.snapshot(5, INPUTS).sessions[0]?.progress).toBeUndefined()
  })

  it('ignores unrelated events', () => {
    const fold = reducer()
    expect(fold.apply(top(S1), ev('step/end', 1, { turn: 1, step: 1 }))).toBe(false)
    expect(fold.has(S1)).toBe(false)
  })

  it('acknowledges unseen results once', () => {
    const fold = reducer()
    expect(fold.acknowledge(S1)).toBe(false)
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), turnEnd(2, { kind: 'completed' }))
    expect(fold.acknowledge(S1)).toBe(true)
    expect(fold.acknowledge(S1)).toBe(false)
    expect(fold.snapshot(2, INPUTS).sessions[0]).toMatchObject({ state: 'IDLE', unseenResult: false })
  })
})

describe('PetReducer approvals and focus', () => {
  it('WAITING outranks everything and clears on approval/decided', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), turnEnd(2, { kind: 'error', error: { message: 'x', code: 'test' } }))
    fold.apply(top(S2), turnStart(3))
    fold.apply(top(S2), toolCall(4, 'c1', 'bash'))
    fold.apply(top(S2), asked(5, 'r1', 'bash', 'c1'))
    const waiting = fold.snapshot(5, INPUTS)
    expect(waiting.primary).toBe('WAITING')
    expect(waiting.focusSessionId).toBe(S2)
    expect(waiting.pending).toEqual([{ id: 'r1', sessionId: S2, toolName: 'bash', callId: 'c1', askedAt: 5 }])
    expect(fold.apply(top(S2), decided(6, 'r1'))).toBe(true)
    expect(fold.apply(top(S2), decided(7, 'r1'))).toBe(false)
    const after = fold.snapshot(7, INPUTS)
    expect(after.pending).toEqual([])
    expect(after.primary).toBe('ERROR')
  })

  it('surfaces approvals of untracked subagents without tracking their turns', () => {
    const fold = reducer()
    expect(fold.apply(child(SUB), turnStart(1))).toBe(false)
    fold.apply(child(SUB), asked(2, 'r2', 'write'))
    const snapshot = fold.snapshot(2, INPUTS)
    expect(snapshot.primary).toBe('WAITING')
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.pending[0]).toMatchObject({ id: 'r2', sessionId: SUB })
  })

  it('tracks subagents when includeSubagents is on', () => {
    const fold = reducer({ includeSubagents: true })
    fold.apply(child(SUB), turnStart(1))
    expect(fold.snapshot(1, INPUTS).sessions[0]).toMatchObject({ sessionId: SUB, subagent: true, state: 'THINKING' })
  })

  it('honours a pin unless a WAITING Session preempts it', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S2), turnStart(2))
    fold.apply(top(S2), toolCall(3, 'c', 'bash'))
    const pinned = fold.snapshot(3, { ...INPUTS, pinnedSessionId: S1 })
    expect(pinned).toMatchObject({ primary: 'THINKING', focusSessionId: S1, pinnedSessionId: S1 })
    fold.apply(top(S2), asked(4, 'r', 'bash', 'c'))
    expect(fold.snapshot(4, { ...INPUTS, pinnedSessionId: S1 })).toMatchObject({ primary: 'WAITING', focusSessionId: S2 })
    const quiet = reducer({ waitingPreempts: false })
    quiet.apply(top(S1), turnStart(1))
    quiet.apply(top(S2), asked(2, 'r', 'bash'))
    expect(quiet.snapshot(2, { ...INPUTS, pinnedSessionId: S1 })).toMatchObject({ primary: 'THINKING', focusSessionId: S1 })
    expect(quiet.snapshot(2, { ...INPUTS, pinnedSessionId: S2 })).toMatchObject({ primary: 'WAITING', focusSessionId: S2 })
  })

  it('caps published sessions at maxSessions', () => {
    const fold = reducer({ maxSessions: 1 })
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S2), turnStart(2))
    const snapshot = fold.snapshot(2, INPUTS)
    expect(snapshot.sessions.map(view => view.sessionId)).toEqual([S2])
  })
})

describe('PetReducer ordering', () => {
  it('orders pending approvals and jobs by time and ties by Session id', () => {
    const fold = reducer()
    fold.apply(top(S2), turnStart(5))
    fold.apply(top(S1), turnStart(5))
    fold.apply(top(S1), ev('approval/asked', 7, { id: approvalId('late'), toolName: 'bash', reason: 'writes outside cwd' }))
    fold.apply(top(S2), asked(6, 'early', 'bash'))
    fold.apply(top(S1), jobRegistered(9, 'j2', S1))
    fold.apply(top(S1), jobRegistered(8, 'j1', S1))
    const snapshot = fold.snapshot(10, INPUTS)
    expect(snapshot.pending.map(item => item.id)).toEqual(['early', 'late'])
    expect(snapshot.pending[1]?.reason).toBe('writes outside cwd')
    expect(snapshot.jobs.map(job => job.jobId)).toEqual(['j1', 'j2'])
    const tied = reducer()
    tied.apply(top(S2), turnStart(5))
    tied.apply(top(S1), turnStart(5))
    expect(tied.snapshot(5, INPUTS).sessions.map(view => view.sessionId)).toEqual([S1, S2])
  })

  it('reports the earliest of several running holds', () => {
    const fold = reducer()
    fold.apply(top(S1), turnEnd(10, { kind: 'error', error: { message: 'x', code: 'test' } }))
    fold.apply(top(S2), turnEnd(20, { kind: 'completed' }))
    expect(fold.nextExpiry(20)).toBe(1020)
    fold.apply(top(S1), turnEnd(30, { kind: 'completed' }))
    expect(fold.nextExpiry(30)).toBe(1020)
  })

  it('keeps the settled state when a late tool/result arrives after turn/end', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), turnEnd(2, { kind: 'completed' }))
    fold.apply(top(S1), toolResult(3, 'orphan'))
    expect(fold.snapshot(3, INPUTS).sessions[0]?.state).toBe('SUCCESS')
  })

  it('omits the project of a root cwd', () => {
    const fold = reducer()
    fold.apply({ sessionId: S1, cwd: '/', subagent: false }, turnStart(1))
    expect(fold.snapshot(1, INPUTS).sessions[0]?.project).toBeUndefined()
  })
})

describe('PetReducer jobs and disposal', () => {
  it('tracks jobs from registration to settlement', () => {
    const fold = reducer()
    expect(fold.apply(top(S1), jobRegistered(1, 'j1', S1))).toBe(true)
    expect(fold.snapshot(1, INPUTS).jobs).toEqual([{ jobId: 'j1', owner: S1, label: 'pnpm test', kind: 'shell', startedAt: 1 }])
    expect(fold.apply(top(S1), jobSettled(2, 'j1', S1))).toBe(true)
    expect(fold.snapshot(2, INPUTS).jobs).toEqual([])
  })

  it('removes a disposed Session with its approvals and jobs', () => {
    const fold = reducer()
    fold.apply(top(S1), turnStart(1))
    fold.apply(top(S1), asked(2, 'r', 'bash'))
    fold.apply(top(S1), jobRegistered(3, 'j', S1))
    fold.apply(top(S2), jobRegistered(3, 'k', S2))
    fold.apply(top(S2), asked(3, 'q', 'bash'))
    expect(fold.remove(S1)).toBe(true)
    expect(fold.remove(S1)).toBe(false)
    const snapshot = fold.snapshot(4, INPUTS)
    expect(snapshot.sessions.map(view => view.sessionId)).toEqual([S2])
    expect(snapshot.pending.map(item => item.id)).toEqual(['q'])
    expect(snapshot.jobs.map(job => job.jobId)).toEqual(['k'])
  })
})

describe('classifyTool', () => {
  it.each([
    ['run_tests', 'test'],
    ['bash', 'command'],
    ['edit_file', 'edit'],
    ['web_search', 'search'],
    ['code_review', 'tool'],
  ])('%s -> %s', (name, activity) => {
    expect(classifyTool(name)).toBe(activity)
  })
})
