import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import NumberFlow from '@number-flow/react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import type { Redteam, RedteamTry, RuleMeta } from './data'
import { useLang, type Dict, type Lang } from './i18n'
import { kzt, num } from './format'

// Шаг «Дыра» (бриф v20, F4): карта поиска, плита «Что поменял мошенник», процент на плитке.
// Одна точка = одна попытка ИИ-мошенника. Серая - не лучше схемы из библиотеки, коралл - лучше. Шести цветов по правилам нет:
// какое правило поймало попытку, видно по наведению и по чипам «кто ловил».

const INK = '#0E0E11', LEAK_DOT = '#F0564A', NEUTRAL = '#BDB9D2', TRACK = '#DEDBEA', INK3 = '#66666F'
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Лучшая попытка: первая с наибольшей приспособленностью (так её выбирает поиск, best = эта попытка) */
export function bestTry(h: RedteamTry[]): RedteamTry | null {
  let b: RedteamTry | null = null
  for (const x of h) if (!b || x.fit > b.fit) b = x
  return b
}

/** Доля ушедшего у лучшей на сейчас попытки: та же логика, что у итогового best, поэтому число не прыгает в конце */
// v21: лучшая по деньгам попытка не всегда лучшая по доле (посев даёт 93,1%, доводка 94,1%), и плитка прыгала через «профильное» число.
// Теперь доля растёт от схемы из библиотеки к итогу пропорционально найденным деньгам и в конце равна best.pct
export function runningPct(d: Redteam, n: number): number {
  let fit = d.base.fit
  for (const x of d.history.slice(0, n)) if (x.fit > fit) fit = x.fit
  if (n >= d.history.length) return d.best.pct
  const span = d.best.fit - d.base.fit
  const k = span > 0 ? Math.min(1, Math.max(0, (fit - d.base.fit) / span)) : 1
  return d.base.pct + (d.best.pct - d.base.pct) * k
}

const pctText = (v: number, lang: Lang) => (Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : num(v, lang))
const ruleTitle = (key: string, meta: RuleMeta[], t: Dict) => t.rules.names[key] ?? meta.find((m) => m.key === key)?.title ?? key

/** Маркер лучшей попытки: один и тот же у точки на карте и у заголовка плиты изменений */
export function BestMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <circle cx={7} cy={7} r={5.5} fill={LEAK_DOT} stroke={INK} strokeWidth={2} />
    </svg>
  )
}

/** Процент на плитке «Дыры» через NumberFlow, как остальные числа */
export function Pct({ v }: { v: number }) {
  const { lang } = useLang()
  const r = Math.round(v * 10) / 10
  const whole = r === 100 || r === 0 // «100%», а не «100,0%»: как в строке раунда и на карте
  return (
    <NumberFlow value={r} locales={lang === 'en' ? 'en-US' : 'ru-RU'} suffix="%"
      format={{ minimumFractionDigits: whole ? 0 : 1, maximumFractionDigits: 1 }}
      transformTiming={{ duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' }} spinTiming={{ duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' }} />
  )
}

export interface MapState { data: Redteam | null; n: number; searching: boolean; error: string | null }

