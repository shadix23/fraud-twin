// Токены движения (motion-brief.md, раздел 3). Все числа анимаций берутся только отсюда.
// Правила: анимируются только transform и opacity; уход короче прихода и без сдвига; в покое ничего не движется.

export const spring = {
  /** плитка числа: «Перелив» между шагами */
  tile: { type: 'spring', visualDuration: 0.55, bounce: 0.14 },
  /** большие плиты, телефон */
  heavy: { type: 'spring', visualDuration: 0.7, bounce: 0.08 },
  /** линия шага, сегменты, ширина кнопки */
  ui: { type: 'spring', visualDuration: 0.35, bounce: 0.1 },
  /** ручка тумблера, лучшая точка, знак риска */
  pop: { type: 'spring', visualDuration: 0.4, bounce: 0.32 },
} as const

/** кривые в виде массивов для Motion; те же значения лежат в index.css как --ease-soft, --ease-out, --ease-in-quick */
export const ease = {
  soft: [0.16, 1, 0.3, 1] as [number, number, number, number],
  out: [0.2, 0, 0, 1] as [number, number, number, number],
  in: [0.4, 0, 1, 1] as [number, number, number, number],
}
export const easeCss = {
  soft: 'cubic-bezier(0.16, 1, 0.3, 1)',
  out: 'cubic-bezier(0.2, 0, 0, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
}

/** длительности, мс */
export const dur = { press: 120, exit: 140, fade: 240, hover: 220, enter: 420, tone: 520, count: 900 } as const

/** хореография «Перелива» от клика (T0), секунды (раздел 4) */
export const flow = {
  sheets: 0.06, // листы перелистываются
  head: 0.28, // новый заголовок из-под маски
  headMute: 0.4, // серая строка заголовка
  right: 0.32, // правая часть
  sat: 0.52, // спутники плитки
  satStep: 0.06,
  button: 0.6, // кнопка шага
} as const

/** NumberFlow: число плитки пересчитывается на месте (spin и transform 900 мс, opacity 280 мс) */
export const numberTiming = {
  transformTiming: { duration: dur.count, easing: easeCss.soft },
  spinTiming: { duration: dur.count, easing: easeCss.soft },
  opacityTiming: { duration: 280, easing: 'ease-out' },
} as const

export const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
