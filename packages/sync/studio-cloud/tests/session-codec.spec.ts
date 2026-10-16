import { describe, expect, it } from 'vitest'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { SessionId,SessionSeq,SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { encodeCompletedSession,restoreCloudSession } from '../src/session-codec.ts'

type ApprovalRequestId = Branded<'ApprovalRequestId'>

const header:SessionHeader={ version:SESSION_FORMAT_VERSION,id:SessionId('selected-history'),createdAt:1,isSeeded:false,cwd:'/private/device/project' }
const event=(text:string):SessionEvent[]=>[
  { type:'turn/start',seq:SessionSeq(0),time:1,data:{ turn:1 } },
  { type:'user/message',seq:SessionSeq(1),time:2,data:createUserMessage({ source:{ kind:'user' },content:[{ type:'text',text }] }),surfaceOp:'append' },
  { type:'turn/end',seq:SessionSeq(2),time:3,data:{ turn:1,reason:{ kind:'completed' } } },
]

describe('cloud Session format and privacy',()=>{
  it('omits the directory binding and excludes the streaming tail after a completed turn',()=>{
    const events:SessionEvent[]=[...event('completed'),{ type:'turn/start',seq:SessionSeq(3),time:4,data:{ turn:2 } },
      { type:'user/message',seq:SessionSeq(4),time:5,data:createUserMessage({ source:{ kind:'user' },content:[{ type:'text',text:'not committed' }] }),surfaceOp:'append' }]
    const artifact=encodeCompletedSession(header,events,0)
    expect(artifact?.throughSeq).toBe(2)
    expect(artifact?.text).not.toContain('/private/device/project')
    expect(artifact?.text).not.toContain('not committed')
    if(artifact===null)throw new Error('Expected a completed artifact')
    const restored=restoreCloudSession(artifact.text)
    expect(restored.events).toHaveLength(3)
    expect(restored.session.deriveMessages()[0]?.content).toEqual([{ type:'text',text:'completed' }])
  })
  it('omits device execution records without changing transcript positions or messages',()=>{
    const source:SessionEvent[]=[
      { type:'working-directory/change',seq:SessionSeq(0),time:1,data:{ cwd:'/private/device/another-project' } },
      { type:'permission/preset',seq:SessionSeq(1),time:1,data:{ preset:'default' } },
      { type:'sandbox/mode',seq:SessionSeq(2),time:1,data:{ mode:'workspace-write',source:'delegation' } },
      { type:'approval/policy',seq:SessionSeq(3),time:1,data:{ policy:'ask',source:'delegation' } },
      { type:'approval/asked',seq:SessionSeq(4),time:1,data:{ id:'approval-1' as ApprovalRequestId,toolName:'bash',callId:'call-1' as ToolCallId,reason:'needed' } },
      { type:'approval/decided',seq:SessionSeq(5),time:1,data:{ id:'approval-1' as ApprovalRequestId,outcome:'allowed-once' } },
      ...event('selected transcript with code').map(value=>({ ...value,seq:SessionSeq(value.seq+6) })),
    ]
    const artifact=encodeCompletedSession(header,source,0)
    if(artifact===null)throw new Error('Expected a completed artifact')
    expect(artifact.text).not.toContain('/private/device/')
    expect(artifact.text).not.toContain('allowed-once')
    const restored=restoreCloudSession(artifact.text)
    expect(restored.events.map(value=>value.seq)).toEqual(source.map(value=>value.seq))
    expect(restored.events.slice(0,6).every(value=>value.type==='plugin:studio-cloud/device-local' && value.ignorable)).toBe(true)
    expect(restored.session.deriveMessages()[0]?.content).toEqual([{ type:'text',text:'selected transcript with code' }])
    expect(source[0]?.type).toBe('working-directory/change')
  })
  it('redacts transcript secrets before format validation and can restore a log exceeding 4 MiB',()=>{
    const artifact=encodeCompletedSession(header,event(`${'code '.repeat(900000)} api_key=sk-private-token`),0)
    if(artifact===null)throw new Error('Expected a completed artifact')
    expect(Buffer.byteLength(artifact.text)).toBeGreaterThan(4*1024*1024)
    expect(artifact.text).not.toContain('sk-private-token')
    expect(restoreCloudSession(artifact.text).session.deriveMessages()).toHaveLength(1)
  })
  it('does not snapshot an incomplete first turn or an inherited prefix without an own completed turn',()=>{
    expect(encodeCompletedSession(header,event('incomplete').slice(0,2),0)).toBeNull()
    expect(encodeCompletedSession({ ...header,isSeeded:true },event('inherited'),3)).toBeNull()
  })
  it('refuses unsafe directory metadata, corrupted sequence numbers, and unknown format generations',()=>{
    const artifact=encodeCompletedSession(header,event('hello'),0)
    if(artifact===null)throw new Error('Expected a completed artifact')
    const rows=artifact.text.trimEnd().split('\n')
    const first:Record<string,unknown>=JSON.parse(rows[0] ?? '{}')
    expect(()=>restoreCloudSession([JSON.stringify({ ...first,cwd:'/sensitive' }),...rows.slice(1)].join('\n'))).toThrow('UNSAFE_CLOUD_METADATA')
    expect(()=>restoreCloudSession([JSON.stringify({ ...first,version:999 }),...rows.slice(1)].join('\n'))).toThrow(/newer format/)
    expect(()=>restoreCloudSession(artifact.text.replace('"seq":1','"seq":99'))).toThrow()
  })
})
