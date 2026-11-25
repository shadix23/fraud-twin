import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
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
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="panel-title">{t.v22.fieldTitle}</h3>
          <p className="whitespace-nowrap text-[15px] tabular-nums text-ink-3" data-field-count>
            <b className="mr-1.5 text-[19px] font-semibold tracking-[-0.02em] text-warn">{intl(n, lang)}</b>{t.defense.fieldOf}
          </p>
        </div>
        <button type="button" className="link-btn !text-[14px] !font-medium" onClick={onFeed} data-feed-open>
          {t.defense.feed}<ArrowRight size={15} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div ref={wrap} className="mt-3">
        <canvas ref={cvs} role="img" aria-label={t.defense.fieldAria(intl(n, lang))} style={{ width: cols * STEP, height: rows * STEP }} className="block" />
      </div>
      <p className="t-caption mt-2 text-ink-3 lg:sr-only">{t.defense.fieldCaption}</p>
    </section>
  )
}

/** Мера: свой тумблер, имя, цена для честных справа (на сколько задержек на 10 тыс. больше), пометка второй строкой */
export function MeasureRow({ on, set, name, note, hint, price, hotkey, locked, big }: {
  on: boolean; set: (v: boolean) => void; name: string; note?: string; hint?: string; price: number | null; hotkey: string; locked?: boolean; big?: boolean
}) {
  const { t, lang } = useLang()
  const sign = price == null ? '' : price < 0 ? '−' : '+'
  const p = price == null ? '' : `${sign}${num(Math.abs(price), lang)}`
  // v23 (макет 03-defense): крупная строка, тумблер 56x32 в зелёном тоне, цена 34 px справа (включена - зелёная, выключена - серая)
  if (big) return (
    <div data-measure className={`measure-lg grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 lg:gap-x-6 ${locked ? '' : 'cursor-pointer'}`}
      onClick={(e) => { if (!locked && !(e.target as HTMLElement).closest('[role=switch]')) set(!on) }}>
      <button type="button" role="switch" aria-checked={on} aria-label={t.defense.switchAria(name)} aria-keyshortcuts={hotkey} disabled={locked}
        className="switch-lg disabled:opacity-70" onClick={() => set(!on)} />
      <span className="min-w-0">
        <span className={`block text-[22px] font-semibold leading-tight tracking-[-0.4px] max-lg:text-[17px] ${on ? 'text-ink' : 'text-ink-3'}`}>{name}</span>
        {(hint || note) && <span className="mt-1 block text-[15px] leading-snug text-ink-3 max-lg:text-[14px]">{hint ?? note}</span>}
        {hint && note && <span className="mt-0.5 block text-[15px] leading-snug text-ink-3">{note}</span>}
      </span>
      <span className={`text-right text-[34px] font-medium leading-none tracking-[-1.2px] tabular-nums max-lg:text-[22px] max-lg:tracking-[-0.5px] ${on ? 'text-stop' : 'text-ink-mute'}`} title={t.defense.priceTitle} aria-label={price != null ? t.defense.priceAria(p) : undefined}>
        {p}
      </span>
    </div>
  )
  return (
    <div data-measure className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3.5 py-2 ${locked ? '' : 'cursor-pointer'}`}
      onClick={(e) => { if (!locked && !(e.target as HTMLElement).closest('[role=switch]')) set(!on) }}>
      <button type="button" role="switch" aria-checked={on} aria-label={t.defense.switchAria(name)} aria-keyshortcuts={hotkey} disabled={locked}
        className="switch mt-px disabled:opacity-60" onClick={() => set(!on)} />
      <span className={`min-w-0 text-[15px] leading-[22px] tracking-[-0.01em] ${on ? 'font-semibold text-ink' : 'text-ink-2'}`}>{name}</span>
      <span className={`text-right text-[15px] font-semibold leading-[22px] tabular-nums ${price != null && price < 5 ? 'text-stop' : 'text-warn' /* v22: малая цена (до 5 на 10 тыс.) зелёным, как в макете */}`} title={t.defense.priceTitle} aria-label={price != null ? t.defense.priceAria(p) : undefined}>
        {p}
      </span>
      {/* пометка во всю ширину под именем и ценой: «сценарий, в РК для переводов не действует» на 375 px не ломается в три строки */}
      {note && <span className="col-span-2 col-start-2 text-[13.5px] leading-snug text-ink-3">{note}</span>}
      {hint && <span className="col-span-2 col-start-2 text-[13.5px] leading-snug text-ink-3">{hint}</span>}
    </div>
  )
}

/** Шапка списка мер: подписи колонок, как у ленты раундов */
export function MeasuresHead({ big }: { big?: boolean }) {
  const { t } = useLang()
  return (
    <div className={`flex items-baseline justify-between gap-3 ${big ? 'pb-2.5 short:pb-0' : 'pb-2'}`}>
      <h2 className={big ? 'plate-title' : 'panel-title'}>{t.v22.measures}</h2>
      <span className="text-right text-[14px] text-ink-mute" title={t.defense.priceTitle} aria-hidden>{big ? <><span className="max-lg:hidden">{t.v22.priceHeadLong}</span><span className="lg:hidden">{t.v22.priceHead}</span></> : t.v22.priceHead}</span>
    </div>
  )
}

// поле честных переводов на плите (макет 03-defense): 1 000 точек, точка = 10 переводов, задержанные зелёным с ореолом.
// Шаг сетки подбирается под плиту, порядок окрашивания постоянный: новые задержанные добавляются, старые остаются
const DOTS = 1000
let DOT_RANK: number[] | null = null
function dotRank() {
  if (DOT_RANK) return DOT_RANK
  let a = 11
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const order = Array.from({ length: DOTS }, (_, i) => i)
  for (let i = DOTS - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  DOT_RANK = order
  return order
}
export function HonestPlate({ per10k, onFeed, className = '' }: { per10k: number; onFeed: () => void; className?: string }) {
  const { t, lang } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [sz, setSz] = useState({ w: 400, h: 200 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSz({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const step = Math.max(6, Math.min(12, Math.sqrt((sz.w * Math.max(sz.h, 60)) / DOTS)))
  const cols = Math.max(10, Math.floor(sz.w / step))
  const rows = Math.ceil(DOTS / cols)
  const green = per10k > 0 ? Math.min(DOTS, Math.ceil(per10k / 10)) : 0
  const rank = dotRank()
  const on = new Set(rank.slice(0, green))
  const r = Math.max(1.8, step * 0.3)
  const v = num(per10k, lang)
  return (
    <section className={`plate flex flex-col ${className}`} data-honest-field aria-label={t.defense.fieldCaps}>
      <h3 className="plate-title">{t.v22.fieldTitle}</h3>
      <p className="mt-1.5 text-[15px] tabular-nums text-ink-3" data-field-count>{t.v22.heldOf(v)}</p>
      <div ref={box} className="relative mt-4 min-h-[120px] flex-1">
        <svg width={cols * step} height={rows * step} className="absolute left-0 top-0 block max-h-full" role="img" aria-label={t.defense.fieldAria(v)}>
          {Array.from({ length: DOTS }, (_, i) => on.has(i) ? null : <circle key={i} cx={(i % cols) * step + step / 2} cy={Math.floor(i / cols) * step + step / 2} r={r} fill="#8E8E97" fillOpacity={0.45} />)}
          {[...on].map((i) => {
            const cx = (i % cols) * step + step / 2, cy = Math.floor(i / cols) * step + step / 2
            return <g key={i} className={reduced() ? undefined : 'dot-in'}><circle cx={cx} cy={cy} r={9} fill="#15803D" fillOpacity={0.18} /><circle cx={cx} cy={cy} r={r + 0.6} fill="#15803D" /></g>
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-[13px] text-ink-mute">{t.v22.dotCaption}</p>
        <button type="button" className="link-btn !min-h-8 !text-[13px] !font-medium" onClick={onFeed} data-feed-open>
          {t.v22.feedLink}<ArrowRight size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </section>
  )
}

/** Тёмная плита «ИИ ищет обход уже нашей модели»: до поиска - приглашение с кнопкой, после - живое число раунда */
export function AiPlate({ result, onRun, busy, className = '' }: { result: { pct: number; withdrawn: string; atLeast: boolean } | null; onRun: () => void; busy?: boolean; className?: string }) {
  const { t, lang } = useLang()
  const V = t.v22
  return (
    <section className={`tile ai-plate flex flex-col text-white ${className}`} data-tone="report" aria-label={`${V.aiTitle[0]} ${V.aiTitle[1]}`} data-ai-plate={result ? 'result' : 'invite'}>
      <span aria-hidden className="tile-bg" data-on="" />
      <span aria-hidden className="tile-sheet tile-sheet-a" />
      <span aria-hidden className="tile-sheet tile-sheet-b" />
      <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.5px] max-lg:text-[20px]">{V.aiTitle[0]}<br />{V.aiTitle[1]}</h2>
      {result ? (
        result.pct > 0.05 ? <>
          {result.atLeast && <p className="mt-auto text-[18px] font-medium text-[#FFB4A8] lg:mt-[clamp(16px,4vh,44px)]">{V.atLeast}</p>}
          <p className={`ai-num ${result.atLeast ? '' : 'mt-auto lg:mt-[clamp(16px,4vh,44px)]'}`} data-ai-pct>{num(result.pct, lang)}%</p>
          <p className="mt-auto max-w-[320px] pt-3 text-[15px] leading-snug text-white/80">{V.aiAgain(result.withdrawn)[0]}<br />{V.aiAgain(result.withdrawn)[1]}</p>
        </> : <p className="mt-auto max-w-[320px] text-[15px] leading-snug text-white/85">{V.aiNone}</p>
      ) : <>
        <p className="mt-auto max-w-[320px] pt-4 text-[15px] leading-snug text-white/80">{V.aiInvite}</p>
        <button type="button" className="ctl mt-5 !h-12 w-max !gap-3 rounded-full bg-white !px-5 text-[15px] font-semibold text-ink hover:bg-white/90 disabled:opacity-60" onClick={onRun} disabled={busy} data-ai-model>
          {V.aiRun}<ArrowRight size={17} strokeWidth={2} aria-hidden />
        </button>
      </>}
    </section>
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
