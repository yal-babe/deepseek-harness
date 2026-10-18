/**
 * Drag and throw physics of the character: an overdamped spring that follows
 * the pointer, a release velocity estimated from the pointer trail, and a
 * thrown flight with gravity, wall and ceiling bounces, and ground friction.
 * Pure arithmetic without DOM or timers; the Web overlay and the Desktop pet
 * window step the same functions, so throws feel the same on both.
 *
 * Coordinates are the origin the surface moves (the Web overlay corner, or the
 * Desktop window origin), in CSS pixels / DIP. The character body sits at a
 * fixed offset from that origin ({@link PetBody}); bounds keep the body, not
 * the origin, inside each work area. Pointer samples use absolute pointer
 * coordinates, whose constant offset from the origin does not change velocity.
 *
 * Adapted from PC2005-cloud/dsh-pet (MIT), commit 091b27b, dsh-pet/src/shared/physics.ts.
 * Changes: the body is an arbitrary rectangle instead of a 16:9 box with side
 * insets; squash, landing effects, and pet-to-pet collisions are not ported;
 * screen locking is not offered.
 */

/** Rectangle in the surface's coordinate space. */
export interface PetPhysicsRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Character body relative to the moved origin. */
export type PetBody = PetPhysicsRect

/** Tunable flight parameters (upstream `physics` config section). */
export interface PetPhysicsParams {
  /** Downward acceleration, px/s². */
  readonly gravity: number
  /** Share of speed kept by a bounce, 0–1. */
  readonly restitution: number
  /** Horizontal speed decay rate on the ground, 1/s. */
  readonly groundFriction: number
  /** Whether the top edge bounces; otherwise the body may leave through the top and fall back. */
  readonly ceilingBounce: boolean
}

/** Upstream defaults (`assets/config.jsonc`, `physics`). */
export const PET_PHYSICS: PetPhysicsParams = { gravity: 1400, restitution: 0.78, groundFriction: 2.5, ceilingBounce: true }

/** Spring stiffness of the drag follow. */
export const SPRING_K = 200
/** Spring damping: ζ = c / (2√k) ≈ 1.06, overdamped, no overshoot. */
export const SPRING_C = 30
/** Pointer samples older than this are dropped, ms. */
export const TRAIL_KEEP_MS = 200
/** Window of samples the release velocity uses, ms. */
export const RELEASE_WINDOW_MS = 150
/** A pause this long before release puts the character down instead of throwing it, ms. */
export const RELEASE_STALE_MS = 150
/** Shortest sample span that gives a velocity, ms. */
export const MIN_SPAN_MS = 20
/** Shortest segment for the peak speed; denser samples merge forward, ms. */
export const SEG_MIN_DT_MS = 8
/** Release speeds below this put the character down, px/s. */
export const DEAD_ZONE_SPEED = 500
/** Soft ceiling of throw speed, px/s: cap·(1 − e^(−s/cap)). */
export const MAX_THROW_SPEED = 3600
/** Weight of the window's peak speed against its mean speed. */
export const PEAK_WEIGHT = 0.5
/** Acceleration at which a still-accelerating fling gets the full gain, px/s². */
export const ACCEL_REF = 8000
/** Largest gain for a fling that is still accelerating at release. */
export const ACCEL_GAIN_MAX = 0.6
/** Vertical speed below which a ground contact stops vertical motion, px/s. */
export const REST_VY = 40
/** Horizontal speed below which a grounded body is at rest, px/s. */
export const REST_VX = 15
/** Largest integration step; longer frames (background tabs, stalls) are cut, s. */
export const MAX_STEP_DT = 0.05

/** One pointer sample: `t` in ms (performance clock), `x`/`y` absolute pointer px. */
export interface PetDragSample {
  readonly t: number
  readonly x: number
  readonly y: number
}

/** Allowed range of the moved origin in one work area. */
export interface PetThrowBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** Position and velocity of a thrown character. */
export interface PetThrowState {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
}

/**
 * Throw space: one bound per work area instead of one hull, so an irregular
 * multi-screen layout keeps its holes as walls. `panels` are the full display
 * bounds (taskbar included) and decide whether a neighbour screen lies past an
 * edge; a taskbar on the seam between stacked screens then does not act as a wall.
 */
export interface PetThrowSpace {
  readonly bounds: readonly PetThrowBounds[]
  readonly areas: readonly PetPhysicsRect[]
  readonly panels: readonly PetPhysicsRect[]
  readonly body: PetBody
}

function right(rect: PetPhysicsRect): number { return rect.x + rect.width }
function bottom(rect: PetPhysicsRect): number { return rect.y + rect.height }

