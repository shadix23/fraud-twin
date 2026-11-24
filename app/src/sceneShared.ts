// Общее для сцены и 3D-слоя: тайминг, выходы, изгиб движения.

export const SPEED = 28 // минут симуляции в секунду: атака идёт около 10 с
export const LINE_MIN = 0.55 * SPEED // перевод летит 550 мс; в этот момент число «Выведено» прибавляет сумму
export const STOP = new Set(['blocked', 'suspended', 'cancelled', 'frozen_src', 'frozen_dst'])
export const EXIT_ORDER = ['crypto', 'ext', 'atm']

export function exitKey(role?: string) { return role === 'trader' ? 'crypto' : role === 'atm' ? 'atm' : 'ext' }

// cubic-bezier(0.2, 0, 0, 1): тот же изгиб, что у интерфейса
export function ease(x: number) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  let lo = 0, hi = 1, s = 0.5
  for (let k = 0; k < 18; k++) {
    s = (lo + hi) / 2
    const bx = 3 * (1 - s) * (1 - s) * s * 0.2 + s * s * s
    if (bx < x) lo = s; else hi = s
  }
  return 3 * (1 - s) * s * s + s * s * s
}
