import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export interface MockServer {
  url: string
  paths: string[]
  requests: unknown[]
  headers: IncomingMessage['headers'][]
  readonly closedResponses: number
  readonly requestReceived: Promise<void>
  waitForRequests(count: number): Promise<void>
}

const servers: Server[] = []

/** Close every listener opened since the last call. */
export async function closeMockServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
    server.closeAllConnections()
  })))
}

/** One Cloud Code SSE payload. */
export function cloudEvent(
  parts: unknown[],
  finishReason?: string,
  usage?: Record<string, unknown>,
): string {
  const candidate: Record<string, unknown> = { content: { role: 'model', parts } }
  if (finishReason !== undefined) candidate.finishReason = finishReason
  const response: Record<string, unknown> = { candidates: [candidate] }
  if (usage !== undefined) response.usageMetadata = usage
  return JSON.stringify({ response })
}

/** Companion-project lookup that precedes every generate RPC. */
export const assistProject = { json: { cloudaicompanionProject: 'proj-1' } } as const

/** A minimal complete text generation in Cloud Code SSE. */
export const textEvents = [
  cloudEvent([{ text: 'hello' }]),
  cloudEvent([], 'STOP', { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 }),
]

/** Local provider stand-in: replays scripted behaviors per request. */
export async function mockServer(script: {
  status?: number
  events?: string[]
  body?: string
  /** JSON object sent as `application/json` instead of Cloud Code SSE. */
  json?: unknown
  /** Raw response body; skips SSE even when status is 200. */
  raw?: string
  delayMs?: number
  holdOpen?: boolean
  headers?: Record<string, string>
}[]): Promise<MockServer> {
  const paths: string[] = []
  const requests: unknown[] = []
  const headers: IncomingMessage['headers'][] = []
  const requestReceived = Promise.withResolvers<undefined>()
  const waiters: Array<{ count: number; resolve: () => void }> = []
  let received = 0
  let closedResponses = 0
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    response.on('close', () => {
      clearTimeout(timer)
      closedResponses += 1
    })
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      paths.push(request.url ?? '')
      requests.push(body.length === 0 ? undefined : JSON.parse(body))
      headers.push(request.headers)
      received += 1
      requestReceived.resolve(undefined)
      for (const waiter of waiters) {
        if (received >= waiter.count) waiter.resolve()
      }
      const behavior = script.shift() ?? { status: 500, body: 'script exhausted' }
      const send = (): void => {
        if (behavior.json !== undefined) {
          response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json', ...behavior.headers })
          response.end(JSON.stringify(behavior.json))
          return
        }
        if (behavior.raw !== undefined) {
          response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json', ...behavior.headers })
          response.end(behavior.raw)
          return
        }
        if (behavior.status !== undefined && behavior.status !== 200) {
          response.writeHead(behavior.status, { 'content-type': 'application/json', ...behavior.headers })
          response.end(behavior.body ?? '{}')
          return
        }
        response.writeHead(200, { 'content-type': 'text/event-stream', ...behavior.headers })
        for (const event of behavior.events ?? textEvents) {
          response.write(`data: ${event}\n\n`)
        }
        if (behavior.holdOpen) return
        response.end()
      }
      if (behavior.delayMs !== undefined) timer = setTimeout(send, behavior.delayMs)
      else send()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server missing address')
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    paths,
    requests,
    headers,
    get closedResponses() { return closedResponses },
    requestReceived: requestReceived.promise,
    waitForRequests(count: number) {
      if (received >= count) return Promise.resolve()
      return new Promise<void>((resolve) => { waiters.push({ count, resolve }) })
    },
  }
}

/** Build a UTF-8 byte stream of SSE frames. @param events - `data:` payloads. */
export function sseStream(events: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const text = events.map(event => `data: ${event}\n\n`).join('')
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}