function indexAt(rects: readonly PetPhysicsRect[], x: number, y: number): number {
  return rects.findIndex(rect => x >= rect.x && x < right(rect) && y >= rect.y && y < bottom(rect))
}

function nearest(rects: readonly PetPhysicsRect[], x: number, y: number): number {
  let best = -1
  let distance = Infinity
  rects.forEach((rect, index) => {
    const dx = Math.max(rect.x - x, 0, x - right(rect))
    const dy = Math.max(rect.y - y, 0, y - bottom(rect))
    if (dx * dx + dy * dy < distance) { distance = dx * dx + dy * dy; best = index }
  })
  return best
}

/**
 * Origin range that keeps the body inside one work area.
 * @param area - work area.
 * @param body - body relative to the origin.
 * @returns the bounds; a body larger than the area pins to its top-left.
 */
export function throwBoundsIn(area: PetPhysicsRect, body: PetBody): PetThrowBounds {
  const minX = area.x - body.x
  const minY = area.y - body.y
  return { minX, minY, maxX: Math.max(minX, right(area) - body.x - body.width), maxY: Math.max(minY, bottom(area) - body.y - body.height) }
}

/**
 * Build the throw space of a set of work areas.
 * @param areas - work areas, one per screen.
 * @param body - body relative to the origin.
 * @param panels - full display bounds in the same order; absent or mismatched means the work areas.
 * @returns the throw space.
 */
export function throwSpace(areas: readonly PetPhysicsRect[], body: PetBody, panels?: readonly PetPhysicsRect[]): PetThrowSpace {
  return { bounds: areas.map(area => throwBoundsIn(area, body)), areas, panels: panels?.length === areas.length ? panels : areas, body }
}

/**
 * Screen that owns the body: the work area holding its centre, else the nearest one.
 * @param space - throw space.
 * @param x - origin x.
 * @param y - origin y.
 * @returns the area index, or -1 without areas.
 */
export function screenOfBody(space: PetThrowSpace, x: number, y: number): number {
  const cx = x + space.body.x + space.body.width / 2
  const cy = y + space.body.y + space.body.height / 2
  const hit = indexAt(space.areas, cx, cy)
  return hit >= 0 ? hit : nearest(space.areas, cx, cy)
}

function regionOf(space: PetThrowSpace, x: number, y: number):
  { readonly screen: number; readonly bounds: PetThrowBounds; readonly panel: PetPhysicsRect } | undefined {
  const screen = screenOfBody(space, x, y)
  const bounds = space.bounds[screen]
  const panel = space.panels[screen]
  return bounds === undefined || panel === undefined ? undefined : { screen, bounds, panel }
}

/**
 * Drop samples older than the keep window.
 * @param trail - samples in time order.
 * @param now - current time, ms.
 * @returns the kept samples.
 */
export function trimTrail(trail: readonly PetDragSample[], now: number): readonly PetDragSample[] {
  const index = trail.findIndex(sample => sample.t >= now - TRAIL_KEEP_MS)
  return index < 0 ? [] : index === 0 ? trail : trail.slice(index)
}

/**
 * One axis of the overdamped drag spring; the caller then adds `v·dt` to the position.
 * @param v - velocity, px/s.
 * @param x - position.
 * @param target - pointer-driven target.
 * @param dt - step, s.
 * @returns the new velocity.
 */
export function springStep(v: number, x: number, target: number, dt: number): number {
  return v + ((target - x) * SPRING_K - v * SPRING_C) * Math.min(Math.max(dt, 0), MAX_STEP_DT)
}

function softClamp(speed: number): number {
  return speed <= 0 ? 0 : MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED))
}

/**
 * Estimate the release velocity from the pointer trail. Direction comes from
 * the window's end points (robust to jitter); magnitude blends the mean and the
 * peak segment speed, gains while the fling still accelerates, and is soft-capped.
 * @param trail - samples in time order.
 * @param now - release time, ms.
 * @returns px/s, or `undefined` to put the character down (no samples, a pause, too short, or below the dead zone).
 */
