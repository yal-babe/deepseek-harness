/** Drive `ctx.llm.stream()` through a BlockAssembler. */

import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, GenerateOptions, Message, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { PROVIDER } from '../src/config.ts'

export interface AssembledResult {
  message: Message
  usage?: TokenUsage
  finish: FinishReason
  output: StreamChunk[]
}

/** Assemble one streamed request. @param ctx - harness with an llm service. @param options - request without a required provider. */
export async function assemble(
  ctx: Context,
  options: Omit<GenerateOptions, 'provider'> & { provider?: string },
): Promise<AssembledResult> {
  const assembler = new BlockAssembler()
  const request = { provider: PROVIDER, ...options }
  const output: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream(request)) {
    output.push(chunk)
    assembler.push(chunk)
  }
  return {
    message: assembler.message({
      provider: request.provider,
      model: request.model,
      ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState },
    }),
    ...assembler.usage !== undefined ? { usage: assembler.usage } : {},
    finish: assembler.finish,
    output,
  }
}

/** Collect every chunk from an async iterable. @param chunks - stream. */
export async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const output: StreamChunk[] = []
  for await (const chunk of chunks) output.push(chunk)
  return output
}
