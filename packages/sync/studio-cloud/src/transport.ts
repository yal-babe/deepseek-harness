/** Validated Studio HTTP responses. Redirects never receive Host-owned device credentials. */
import { z } from 'zod'

/** An expected transport or server rejection; messages never include credentials or server bodies. */
export class CloudError extends Error {
  /** @param code - stable recovery code. @param status - HTTP status, or zero for local failures. */
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(`Studio cloud: ${code}`)
  }
}
/**
 * Validate the explicitly selected deployment origin.
 * @param raw - HTTP(S) origin, without userinfo, path, query, or fragment.
 * @param _allowHttp - retained for compatibility; both HTTP and HTTPS are supported.
 * @returns normalized origin.
 */
export function cloudOrigin(raw: string, _allowHttp = true): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch (_invalidUrl) {
    throw new CloudError('INVALID_ORIGIN')
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new CloudError('INVALID_ORIGIN')
  return url.origin
}
/**
 * Perform one bounded request. Unknown upload outcomes must retain the original request ID.
 * @param origin - normalized configured origin.
 * @param path - owner-defined API route.
 * @param options - request metadata, lifetime and credential.
 * @param schema - expected response parser.
 * @returns parsed response; expected failures throw CloudError.
 */
export async function cloudRequest<T>(
  origin: string,
  path: string,
  options: {
    method?: string
    body?: object
    token?: string
    signal: AbortSignal
    timeoutMs: number
  },
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(new URL(path, origin), {
      method: options.method ?? 'GET',
      redirect: 'error',
      headers: {
        'content-type': options.body instanceof Uint8Array ? 'application/octet-stream' : 'application/json',
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      },
      ...(options.body === undefined ? {} : {
        body: options.body instanceof Uint8Array ? Uint8Array.from(options.body).buffer : JSON.stringify(options.body),
      }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
    })
  } catch (_transportError) {
    throw new CloudError(options.signal.aborted ? 'CANCELLED' : 'NETWORK')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (_invalidJson) {
    throw new CloudError('INVALID_RESPONSE', response.status)
  }
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string().max(100) }) }).safeParse(body)
    throw new CloudError(error.success ? error.data.error.code : 'REQUEST_REJECTED', response.status)
  }
  const result = schema.safeParse(body)
  if (!result.success) throw new CloudError('INVALID_RESPONSE', response.status)
  return result.data
}

/**
 * Read one bounded immutable cloud file. Redirects are rejected and credentials stay on the selected issuer.
 * @param origin - normalized selected origin.
 * @param path - owner-defined file download route.
 * @param token - captured Host device credential.
 * @param signal - account lifetime.
 * @param timeoutMs - deployment request deadline.
 * @param maxBytes - exact expected upper bound before buffering.
 * @returns bounded bytes; callers verify the manifest digest before persistence or import.
 */
export async function cloudDownload(
  origin: string,
  path: string,
  token: string,
  signal: AbortSignal,
  timeoutMs: number,
  maxBytes: number,
): Promise<Uint8Array> {
  let response:Response
  try {response=await fetch(new URL(path,origin),{ headers:{ authorization:`Bearer ${token}` },redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]) })}
  catch(_transportError){throw new CloudError(signal.aborted?'CANCELLED':'NETWORK')}
  if(!response.ok) {
    await response.body?.cancel()
    throw new CloudError(response.status===401?'UNAUTHORIZED':'FILE_DOWNLOAD_FAILED',response.status)
  }
  const reader=response.body?.getReader()
  if(reader===undefined)throw new CloudError('FILE_DAMAGED')
  const chunks:Uint8Array[]=[]
  let size=0,complete=false
  try {
    for(;;) {
      const next=await reader.read()
      if(next.done){complete=true;break}
      size+=next.value.byteLength
      if(size>maxBytes)throw new CloudError('FILE_SIZE')
      chunks.push(next.value)
    }
  } catch(error) {
    if(error instanceof CloudError)throw error
    throw new CloudError(signal.aborted?'CANCELLED':'NETWORK')
  } finally {if(!complete)await reader.cancel();reader.releaseLock()}
  const bytes=new Uint8Array(size)
  let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return bytes
}
