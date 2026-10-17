/** Sprite playback with active-time accounting, loop support, and a held resting pose. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PetMotionClip } from '@deepseek-ai/dsh-pet/types'
import css from './Pet.module.css'

export function PetSprite({ clip, sheet, paused, resting = false, loop = false, onEnd, onFailure }: {
  readonly clip: PetMotionClip
  readonly sheet: NonNullable<PetMotionClip['sheet']>
  readonly resting?: boolean
  readonly loop?: boolean
  readonly paused: boolean
  readonly onEnd: () => void
  readonly onFailure: () => void
}) {
  const [frame, setFrame] = useState(0)
  const end = useRef(onEnd)
  end.current = onEnd
  const elapsed = useRef(0)
  useEffect(() => {
    if (paused || resting) return
    const start = Date.now() - elapsed.current
    const timer = setInterval(() => {
      elapsed.current = Date.now() - start
      const position = loop ? elapsed.current % clip.durationMs : elapsed.current
      setFrame(Math.min(sheet.frames - 1, Math.floor(position / clip.durationMs * sheet.frames)))
      if (!loop && elapsed.current >= clip.durationMs) { clearInterval(timer); end.current() }
    }, 50)
    return () => { elapsed.current = Date.now() - start; clearInterval(timer) }
  }, [clip, paused, resting, loop, sheet.frames])
  const index = resting ? Math.floor(sheet.frames / 2) : frame
  const style: CSSProperties = {
    backgroundImage: `url("${clip.url}")`,
    backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: `${index % sheet.columns / Math.max(1, sheet.columns - 1) * 100}% ${Math.floor(index / sheet.columns) / Math.max(1, sheet.rows - 1) * 100}%`,
  }
  return <span className={css.sprite} data-pet-sprite="" style={style}>
    <img className={css.spriteProbe} src={clip.url} alt="" onError={onFailure} />
  </span>
}
