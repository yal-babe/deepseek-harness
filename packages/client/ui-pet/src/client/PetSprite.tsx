/** Sprite playback with active-time accounting, loop support, and a held resting pose. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PetMotionClip } from '@deepseek-ai/dsh-pet/types'
import css from './Pet.module.css'

/**
 * Play a selected atlas range after loading, preserving active time across pauses.
 * @param props - media, range, loading fallback and playback callbacks.
 * @returns the current sprite cell and its image-loading probe.
 */
export function PetSprite({ clip, sheet, paused, resting = false, loop = false, poster, knownReady = false, onReady, onEnd, onFailure }: {
  readonly clip: PetMotionClip
  readonly sheet: NonNullable<PetMotionClip['sheet']>
  readonly resting?: boolean
  readonly loop?: boolean
  readonly poster?: string | undefined
  readonly knownReady?: boolean
  readonly onReady?: () => void
  readonly paused: boolean
  readonly onEnd: () => void
  readonly onFailure: () => void
}) {
  const [ready, setReady] = useState(knownReady)
  const [frame, setFrame] = useState(0)
  const end = useRef(onEnd)
  end.current = onEnd
  const elapsed = useRef(0)
  useEffect(() => {
    if (paused || resting || !ready) return
    const start = Date.now() - elapsed.current
    let frameRequest: number
    const tick = (): void => {
      elapsed.current = Date.now() - start
      const position = loop ? elapsed.current % clip.durationMs : elapsed.current
      setFrame(Math.min(sheet.frames - 1, Math.floor(position / clip.durationMs * sheet.frames)))
      if (!loop && elapsed.current >= clip.durationMs) { end.current(); return }
      frameRequest = window.requestAnimationFrame(tick)
    }
    frameRequest = window.requestAnimationFrame(tick)
    return () => { elapsed.current = Date.now() - start; window.cancelAnimationFrame(frameRequest) }
  }, [clip, paused, resting, loop, sheet.frames, ready])
  const index = (sheet.startFrame ?? 0) + (resting ? Math.floor(sheet.frames / 2) : frame)
  const style: CSSProperties = {
    backgroundImage: `url("${!ready && poster !== undefined ? poster : clip.url}")`,
    backgroundSize: !ready && poster !== undefined ? 'contain' : `${sheet.columns * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: !ready && poster !== undefined ? 'center bottom' : `${index % sheet.columns / Math.max(1, sheet.columns - 1) * 100}% ${Math.floor(index / sheet.columns) / Math.max(1, sheet.rows - 1) * 100}%`,
  }
  return <span className={css.sprite} data-pet-sprite="" data-static-rest={resting} data-dense={sheet.frames > 8 || sheet.startFrame !== undefined} data-pet-frame={index} style={style}>
    <img className={css.spriteProbe} src={clip.url} alt="" onLoad={() => { setReady(true); onReady?.() }} onError={onFailure} />
  </span>
}
