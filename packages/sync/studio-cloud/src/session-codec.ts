/** Selected completed Session histories use the installed format catalog and exclude device metadata. */
import { z } from 'zod'
import { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { currentSessionMessageProjections } from '@deepseek-ai/dsh-session-format-catalog/message-projections'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { redactSecrets } from '@deepseek-ai/dsh-sync-protocol'
import { CloudError } from './transport.ts'

const deviceLocalEvents=new Set(['working-directory/change','permission/preset','sandbox/mode','approval/policy','approval/asked','approval/decided'])

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Replaces device-local execution records in cloud-synced sessions to preserve sequence numbers.
     */
    'plugin:studio-cloud/device-local': { eventType: string }
  }
}

const forbidden=/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|private[_-]?key|env|environment)$/i
/** Filter credential fields before redacting every text leaf of the selected transcript. */
function sanitize(value:SessionFormatJsonValue):SessionFormatJsonValue {
  if(typeof value==='string') {
    const trimmed=value.trimStart()
    if(trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let parsed:unknown
      try {parsed=JSON.parse(value)} catch(_notJson){parsed=undefined}
      if(parsed!==undefined)return JSON.stringify(sanitize(z.json().parse(parsed)))
    }
    return redactSecrets(value)
  }
  if(Array.isArray(value))return value.map(sanitize)
  if(value!==null && typeof value==='object') {
    const result:Record<string,SessionFormatJsonValue>={}
    for(const [key,entry] of Object.entries(value))if(!forbidden.test(key))result[key]=sanitize(entry)
    return result
  }
  return value
}
/** Canonical cloud artifact and its committed prefix identity. */
export interface CompletedSessionArtifact {
  text:string
  throughSeq:number
  sessionId:SessionId
  inheritedEventCount:number
}
/**
 * Encode only the last fully committed turn, never a streaming or interrupted tail.
 * @param header - device-local Session metadata; cwd is excluded from the physical cloud header.
 * @param events - validated committed log from persistence, without synthetic recovery closers.
 * @param inheritedEventCount - exact inherited prefix length.
 * @returns validated, sanitized current-format JSONL; null when no own completed turn exists.
 */
export function encodeCompletedSession(
  header: SessionHeader,
  events: readonly SessionEvent[],
  inheritedEventCount: number,
): CompletedSessionArtifact | null {
  const end=events.findLast(event=>event.type==='turn/end')
  if(end===undefined || end.seq<inheritedEventCount)return null
  const logical={ version:header.version,id:String(header.id),createdAt:header.createdAt,isSeeded:header.isSeeded,
    delegationDepth:header.delegationDepth ?? 0,
    ...(header.parentSession===undefined?{}:{ parentSession:String(header.parentSession) }),
    ...(header.agentPreset===undefined?{}:{ agentPreset:header.agentPreset }),
    ...(header.origin===undefined?{}:{ origin:header.origin }),
  }
  const physical=sessionFormatCatalog.encodeCurrentHeader(logical,inheritedEventCount)
  const restore=sessionFormatCatalog.createRestore(physical,{ recovery:'strict',validation:'current' })
  const lines=[JSON.stringify(physical)]
  for(const event of events.slice(0,end.seq+1)) {
    if(deviceLocalEvents.has(event.type)) {
      const omitted={ type:'plugin:studio-cloud/device-local',seq:event.seq,time:event.time,data:{ eventType:event.type },ignorable:true }
      restore.decodeRow(omitted)
      lines.push(JSON.stringify(omitted))
      continue
    }
    const raw=z.record(z.string(),z.json()).parse(event)
    const row:Record<string,SessionFormatJsonValue>={}
    for(const field of ['type','seq','time','data','surfaceOp','sourceEventSeqs','ignorable']) {
      const value=raw[field]
      if(value!==undefined)row[field]=sanitize(value)
    }
    restore.decodeRow(row)
    lines.push(JSON.stringify(row))
  }
  restore.finish()
  return { text:`${lines.join('\n')}\n`,throughSeq:end.seq,sessionId:header.id,inheritedEventCount }
}
/**
 * Validate and migrate downloaded history without publishing a writable Session or starting any Agent.
 * @param text - verified complete cloud JSONL artifact.
 * @returns an isolated read-only history value whose model input derives solely from this log.
 */
export function restoreCloudSession(text:string):{ session:Session;events:readonly SessionEvent[];storedVersion:number } {
  const lines=text.trimEnd().split('\n'),first=lines.shift()
  if(first===undefined || first==='')throw new CloudError('SESSION_DAMAGED')
  const raw=z.record(z.string(),z.json()).parse(JSON.parse(first))
  if(Object.hasOwn(raw,'cwd'))throw new CloudError('UNSAFE_CLOUD_METADATA')
  const restore=sessionFormatCatalog.createRestore(raw,{ recovery:'strict',validation:'current' })
  for(const line of lines)restore.decodeRow(JSON.parse(line))
  const artifact=restore.finish()
  const header:SessionHeader={ version:SESSION_FORMAT_VERSION,id:SessionId(artifact.header.id),createdAt:artifact.header.createdAt,
    isSeeded:artifact.header.isSeeded,delegationDepth:artifact.header.delegationDepth,
    ...(artifact.header.parentSession===undefined?{}:{ parentSession:SessionId(artifact.header.parentSession) }),
    ...(artifact.header.agentPreset===undefined?{}:{ agentPreset:artifact.header.agentPreset }),
    ...(artifact.header.origin===undefined?{}:{ origin:artifact.header.origin }),
  }
  // The catalog's current validator has validated every event and its surface transitions.
  const events=artifact.events as readonly SessionEvent[]
  if(events.some(event=>deviceLocalEvents.has(event.type)))throw new CloudError('UNSAFE_CLOUD_METADATA')
  return { session:Session.fromRestore(header.id,events,header,SessionLogOffset(artifact.inheritedEventCount),'detached',currentSessionMessageProjections),events,storedVersion:z.number().int().nonnegative().parse(raw.version) }
}
