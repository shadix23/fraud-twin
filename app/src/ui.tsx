import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import NumberFlow from '@number-flow/react'
import { Minus, Pencil, Plus } from 'lucide-react'
import { useLang } from './i18n'

// Примитивы v20 (бриф v20, п. 1): плитка шага, деньги и число на 10 тыс., тумблер, чип значения, поля точек.
// Плита и пилюли - классы .plate, .nest, .ctl-main, .ctl-quiet в index.css.

export type Tone = 'attack' | 'gap' | 'defense' | 'customer' | 'report'
const TONES: Tone[] = ['attack', 'gap', 'defense', 'customer', 'report']
export const STEP_TONE: Tone[] = ['attack', 'attack', 'gap', 'defense', 'customer', 'report']

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// NumberFlow 600 мс по брифу
const FLOW = {
  transformTiming: { duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  spinTiming: { duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  opacityTiming: { duration: 280, easing: 'ease-out' },
} as const

/** Плитка шага: стеклянный градиент 145 градусов. Все пять тонов лежат слоями, смена шага - кроссфейд 400 мс,
 *  два стеклянных листа справа меняют место по тону (data-tone). На «Дыре» текст ink */
export function StepTile({ tone, className = '', children, as = 'div', onClick, label }: {
  tone: Tone; className?: string; children: ReactNode; as?: 'div' | 'button'; onClick?: () => void; label?: string
}) {
  const cls = `tile ${tone === 'gap' ? 'tile-ink' : ''} ${className}`
  const layers = <>
    {TONES.map((t) => <span key={t} aria-hidden className={`tile-bg tone-${t}`} data-on={t === tone ? '' : undefined} />)}
    <span aria-hidden className="tile-sheet tile-sheet-a" />
    <span aria-hidden className="tile-sheet tile-sheet-b" />
  </>
  if (as === 'button') return <button type="button" className={cls} data-tone={tone} onClick={onClick} aria-label={label}>{layers}{children}</button>
  return <div className={cls} data-tone={tone}>{layers}{children}</div>
}

/** Наклон ряда плиток за курсором: до 4 градусов, один обработчик на контейнер, rAF, только transform через --rx/--ry.
 *  Выключен на сенсорных экранах, уже 1024 px и при prefers-reduced-motion. will-change только у плитки под курсором */
export function useTilt(ref: RefObject<HTMLElement | null>, max = 4) {
  useEffect(() => {
    const box = ref.current
    if (!box || typeof window === 'undefined') return
    const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px) and (prefers-reduced-motion: no-preference)')
    let cur: HTMLElement | null = null, raf = 0, px = 0, py = 0
    const reset = (el: HTMLElement | null) => { if (!el) return; for (const k of ['--rx', '--ry', '--px', '--py']) el.style.removeProperty(k); el.style.willChange = '' }
    const apply = () => {
      raf = 0
      if (!cur) return
      const r = cur.getBoundingClientRect()
      const x = Math.max(-0.5, Math.min(0.5, (px - r.left) / r.width - 0.5)), y = Math.max(-0.5, Math.min(0.5, (py - r.top) / r.height - 0.5))
      cur.style.setProperty('--rx', `${(-y * 2 * max * 0.8).toFixed(2)}deg`)
      cur.style.setProperty('--ry', `${(x * 2 * max).toFixed(2)}deg`)
      cur.style.setProperty('--px', (x * 2).toFixed(3)); cur.style.setProperty('--py', (y * 2).toFixed(3))
    }
    const move = (e: PointerEvent) => {
      if (!mq.matches || e.pointerType !== 'mouse') return
      const el = (e.target as Element | null)?.closest<HTMLElement>('.tile') ?? null
      if (el !== cur) { reset(cur); cur = el; if (cur) cur.style.willChange = 'transform' }
      px = e.clientX; py = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const leave = () => { reset(cur); cur = null }
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerleave', leave)
    return () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerleave', leave); cancelAnimationFrame(raf); reset(cur) }
  }, [ref, max])
}

/** Сумма в тенге крупно: «4,2 млн ₸» / «₸4.2M», единица мельче */
export function Money({ v, flow = true }: { v: number; flow?: boolean }) {
  const { lang } = useLang()
  const m = Math.round(v / 1e5) / 10
  const zero = m === 0
  const unit = zero ? '₸' : lang === 'en' ? '₸' : 'млн ₸'
  const pre = lang === 'en'
  const text = zero ? (pre ? '₸0' : '0 ₸') : pre ? `₸${m.toFixed(1)}M` : `${m.toFixed(1).replace('.', ',')} млн ₸`
  return (
    <span className="whitespace-nowrap" data-value={text}>
      {pre && <span className="u !ml-0 mr-[0.06em]">{unit}</span>}
      {flow ? <NumberFlow value={m} locales={lang === 'en' ? 'en-US' : 'ru-RU'} {...FLOW} suffix={pre && !zero ? 'M' : undefined}
        format={zero ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
        : <span>{zero ? '0' : pre ? `${m.toFixed(1)}M` : m.toFixed(1).replace('.', ',')}</span>}
      {!pre && <span className="u">{unit}</span>}
    </span>
  )
}

/** Одно число с одним знаком после запятой по языку */
export function Dec({ v }: { v: number }) {
  const { lang } = useLang()
  const r = Math.round(v * 10) / 10
  return <NumberFlow value={r} locales={lang === 'en' ? 'en-US' : 'ru-RU'} {...FLOW} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
}

/** Свой тумблер 36x22: track -> ink, белый кружок (не iOS по умолчанию) */
export function Switch({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="switch disabled:opacity-45" onClick={() => set(!on)} />
}

/** Значение правила: число-чип на surface-2, по клику поле с минусом и плюсом. Границы приходят снаружи (rule_meta).
 *  Введённое руками вне границ не подрезается молча: onInvalid, и редактор правил показывает границы (F3) */
export function ValueChip({ value, min, max, step, format, onChange, onInvalid, label, changed, title, disabled }: {
  value: number; min: number; max: number; step: number; format: (v: number) => string
  onChange: (v: number) => void; onInvalid?: (v: number) => void; label: string; changed?: boolean; title?: string; disabled?: boolean
}) {
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const [bad, setBad] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { lang } = useLang()
  useEffect(() => { if (edit) input.current?.select() }, [edit])
  // v20-fix D4: значение пришло снаружи (загрузка файла, сброс) - открытое поле с прежним вводом закрываем, ошибку снимаем
  const seen = useRef(value)
  useEffect(() => { if (seen.current !== value) { seen.current = value; setEdit(false); setBad(false) } }, [value])
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const parse = (s: string) => { const r = s.replace(/[\s\u00a0]/g, '').replace(',', '.'); return r === '' ? NaN : Number(r) }
  const commit = (close: boolean) => {
    const v = parse(draft)
    if (!Number.isFinite(v) || v < min || v > max) {
      onInvalid?.(v); setBad(true)
      if (close) { setEdit(false); setBad(false) }
      return
    }
    if (v !== value) onChange(v)
    setEdit(false); setBad(false)
  }
  const nudge = (d: number) => { const v = parse(draft); setBad(false); setDraft(String(clamp((Number.isFinite(v) ? v : value) + d))) }
  if (disabled) return <span className="chip text-ink-2" title={title}>{format(value)}</span>
  if (!edit) {
    return (
      <button type="button" className="chip chip-field" aria-label={`${label}: ${format(value)}`} title={title} onClick={() => { setDraft(String(value)); setEdit(true) }}>
        {changed && <span aria-hidden className="size-1.5 rounded-full bg-ink" />}{format(value)}
        {/* v21 (wow-v21, п. 7): порог выглядит как поле - карандаш и курсор ввода */}
        <Pencil size={13} strokeWidth={1.75} aria-hidden className="chip-pen" />
      </button>
    )
  }
  return (
    <span className={`chip-edit ${bad ? '!shadow-[inset_0_0_0_1.5px_var(--color-leak)]' : ''}`}>
      <button type="button" className="chip-step" aria-label={`${label}: ${lang === 'en' ? 'decrease' : 'меньше'}`} onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(-step)}><Minus size={14} strokeWidth={2} /></button>
      <input ref={input} value={draft} inputMode="numeric" enterKeyHint="done" aria-label={label} aria-invalid={bad || undefined}
        onChange={(e) => { setDraft(e.target.value); setBad(false) }} onBlur={() => commit(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(false) } if (e.key === 'Escape') { e.stopPropagation(); setEdit(false); setBad(false) } }} />
      <button type="button" className="chip-step" aria-label={`${label}: ${lang === 'en' ? 'increase' : 'больше'}`} onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(step)}><Plus size={14} strokeWidth={2} /></button>
    </span>
  )
}

/** Точечный график до 500 точек (SVG): одна точка = одно событие. Появление 8 мс на точку, 0,4 -> 1 за 180 мс.
 *  Цвета приходят в тоне карточки; fade: непрозрачность по ряду 0,45 -> 1 (поздние ряды плотнее), без свечения */
export function DotGrid({ colors, cols, size = 6, gap = 10, label, animate = true, fade = true, className = '' }: {
  colors: string[]; cols: number; size?: number; gap?: number; label: string; animate?: boolean; fade?: boolean; className?: string
}) {
  const rows = Math.ceil(colors.length / cols)
  const op = (i: number) => (fade && rows > 1 ? +(0.45 + 0.55 * (Math.floor(i / cols) / (rows - 1))).toFixed(3) : undefined)
  const still = !animate || reduced()
  return (
    <svg width={cols * gap} height={rows * gap} viewBox={`0 0 ${cols * gap} ${rows * gap}`} role="img" aria-label={label} className={`block ${className}`}>
      {colors.map((c, i) => (
        <circle key={i} cx={(i % cols) * gap + gap / 2} cy={Math.floor(i / cols) * gap + gap / 2} r={size / 2} fill={c} opacity={op(i)}
          className={still ? undefined : 'dot-in'} style={still ? undefined : { animationDelay: `${i * 8}ms` }} />
      ))}
    </svg>
  )
}

/** Поле до 10 000 точек на canvas (точка 2 px, шаг 3 px): честные переводы в тоне плиты (base), отмеченные цветом.
 *  Непрозрачность по ряду 0,55 -> 1, отмеченные 0,9: без «ковра» */
export function DotCanvas({ total, marked, color, cols, label, base = '#B9B6CC' }: { total: number; marked: Set<number>; color: string; cols: number; label: string; base?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const rows = Math.ceil(total / cols)
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = cols * 3 * dpr; c.height = rows * 3 * dpr
    const g = c.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    for (let i = 0; i < total; i++) {
      const m = marked.has(i)
      g.globalAlpha = m ? 0.9 : 0.55 + 0.45 * (rows > 1 ? Math.floor(i / cols) / (rows - 1) : 1)
      g.fillStyle = m ? color : base
      g.beginPath(); g.arc((i % cols) * 3 + 1.5, Math.floor(i / cols) * 3 + 1.5, 1, 0, Math.PI * 2); g.fill()
    }
  }, [total, marked, color, cols, rows, base])
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: cols * 3, height: rows * 3 }} className="block" />
}