// Карта поиска: X попытка 1-200 с отметками поколений, Y доля выведенного 0-100%, пунктир - схема из библиотеки
// Вау 1: нижняя плита шага «Дыра» держит две карты, переключатель в её шапке. Одна плита, одна высота: сцена над ней не прыгает
export type MapTab = 'search' | 'tradeoff'
export function MapTabs({ tab, onTab }: { tab: MapTab; onTab: (t: MapTab) => void }) {
  const { t } = useLang()
  return (
    <ToggleGroup value={[tab]} onValueChange={(v) => v[0] && onTab(v[0] as MapTab)} aria-label={t.gap.tabsAria} className="seg seg-in w-max" data-map-tabs>
      {(['search', 'tradeoff'] as const).map((k) => (
        <Toggle key={k} value={k} className="seg-item" data-map-tab={k}>
          {tab === k && <span className="seg-on" />}
          <span className="relative">{k === 'search' ? t.gap.caps : t.tradeoff.caps}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export function SearchMap({ s, meta, onRetry, head }: { s: MapState; meta: RuleMeta[]; onRetry: () => void; head?: ReactNode }) {
  const { t, lang } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ W: 800, H: 150 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [hover, setHover] = useState<number | null>(null)   // номер попытки под курсором или фокусом
  const [pin, setPin] = useState<string | null>(null)       // чип «кто ловил»: наведение или нажатие обводит его точки
  const d = s.data
  const shown = d ? d.history.slice(0, s.n) : []
  const done = !!d && !s.searching
  const best = done ? bestTry(d.history) : null
  // точки, которые появляются вместе (готовый прогон, повтор шага), идут волной 8 мс на точку; живой поиск растит их сам
  const stagger = useMemo(() => !s.searching && !reduced(), [d]) // eslint-disable-line react-hooks/exhaustive-deps

  const { W, H } = size
  const small = W < 560
  const r = small ? 2 : 3
  const x0 = r + 6, x1 = W - r - 6, y0 = 24, y1 = H - 24
  const total = d?.evals ?? 200
  // Y по всему прогону сразу (не по уже показанным точкам), чтобы шкала не прыгала во время поиска; шаг 10%
  const [lo, hi] = useMemo(() => {
    if (!d) return [0, 100]
    let a = d.base.pct, b = d.base.pct
    for (const h of d.history) { a = Math.min(a, h.pct); b = Math.max(b, h.pct) }
    let l = Math.max(0, Math.floor((a - 2) / 10) * 10), u = Math.min(100, Math.ceil((b + 2) / 10) * 10)
    if (u - l < 30) { l = Math.max(0, u - 30); u = Math.max(u, l + 30) }
    return [l, u]
  }, [d])
  const x = (i: number) => x0 + ((i - 1) / Math.max(1, total - 1)) * (x1 - x0)
  const y = (p: number) => y1 - ((Math.min(hi, Math.max(lo, p)) - lo) / (hi - lo)) * (y1 - y0)

  // поколения: тонкая отметка на границе, номер под серединой
  const gens = useMemo(() => {
    if (!d) return []
    const g = new Map<number, { a: number; b: number }>()
    for (const h of d.history) { const v = g.get(h.gen); g.set(h.gen, v ? { a: Math.min(v.a, h.i), b: Math.max(v.b, h.i) } : { a: h.i, b: h.i }) }
    return [...g.entries()].sort((p, q) => p[0] - q[0]).map(([gen, v]) => ({ n: gen + 1, ...v }))
  }, [d])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const h of shown) c.set(h.rule || '', (c.get(h.rule || '') ?? 0) + 1)
    return [...c.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1])
  }, [d, s.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = hover != null ? shown.find((h) => h.i === hover) ?? null : null
  const tip = (h: RedteamTry) => ({
    head: t.gap.tryTitle(h.i, h.gen + 1) + (best && h.i === best.i ? `. ${t.gap.best}` : ''),
    body: t.gap.tryText(pctText(h.pct, lang), h.rule ? ruleTitle(h.rule, meta, t) : null),
  })

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    if (!shown.length) return
    const rc = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rc.left, py = e.clientY - rc.top
    let k: RedteamTry | null = null, dist = Infinity
    for (const h of shown) { const q = (x(h.i) - px) ** 2 + ((y(h.pct) - py) * 0.6) ** 2; if (q < dist) { dist = q; k = h } }
    setHover(k && dist < 48 * 48 ? k.i : null)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!shown.length) return
    const last = shown[shown.length - 1].i
    const at = hover ?? best?.i ?? last
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 20, PageDown: -20 }
    let next: number | null = null
    if (e.key in step) next = at + step[e.key]
    else if (e.key === 'Home') next = 1
    else if (e.key === 'End') next = last
    else if (e.key === 'Escape') { setHover(null); return }
    if (next == null) return
    e.preventDefault(); e.stopPropagation()
    setHover(Math.min(last, Math.max(1, next)))
  }

  const level = d ? y(d.base.pct) : 0
  const tipPos = cur ? { left: Math.min(W - 8, Math.max(8, x(cur.i))), top: y(cur.pct) } : null
  const above = tipPos ? tipPos.top > 70 : true

  return (
    <section className="plate flex shrink-0 flex-col px-4 pb-3 pt-3.5 sm:px-5 lg:h-[240px] lg:px-6 short:h-[200px] short:pb-2.5 short:pt-3" aria-label={t.gap.caps} data-search-map>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {head ? <><h2 className="sr-only">{t.gap.caps}</h2>{head}</> : <h2 className="t-caps text-ink-3">{t.gap.caps}</h2>}
        {d && (
          // уровень схемы из библиотеки подписан здесь, а не на линии: на линии подпись закрывала бы точки
          <p className="t-caption flex items-center gap-2 text-ink-2 tabular-nums" data-map-level>
            <svg width="20" height="2" aria-hidden className="shrink-0"><line x1="0" x2="20" y1="1" y2="1" stroke={INK3} strokeWidth="1" strokeDasharray="3 3" /></svg>
            {t.gap.level(pctText(d.base.pct, lang))}
          </p>
        )}
        <p className="t-caption text-ink-3 tabular-nums sm:ml-auto" data-map-caption>
          {!d ? (s.error ? '' : t.gap.wait) : s.searching ? t.gap.running(shown.at(-1)?.i ?? 0, d.evals) : t.gap.caption(d.evals, num(d.seconds, lang))}
        </p>
      </div>

      <div ref={box} className="relative mt-1.5 h-[180px] lg:h-auto lg:min-h-0 lg:flex-1">
        {d && (
          <svg width={W} height={H} className="absolute inset-0 block overflow-visible" aria-hidden>
            {gens.slice(1).map((g) => {
              const gx = (x(g.a - 1) + x(g.a)) / 2
              return <line key={g.n} x1={gx} x2={gx} y1={y1 + 3} y2={y1 + 8} stroke={NEUTRAL} strokeWidth={1} />
            })}
            {gens.map((g) => (
              <text key={g.n} x={(x(g.a) + x(g.b)) / 2} y={H - 3} textAnchor="middle" fontSize={13} fontWeight={500} fill={INK3}>{g.n}</text>
            ))}
            <line x1={x0} x2={x1} y1={level} y2={level} stroke={INK3} strokeWidth={1} strokeDasharray="3 5" />
            {shown.map((h) => {
              const up = h.pct > d.base.pct + 1e-9
              const ring = pin != null && (h.rule || '') === pin
              return (
                <circle key={h.i} cx={x(h.i)} cy={y(h.pct)} r={r} fill={up ? LEAK_DOT : NEUTRAL}
                  stroke={ring ? INK : undefined} strokeWidth={ring ? 1.5 : undefined}
                  className={stagger || s.searching ? 'dot-in' : undefined} style={stagger ? { animationDelay: `${(h.i - 1) * 8}ms` } : undefined} />
              )
            })}
            {best && (
              <g data-map-best={best.i}>
                <circle cx={x(best.i)} cy={y(best.pct)} r={6} fill={LEAK_DOT} stroke={INK} strokeWidth={2} />
                <text x={Math.min(x1, Math.max(x0 + 40, x(best.i)))} y={y(best.pct) - 13} textAnchor={x(best.i) > x1 - 40 ? 'end' : 'middle'}
                  fontSize={15} fontWeight={600} fill="#D4372A" stroke="#fff" strokeWidth={4} paintOrder="stroke">{pctText(best.pct, lang)}%</text>
              </g>
            )}
            {cur && <circle cx={x(cur.i)} cy={y(cur.pct)} r={r + 4} fill="none" stroke={INK} strokeWidth={1.5} />}
          </svg>
        )}
        {!d && !s.error && (
          <svg width={W} height={H} className="absolute inset-0 block" aria-hidden>
            {/* ожидание ответа: пустые точки вдоль дна, по одной на будущую попытку */}
            {Array.from({ length: 50 }, (_, k) => <circle key={k} cx={x(1 + k * 4)} cy={y1} r={r} fill={TRACK} />)}
          </svg>
        )}
        {s.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
            <p className="text-[16px] font-medium text-leak">{t.gap.error(s.error)}</p>
            <button className="ctl ctl-quiet !h-10 !px-4" onClick={onRetry}>{t.gap.retry}</button>
          </div>
        )}
        {d && (
          // одна клавиатурная остановка на всю карту: стрелки идут по попыткам, PageUp/PageDown по поколениям
          <div className="absolute inset-0 touch-pan-y rounded-xl" role="slider" tabIndex={0} aria-label={t.gap.aria}
            aria-valuemin={1} aria-valuemax={total} aria-valuenow={cur?.i ?? best?.i ?? shown.at(-1)?.i ?? 1}
            aria-valuetext={cur ? `${tip(cur).head}. ${tip(cur).body}` : best ? `${tip(best).head}. ${tip(best).body}` : t.gap.running(shown.at(-1)?.i ?? 0, total)}
            onPointerMove={(e) => { if (e.pointerType === 'mouse') pick(e) }} onPointerDown={pick}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null) }}
            onKeyDown={onKey} onFocus={() => setHover((h) => h ?? best?.i ?? shown.at(-1)?.i ?? null)} onBlur={() => setHover(null)} />
        )}
        {cur && tipPos && (
          <div className="pointer-events-none absolute z-10 w-max max-w-[min(300px,calc(100%-16px))] rounded-2xl bg-ink px-3.5 py-2.5 text-white shadow-[0_8px_24px_-8px_rgba(14,14,17,0.35)]"
            style={{ left: tipPos.left, top: tipPos.top, transform: `translate(${tipPos.left < 150 ? '-8%' : tipPos.left > W - 150 ? '-92%' : '-50%'}, ${above ? 'calc(-100% - 14px)' : '14px'})` }}
            data-map-tip>
            <p className="text-[15px] font-semibold leading-tight tabular-nums">{tip(cur).head}</p>
            <p className="mt-0.5 text-[15px] leading-snug text-white/85 tabular-nums">{tip(cur).body}</p>
          </div>
        )}
      </div>

      {counts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 lg:flex-nowrap lg:overflow-x-auto short:mt-1.5" data-map-rules>
          <span className="t-caption shrink-0 text-ink-3">{t.gap.who}</span>
          {counts.map(([k, c]) => (
            <button key={k} type="button" className={`chip !h-8 shrink-0 tabular-nums ${pin === k ? '!bg-surface !shadow-[inset_0_0_0_1.5px_var(--color-ink)]' : ''}`}
              aria-pressed={pin === k} aria-label={t.gap.chipAria(ruleTitle(k, meta, t), c)}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPin(k) }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPin((p) => (p === k ? null : p)) }}
              onFocus={() => setPin(k)} onBlur={() => setPin((p) => (p === k ? null : p))}
              onClick={() => setPin((p) => (p === k ? null : k))}>
              {ruleTitle(k, meta, t)}<span className="text-ink-3">{c}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// Значение параметра схемы по языку: «частями по 579 тыс. ₸», «4 мин», «1,2 млн ₸»
function diffValue(v: string | number, param: string, t: Dict, lang: Lang) {
  if (param === 'victim_chunk_max' && typeof v === 'number') return v >= 10_000_000 ? t.gap.oneShot : t.gap.parts(kzt(v, lang))
  // единица уже в названии параметра («пауза дропа, мин»), поэтому здесь только число
  if (param.endsWith('_min') && typeof v === 'number') return String(Math.round(v))
  if (typeof v === 'number') return v >= 10_000 ? kzt(v, lang) : num(v, lang, Number.isInteger(v) ? 0 : 1)
  return v
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const paramTitle = (d: { param: string; title: string }, t: Dict) => (d.param === 'victim_chunk_max' ? t.gap.victimPay : cap(d.title))

// Что поменял мошенник: три строки было -> стало у лучшей попытки, остальное под «ещё». Маркер тот же, что у точки на карте
export function Changes({ data, searching }: { data: Redteam | null; searching: boolean }) {
  const { t, lang } = useLang()
  const b = data?.best
  const top = b?.diff.slice(0, 3) ?? []
  const rest = b?.diff.slice(3) ?? []
  const bt = data && !searching ? bestTry(data.history) : null
  return (
    <section aria-labelledby="changes-h" data-changes>
      {/* маркер и номер попытки те же, что у лучшей точки на карте: так плита связана с картой */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id="changes-h" className="t-title flex items-center gap-2.5 text-ink">{bt && <BestMark />}{t.gap.changes}</h2>
        {bt && <span className="t-caption shrink-0 text-ink-3 tabular-nums" title={t.gap.tryTitle(bt.i, bt.gen + 1)} data-changes-try={bt.i}>{t.gap.tryShort(bt.i)}</span>}
      </div>
      {!data || searching ? (
        <p className="mt-2 text-[16px] text-ink-2">{t.gap.changesWait}</p>
      ) : (
        <>
          <ul className="@container mt-2">
            {top.map((d, k) => (
              <li key={d.param} className={`${k === 2 ? 'short:hidden ' : ''}flex flex-col gap-0.5 py-1.5 short:py-1 @xs:flex-row @xs:items-baseline @xs:justify-between @xs:gap-x-3`}>
                <span className="min-w-0 text-[16px] text-ink-2 @xs:shrink-0">{paramTitle(d, t)}</span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 @xs:justify-end @xs:text-right">
                  <span className="text-[15px] text-ink-3 line-through decoration-1">{diffValue(d.from, d.param, t, lang)}</span>
                  <ArrowRight size={14} strokeWidth={2} className="translate-y-[1px] self-center text-ink-3" aria-label={t.gap.became} role="img" />
                  <span className="text-[17px] font-semibold leading-tight tracking-[-0.015em] text-leak">{diffValue(d.to, d.param, t, lang)}</span>
                </span>
              </li>
            ))}
          </ul>
          {(rest.length > 0 || (b?.hints.length ?? 0) > 0) && (
            // на низком экране (1280x720) плита держит две строки изменений и два раунда без прокрутки, подробности в отчёте
            <details className="group mt-1 short:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-medium text-ink-2 hover:text-ink short:min-h-9 [&::-webkit-details-marker]:hidden">
                <ChevronDown size={18} strokeWidth={1.5} className="transition-transform duration-150 group-open:rotate-180" aria-hidden />{t.gap.more(rest.length)}
              </summary>
              <div className="space-y-2 pb-2">
                {rest.length > 0 && (
                  <ul className="space-y-1 text-[16px]">
                    {rest.map((d) => (
                      <li key={d.param} className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-ink-2">{paramTitle(d, t)}</span>
                        <span>{diffValue(d.from, d.param, t, lang)} → {diffValue(d.to, d.param, t, lang)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {b?.hints.map((h) => <p key={h} className="text-[16px] leading-snug text-ink-2">{h}</p>)}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}
