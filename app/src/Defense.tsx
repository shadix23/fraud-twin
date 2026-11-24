import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { List } from 'lucide-react'
import { useLang } from './i18n'
import { intl, num } from './format'

// Шаг «Защита» (бриф v20, F5): две меры своими тумблерами с ценой для честных и поле 10 000 честных переводов.
// Точка = один честный перевод: задетые мерой окрашены warn-dot, число рядом то же, что на плитке шага.

const TOTAL = 10_000
const STEP = 3 // шаг сетки 3 px, точка 2 px (бриф, «Графики из точек»)
const GRAY = '#BDB9D2'
const WARN = '#F09A3E'
const BIG = 1.5 // радиус задетой точки
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Порядок окрашивания: одна перестановка на всю сессию (seed 7). Число растёт -> добавляются точки, уже окрашенные остаются на месте
let RANK: Uint16Array | null = null
function ranks() {
  if (RANK) return RANK
  let a = 7
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const order = Array.from({ length: TOTAL }, (_, i) => i)
  for (let i = TOTAL - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  RANK = new Uint16Array(TOTAL)
  order.forEach((cell, k) => { RANK![cell] = k })
  return RANK
}

/** Поле 10 000 точек на canvas. Новые задетые появляются по спецификации точек (0,4 -> 1 за 180 мс, до 8 мс на точку, всё поле до 0,8 с) */
export function HonestField({ per10k, onFeed }: { per10k: number; onFeed: () => void }) {
  const { t, lang } = useLang()
  const wrap = useRef<HTMLDivElement>(null)
  const cvs = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setW(Math.floor(el.clientWidth))
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const n = Math.max(0, Math.min(TOTAL, Math.round(per10k)))
  const prev = useRef(n)
  const cols = Math.max(40, Math.floor(w / STEP))
  const rows = Math.ceil(TOTAL / cols)

  useEffect(() => {
    const c = cvs.current
    if (!c || !w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = cols * STEP * dpr; c.height = rows * STEP * dpr
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const rank = ranks()
    const from = Math.min(prev.current, n)
    const fresh = n - from
    prev.current = n
    const per = fresh > 0 ? Math.min(8, 600 / fresh) : 0
    // при dpr 1 круг радиуса 1 размывается в бледное пятно: рисуем ровный квадрат 2x2 по сетке пикселей; задетые на треть крупнее, иначе 24 точки из 10 000 не найти
    const crisp = dpr < 1.5
    const dot = (i: number, r: number) => {
      const x = (i % cols) * STEP, y = Math.floor(i / cols) * STEP
      if (crisp) { const s = Math.max(1, Math.round(r * 2)); g.rect(x, y, s, s); return }
      g.moveTo(x + 1 + r, y + 1); g.arc(x + 1, y + 1, r, 0, Math.PI * 2)
    }
    const paint = (ms: number) => {
      g.clearRect(0, 0, cols * STEP, rows * STEP)
      g.fillStyle = GRAY; g.beginPath()
      for (let i = 0; i < TOTAL; i++) if (rank[i] >= from) dot(i, 1)
      g.fill()
      g.fillStyle = WARN; g.beginPath()
      for (let i = 0; i < TOTAL; i++) {
        const k = rank[i]
        if (k < from) dot(i, BIG)
        else if (k < n) { const p = Math.min(1, Math.max(0, (ms - (k - from) * per) / 180)); if (p > 0) dot(i, BIG * (0.4 + 0.6 * (1 - (1 - p) ** 3))) }
      }
      g.fill()
    }
    if (!fresh || reduced()) { paint(1e9); return }
    let raf = 0
    const t0 = performance.now()
    const end = fresh * per + 180
    const tick = (now: number) => { const ms = now - t0; paint(ms); if (ms < end) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); paint(1e9) }
  }, [n, w, cols, rows])

  return (
    <section data-honest-field aria-label={t.defense.fieldCaps}>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <div className="flex items-baseline gap-3">
          <h3 className="t-caps text-ink-3">{t.defense.fieldCaps}</h3>
          <p className="whitespace-nowrap text-[15px] font-medium tabular-nums text-ink-3" data-field-count>
            <b className="text-[20px] font-semibold tracking-[-0.02em] text-warn">{intl(n, lang)}</b> {t.defense.fieldOf}
          </p>
        </div>
        <button type="button" className="-mr-1 flex min-h-9 items-center gap-2 rounded-lg px-1 text-[15px] font-medium text-ink-2 hover:text-ink" onClick={onFeed} data-feed-open>
          <List size={16} strokeWidth={1.75} aria-hidden />{t.defense.feed}
        </button>
      </div>
      <div ref={wrap} className="mt-2">
        <canvas ref={cvs} role="img" aria-label={t.defense.fieldAria(intl(n, lang))} style={{ width: cols * STEP, height: rows * STEP }} className="block" />
      </div>
      <p className="t-caption mt-2 text-ink-3">{t.defense.fieldCaption}</p>
    </section>
  )
}

/** Мера: свой тумблер, имя, цена для честных справа (на сколько задержек на 10 тыс. больше), пометка второй строкой */
export function MeasureRow({ on, set, name, note, hint, price, hotkey, locked }: {
  on: boolean; set: (v: boolean) => void; name: string; note?: string; hint?: string; price: number | null; hotkey: string; locked?: boolean
}) {
  const { t, lang } = useLang()
  const sign = price == null ? '' : price < 0 ? '−' : '+'
  const p = price == null ? '' : `${sign}${num(Math.abs(price), lang)}`
  return (
    <div data-measure className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 py-1.5 ${locked ? '' : 'cursor-pointer'}`}
      onClick={(e) => { if (!locked && !(e.target as HTMLElement).closest('[role=switch]')) set(!on) }}>
      <button type="button" role="switch" aria-checked={on} aria-label={t.defense.switchAria(name)} aria-keyshortcuts={hotkey} disabled={locked}
        className="switch mt-px disabled:opacity-60" onClick={() => set(!on)} />
      <span className="min-w-0 text-[15px] font-medium leading-[22px] tracking-[-0.01em] text-ink">{name}</span>
      <span className="text-right text-[15px] font-semibold leading-[22px] tabular-nums text-warn" title={t.defense.priceTitle} aria-label={price != null ? t.defense.priceAria(p) : undefined}>
        {p}
      </span>
      {/* пометка во всю ширину под именем и ценой: «сценарий, в РК для переводов не действует» на 375 px не ломается в три строки */}
      {note && <span className="col-span-2 col-start-2 text-[13px] font-medium leading-snug text-ink-3">{note}</span>}
      {hint && <span className="col-span-2 col-start-2 text-[13px] font-medium leading-snug text-ink-3 short:hidden">{hint}</span>}
    </div>
  )
}

/** Шапка списка мер: подписи колонок, как у ленты раундов */
export function MeasuresHead() {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-between gap-3 pb-1 t-caps text-ink-3" aria-hidden>
      <span>{t.defense.measuresCaps}</span><span title={t.defense.priceTitle}>{t.defense.priceCaps}</span>
    </div>
  )
}

/** Тихая кнопка нового раунда: ИИ-мошенник ищет обход включённой модели (раунд попадает в ленту «Дыры») */
export function AiVsModel({ onAi }: { onAi: () => void }) {
  const { t } = useLang()
  return (
    <div>
      <button type="button" className="ctl ctl-quiet !h-11 !gap-2 !px-4 !font-medium" onClick={onAi} data-ai-model>
        {t.defense.aiModel}
      </button>
      <p className="t-caption mt-1.5 text-ink-3">{t.defense.aiModelTitle}</p>
    </div>
  )
}

/** Шире 1024 px поле 10 000 точек уходит под сцену (как карта поиска на «Дыре»), на телефоне остаётся в рабочей плите */
export function useDesk() {
  const q = '(min-width: 1024px)'
  const [desk, setDesk] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setDesk(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return desk
}
