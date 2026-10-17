/** Finite sprite playback for the new, eight-pose character interactions. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PetMotionClip } from '@deepseek-ai/dsh-pet/types'
import css from './Pet.module.css'

export function PetSprite({ clip, sheet, paused, onEnd, onFailure }: {
  readonly clip: PetMotionClip
  readonly sheet: NonNullable<PetMotionClip['sheet']>
  readonly paused: boolean
  readonly onEnd: () => void
  readonly onFailure: () => void
}) {
  const [frame, setFrame] = useState(0)
  const end = useRef(onEnd)
  end.current = onEnd
  useEffect(() => {
    if (paused) return
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      setFrame(Math.min(sheet.frames - 1, Math.floor(elapsed / clip.durationMs * sheet.frames)))
      if (elapsed >= clip.durationMs) { clearInterval(timer); end.current() }
    }, 50)
    return () => { clearInterval(timer) }
  }, [clip, paused, sheet.frames])
  const style: CSSProperties = {
    backgroundImage: `url("${clip.url}")`,
    backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: `${frame % sheet.columns / Math.max(1, sheet.columns - 1) * 100}% ${Math.floor(frame / sheet.columns) / Math.max(1, sheet.rows - 1) * 100}%`,
  }
  return <span className={css.sprite} data-pet-sprite="" style={style}>
    <img className={css.spriteProbe} src={clip.url} alt="" onError={onFailure} />
  </span>
}
