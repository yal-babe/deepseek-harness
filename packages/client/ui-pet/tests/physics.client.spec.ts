import { describe, expect, it } from 'vitest'
import {
  DEAD_ZONE_SPEED, estimateReleaseVelocity, MAX_THROW_SPEED, PET_PHYSICS, screenOfBody, settleInSpace, springStep, throwBoundsIn,
  throwSpace, throwStep, trimTrail, type PetThrowState,
} from '../src/client/physics.ts'

const body = { x: 10, y: 20, width: 100, height: 80 }
const screen = { x: 0, y: 0, width: 1000, height: 800 }

function fly(state: PetThrowState, space: ReturnType<typeof throwSpace>, steps = 2000) {
  let current = { ...state, screen: -1, bounced: false, atRest: false }
  const path = [current]
  for (let index = 0; index < steps && !current.atRest; index++) {
    current = throwStep(current, 1 / 60, space)
    path.push(current)
  }
  return { last: current, path }
}

describe('release velocity', () => {
  const line = (speed: number, count = 10, step = 10) =>
    Array.from({ length: count }, (_, index) => ({ t: index * step, x: index * step * speed / 1000, y: 0 }))

  it('puts the character down after a pause, a short or slow trail, or pure jitter', () => {
    expect(estimateReleaseVelocity([], 0)).toBeUndefined()
    expect(estimateReleaseVelocity(line(2000), 90 + 151)).toBeUndefined()
    expect(estimateReleaseVelocity(line(2000, 2), 10)).toBeUndefined()
    expect(estimateReleaseVelocity(line(DEAD_ZONE_SPEED / 2), 90)).toBeUndefined()
    expect(estimateReleaseVelocity([{ t: 0, x: 5, y: 5 }, { t: 30, x: 9, y: 2 }, { t: 60, x: 5, y: 5 }], 60)).toBeUndefined()
  })

  it('throws along the trail direction and never exceeds the soft cap', () => {
    const steady = estimateReleaseVelocity(line(2000), 90)!
    expect(steady.vx).toBeGreaterThan(DEAD_ZONE_SPEED)
    expect(steady.vy).toBe(0)
    const hard = estimateReleaseVelocity(line(50000), 90)!
    expect(hard.vx).toBeLessThan(MAX_THROW_SPEED)
    expect(hard.vx).toBeGreaterThan(steady.vx)
    const up = estimateReleaseVelocity(line(2000).map(sample => ({ ...sample, y: -sample.x, x: 0 })), 90)!
    expect(up.vy).toBeLessThan(0)
    expect(Math.abs(up.vx)).toBeLessThan(1e-9)
  })

  it('keeps only recent samples', () => {
    expect(trimTrail(line(1000, 30), 290).map(sample => sample.t)[0]).toBe(90)
    expect(trimTrail(line(1000, 3), 1000)).toEqual([])
  })
})

describe('drag spring', () => {
  it('converges on the target without overshoot', () => {
    let x = 0
    let v = 0
    let max = 0
    for (let index = 0; index < 120; index++) {
      v = springStep(v, x, 100, 1 / 60)
      x += v / 60
      max = Math.max(max, x)
    }
    expect(x).toBeCloseTo(100, 0)
    expect(max).toBeLessThanOrEqual(100.5)
  })
})

describe('flight in one work area', () => {
  const space = throwSpace([screen], body)

  it('keeps the body, not the origin, inside the area', () => {
    expect(throwBoundsIn(screen, body)).toEqual({ minX: -10, minY: -20, maxX: 890, maxY: 700 })
    expect(throwBoundsIn({ x: 0, y: 0, width: 50, height: 50 }, body)).toEqual({ minX: -10, minY: -20, maxX: -10, maxY: -20 })
  })

  it('falls, bounces off the ground with friction, and comes to rest on it', () => {
    const { last, path } = fly({ x: 400, y: 100, vx: 600, vy: 0 }, space)
    expect(last.atRest).toBe(true)
    expect(last.y).toBe(700)
    expect(path.filter(step => step.bounced).length).toBeGreaterThan(1)
    expect(Math.max(...path.map(step => step.x))).toBeLessThanOrEqual(890)
  })

  it('bounces off walls and the ceiling with restitution, unless the ceiling is open', () => {
    const wall = throwStep({ x: 885, y: 300, vx: 1000, vy: 0 }, 0.02, space)
    expect(wall).toMatchObject({ x: 890, bounced: true })
    expect(wall.vx).toBeCloseTo(-780)
    const ceiling = throwStep({ x: 400, y: -15, vx: 0, vy: -1000 }, 0.02, space)
    expect(ceiling).toMatchObject({ y: -20, bounced: true })
    expect(ceiling.vy).toBeGreaterThan(0)
    const open = throwStep({ x: 400, y: -15, vx: 0, vy: -1000 }, 0.02, space, { ...PET_PHYSICS, ceilingBounce: false })
    expect(open.y).toBeLessThan(-20)
  })

  it('cuts long frames', () => {
    expect(throwStep({ x: 400, y: 100, vx: 0, vy: 0 }, 5, space).vy).toBeCloseTo(PET_PHYSICS.gravity * 0.05)
  })
})

describe('flight across screens', () => {
  const left = { x: 0, y: 0, width: 1000, height: 760 }
  const leftPanel = { x: 0, y: 0, width: 1000, height: 800 }
  const rightScreen = { x: 1000, y: 200, width: 800, height: 600 }

  it('crosses a seam into the neighbour and lands on its floor', () => {
    const space = throwSpace([left, rightScreen], body, [leftPanel, rightScreen])
    const { last, path } = fly({ x: 700, y: 300, vx: 2500, vy: -200 }, space)
    // The seam at x = 1000 does not bounce; the first wall is the right screen's far edge.
    expect(path.find(step => step.bounced)).toMatchObject({ x: 1800 - 10 - 100, screen: 1 })
    expect(last.atRest).toBe(true)
    expect([760 - 20 - 80, 800 - 20 - 80]).toContain(last.y)
  })

  it('treats empty space beside a screen as a wall', () => {
    const space = throwSpace([left, rightScreen], body, [leftPanel, rightScreen])
    // Above the right screen's top there is no panel: the body bounces back from that edge.
    const step = throwStep({ x: 1200, y: 182, vx: 0, vy: -900 }, 0.02, space)
    expect(step).toMatchObject({ bounced: true, y: 180 })
  })

  it('falls through a taskbar seam onto a screen stacked below', () => {
    const top = { x: 0, y: 0, width: 1000, height: 760 }
    const topPanel = { x: 0, y: 0, width: 1000, height: 800 }
    const below = { x: 0, y: 800, width: 1000, height: 800 }
    const space = throwSpace([top, below], body, [topPanel, below])
    const { last } = fly({ x: 400, y: 600, vx: 0, vy: 300 }, space)
    expect(screenOfBody(space, last.x, last.y)).toBe(1)
    expect(last.y).toBe(1600 - 20 - 80)
  })

  it('settles an origin back inside the owning area', () => {
    const space = throwSpace([left, rightScreen], body, [leftPanel, rightScreen])
    expect(settleInSpace(space, 1750, 900)).toEqual({ x: 1690, y: 700 })
    expect(settleInSpace(throwSpace([], body), 5, 6)).toEqual({ x: 5, y: 6 })
  })
})