export function estimateReleaseVelocity(trail: readonly PetDragSample[], now: number): { vx: number; vy: number } | undefined {
  const last = trail.at(-1)
  if (last === undefined || now - last.t > RELEASE_STALE_MS) return undefined
  const window = trail.filter(sample => now - sample.t <= RELEASE_WINDOW_MS)
  const first = window[0]
  const end = window.at(-1)
  if (first === undefined || end === undefined || window.length < 2 || end.t - first.t < MIN_SPAN_MS) return undefined
  const span = end.t - first.t
  const baseVx = (end.x - first.x) / span * 1000
  const baseVy = (end.y - first.y) / span * 1000
  const base = Math.hypot(baseVx, baseVy)
  if (base < 1e-6) return undefined
  const segments: { speed: number; t: number }[] = []
  let previous = first
  for (const sample of window.slice(1)) {
    const dt = sample.t - previous.t
    if (dt < SEG_MIN_DT_MS) continue
    segments.push({ speed: Math.hypot(sample.x - previous.x, sample.y - previous.y) / dt * 1000, t: sample.t })
    previous = sample
  }
  const peak = segments.length > 0 ? Math.max(...segments.map(segment => segment.speed)) : base
  const head = segments[0]
  const tail = segments.at(-1)
  const accel = head !== undefined && tail !== undefined && segments.length >= 2
    ? (tail.speed - head.speed) / Math.max((tail.t - head.t) / 1000, MIN_SPAN_MS / 1000) : 0
  const gain = 1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX
  const speed = softClamp(((1 - PEAK_WEIGHT) * base + PEAK_WEIGHT * peak) * gain)
  return speed < DEAD_ZONE_SPEED ? undefined : { vx: baseVx / base * speed, vy: baseVy / base * speed }
}

/** Result of one flight step. */
export interface PetThrowStep extends PetThrowState {
  /** Area owning the body after the step, or -1 without areas. */
  readonly screen: number
  /** Whether the step hit a wall, the ceiling, or the ground. */
  readonly bounced: boolean
  /** Whether the body rests on the ground; the caller ends the flight. */
  readonly atRest: boolean
}

/**
 * Advance a thrown character by one step. Bounds come from the screen holding
 * the body centre; an edge with a neighbouring panel beyond it lets the body
 * pass instead of bouncing, so it flies across seams and falls onto a screen
 * below. Crossing is decided without remembering a screen, which avoids
 * flip-flopping in the overlap two adjacent bounds share at a seam.
 * @param state - position and velocity.
 * @param dtRaw - elapsed time, s; cut to {@link MAX_STEP_DT}.
 * @param space - throw space.
 * @param physics - flight parameters.
 * @returns the next state.
 */
export function throwStep(state: PetThrowState, dtRaw: number, space: PetThrowSpace,
  physics: PetPhysicsParams = PET_PHYSICS): PetThrowStep {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT)
  let { x, y, vx, vy } = state
  vy += physics.gravity * dt
  x += vx * dt
  y += vy * dt
  const across = regionOf(space, x, y)
  if (across === undefined) return { x, y, vx, vy, screen: -1, bounced: false, atRest: false }
  const { body } = space
  let bounced = false
  let { bounds, panel } = across
  const cy = y + body.y + body.height / 2
  if (x < bounds.minX) {
    if (indexAt(space.panels, panel.x - 1, cy) < 0) { x = bounds.minX; vx = Math.abs(vx) * physics.restitution; bounced = true }
  } else if (x > bounds.maxX) {
    if (indexAt(space.panels, right(panel), cy) < 0) { x = bounds.maxX; vx = -Math.abs(vx) * physics.restitution; bounced = true }
  }
  const down = regionOf(space, x, y) ?? across
  bounds = down.bounds
  panel = down.panel
  const cx = x + body.x + body.width / 2
  if (y < bounds.minY) {
    if (physics.ceilingBounce && indexAt(space.panels, cx, panel.y - 1) < 0) {
      y = bounds.minY; vy = Math.abs(vy) * physics.restitution; bounced = true
    }
  } else if (y >= bounds.maxY && indexAt(space.panels, cx, bottom(panel)) < 0) {
    y = bounds.maxY
    vx *= Math.max(0, 1 - physics.groundFriction * dt)
    vy = Math.abs(vy) < REST_VY ? 0 : -Math.abs(vy) * physics.restitution
    bounced = true
  }
  const after = regionOf(space, x, y) ?? down
  bounds = after.bounds
  const atRest = (y >= bounds.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX)
    || (bounced && Math.hypot(vx, vy) < REST_VY && Math.abs(vy) < 1)
  return { x, y, vx, vy, screen: after.screen, bounced, atRest }
}

/**
 * Keep an origin so the body lies inside the work area that owns it; used when
 * a flight ends or is cancelled.
 * @param space - throw space.
 * @param x - origin x.
 * @param y - origin y.
 * @returns the clamped origin, unchanged without areas.
 */
export function settleInSpace(space: PetThrowSpace, x: number, y: number): { x: number; y: number } {
  const screen = screenOfBody(space, x, y)
  const bounds = space.bounds[screen]
  if (bounds === undefined) return { x, y }
  return { x: Math.min(Math.max(x, bounds.minX), bounds.maxX), y: Math.min(Math.max(y, bounds.minY), bounds.maxY) }
}
