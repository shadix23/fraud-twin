import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { spring } from './motion'
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

const INK = '#0E0E11', LEAK_DOT = '#F0564A', TRACK = '#DEDBEA', INK3 = '#66666F', MUTE_DOT = '#8E8E97', ORANGE = '#EE9A3A'
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

// Фазы усиленного поиска (data.ts, Redteam.search): поколение 0 - стартовая популяция с посевом из банка атак, дальше эволюция
// первого запуска, gen >= search.gens - улучшения от других запусков и доводки. Старые прогоны без search: посев и эволюция
export type Phase = 'seed' | 'evo' | 'tail'
export function phaseOf(h: RedteamTry, d: Redteam): Phase {
  if (h.gen === 0) return 'seed'
  const g = d.search?.gens
  return g != null && h.gen >= g ? 'tail' : 'evo'
}
export const phaseText = (h: RedteamTry, d: Redteam, t: Dict) => {
  const p = phaseOf(h, d)
  return p === 'evo' ? t.gap.gen(h.gen + 1) : t.gap.phases[p]
}

/** Равномерная выборка попыток для мини-карт (вход, «Как устроено»): все фазы в своей доле, порядок сохраняется */
export function sampleTries<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs
  return Array.from({ length: n }, (_, k) => xs[Math.floor(((k + 0.5) / n) * xs.length)])
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

// Карта поиска: X порядковый номер записанной попытки по всем фазам (посев, эволюция, доводка), Y доля выведенного 0-100%,
// пунктир - схема из библиотеки. Короткие фазы (посев 20-30 попыток, доводка 1-5) получают не меньше 8% ширины, иначе их не видно
// Вау 1: нижняя плита шага «Дыра» держит две карты, переключатель в её шапке. Одна плита, одна высота: сцена над ней не прыгает
export type MapTab = 'search' | 'tradeoff'
export function MapTabs({ tab, onTab }: { tab: MapTab; onTab: (t: MapTab) => void }) {
  const { t } = useLang()
  return (
    <ToggleGroup value={[tab]} onValueChange={(v) => v[0] && onTab(v[0] as MapTab)} aria-label={t.gap.tabsAria} className="seg seg-light w-max" data-map-tabs>
      {(['search', 'tradeoff'] as const).map((k) => (
        <Toggle key={k} value={k} className="seg-item" data-map-tab={k}>
          {tab === k && <motion.span layoutId="seg-map" transition={spring.ui} className="seg-on" aria-hidden />}
          <span className="relative">{k === 'search' ? t.gap.caps : t.tradeoff.caps}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

// v23 (макет 02-hole): большая плита справа. Y фиксирован 0-100%, сетка 100/50/0, посев серым, эволюция и доводка оранжевым,
// лучшая попытка с ореолом и подписью, пунктир схемы из библиотеки с подписью слева, подпись прогона под картой
export function SearchMap({ s, meta, onRetry, head, enter = 'in-r' }: { s: MapState; meta: RuleMeta[]; onRetry: () => void; head?: ReactNode; enter?: string }) {
  const { t, lang } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ W: 800, H: 300 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [hover, setHover] = useState<number | null>(null)   // номер попытки под курсором или фокусом
  const d = s.data
  const shown = d ? d.history.slice(0, s.n) : []
  const done = !!d && !s.searching
  const best = done ? bestTry(d.history) : null
  // точки, которые появляются вместе (готовый прогон, повтор шага), идут волной; живой поиск растит их сам
  const stagger = useMemo(() => !s.searching && !reduced(), [d]) // eslint-disable-line react-hooks/exhaustive-deps

  const { W, H } = size
  const small = W < 560
  const rSeed = small ? 2.4 : 3.2, rEvo = small ? 3 : 4
  const x0 = 12, x1 = W - (small ? 16 : 34), y0 = small ? 26 : 34, y1 = H - 6
  const total = d?.history.length ?? 200
  // доля ширины для каждой попытки: фазы идут подряд, внутри фазы попытки равномерно
  const lay = useMemo(() => {
    const at = new Map<number, number>()
    if (!d || !d.history.length) return at
    const runs: { p: Phase; xs: RedteamTry[] }[] = []
    for (const h of d.history) {
      const p = phaseOf(h, d)
      if (runs.at(-1)?.p === p) runs.at(-1)!.xs.push(h); else runs.push({ p, xs: [h] })
    }
    const N = d.history.length, MIN = runs.length > 1 ? 0.08 : 0
    const share = runs.map((r) => (r.p === 'evo' ? r.xs.length / N : Math.max(MIN, r.xs.length / N)))
    const sum = share.reduce((a, b) => a + b, 0)
    let from = 0
    runs.forEach((r, k) => {
      const w = share[k] / sum
      r.xs.forEach((h, j) => at.set(h.i, from + ((j + 0.5) / r.xs.length) * w))
      from += w
    })
    return at
  }, [d])
  const fx = (f: number) => x0 + f * (x1 - x0)
  const x = (i: number) => fx(lay.get(i) ?? 0)
  const y = (p: number) => y1 - (Math.min(100, Math.max(0, p)) / 100) * (y1 - y0)

  // прореживание: точек не больше, чем помещается без сплошной полосы; рекорды, доводка и лучшая остаются всегда
  const vis = useMemo(() => {
    const keep = new Set<number>()
    if (!d) return keep
    const cap = Math.max(60, Math.floor((x1 - x0) / 2.6))
    const stride = Math.max(1, Math.ceil(d.history.length / cap))
    let top = d.base.fit
    const b = bestTry(d.history)
    d.history.forEach((h, k) => {
      const rec = h.fit > top
      if (rec) top = h.fit
      if (k % stride === 0 || rec || (b && h.i === b.i) || phaseOf(h, d) === 'tail') keep.add(h.i)
    })
    return keep
  }, [d, x1 - x0]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = hover != null ? shown.find((h) => h.i === hover) ?? null : null
  const tip = (h: RedteamTry) => ({
    head: t.gap.tryTitle(h.i, d ? phaseText(h, d, t) : '') + (best && h.i === best.i ? `. ${t.gap.best}` : ''),
    body: t.gap.tryText(pctText(h.pct, lang), h.rule ? ruleTitle(h.rule, meta, t) : null),
  })

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    if (!shown.length) return
    const rc = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rc.left, py = e.clientY - rc.top
    let k: RedteamTry | null = null, dist = Infinity
    for (const h of shown) { if (!vis.has(h.i)) continue; const q = (x(h.i) - px) ** 2 + ((y(h.pct) - py) * 0.6) ** 2; if (q < dist) { dist = q; k = h } }
    setHover(k && dist < 48 * 48 ? k.i : null)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!shown.length) return
    const last = shown[shown.length - 1].i
    const at = hover ?? best?.i ?? last
    const big = Math.max(20, Math.round(total / 10))
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: big, PageDown: -big }
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
  const bx = best ? x(best.i) : 0, by = best ? y(best.pct) : 0

  return (
    <section className={`plate map-xl ${enter} flex flex-col px-4 pb-4 pt-4 max-lg:order-5 max-lg:mt-5 sm:px-6`} aria-label={t.gap.caps} data-search-map>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {head ? <><h2 className="sr-only">{t.gap.caps}</h2>{head}</> : <h2 className="t-caps text-ink-3">{t.gap.caps}</h2>}
      </div>

      <div ref={box} className="relative mt-4 h-[230px] lg:mt-6 lg:h-auto lg:min-h-0 lg:flex-1">
        {/* сетка 100/50/0: фиксированная шкала, точки не прыгают во время поиска */}
        <svg width={W} height={H} className="absolute inset-0 block overflow-visible" aria-hidden style={{ ['--fd' as string]: stagger ? '1500ms' : '0ms' }}>
          {[100, 50, 0].map((p) => <line key={p} x1={0} x2={W} y1={y(p)} y2={y(p)} stroke="rgba(14,14,17,0.07)" strokeWidth={1} />)}
          <text x={0} y={y(100) - 9} fontSize={12} fill={INK3} className="tabular-nums">100%</text>
          {d && <>
            {/* моушн-бриф 6.2: пунктир библиотеки проводится слева направо, подпись проявляется следом */}
            <line key={`lv${d.evals}`} className="map-level" x1={0} x2={W} y1={level} y2={level} stroke={INK3} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="5 6" />
            <text key={`lt${d.evals}`} style={{ ['--d' as string]: '300ms' }} x={12} y={level - 9} fontSize={13} fontWeight={500} fill="#3F3F46" stroke="#fff" strokeWidth={4} strokeOpacity={0.85}
              strokeLinejoin="round" paintOrder="stroke" className="fade-d tabular-nums" data-map-level>{t.gap.level(pctText(d.base.pct, lang))}</text>
            {/* вспышка лучшей попытки: остальные точки приглушаются на 0,9 с и возвращаются */}
            <g className={best && !reduced() ? 'map-dim' : undefined}>
            {shown.map((h) => {
              if (!vis.has(h.i) || (best && h.i === best.i)) return null
              const seed = phaseOf(h, d) === 'seed'
              return (
                <circle key={h.i} cx={x(h.i)} cy={y(h.pct)} r={seed ? rSeed : rEvo} fill={seed ? MUTE_DOT : ORANGE} fillOpacity={seed ? 0.45 : 0.85}
                  className={stagger || s.searching ? 'dot-in' : undefined} style={stagger ? { animationDelay: `${Math.round((lay.get(h.i) ?? 0) * 1400)}ms` } : undefined} />
              )
            })}
            </g>
            {best && (
              // пик экрана: лучшая точка растёт из обычной (4 -> 11, x2,75), ореол, одна волна, подпись через 200 мс
              <g key={`${best.i}-${d.evals}`} className="flash" data-map-best={best.i}>
                <circle className="best-wave" cx={bx} cy={by} r={small ? 18 : 26} fill="none" stroke={ORANGE} strokeWidth={2} />
                <circle className="best-halo" cx={bx} cy={by} r={small ? 18 : 26} fill="#F5BE62" fillOpacity={0.28} />
                <circle className="best-dot" cx={bx} cy={by} r={small ? 8 : 11} fill={ORANGE} stroke="#fff" strokeWidth={3} />
                <text x={bx < 70 ? bx + (small ? 22 : 32) : Math.min(W, bx)} y={bx < 70 ? by + 7 : by - (small ? 20 : 26)} textAnchor={bx < 70 ? 'start' : bx > W - 34 ? 'end' : 'middle'}
                  fontSize={small ? 17 : 22} fontWeight={600} fill="#C7731C" className="best-lbl tabular-nums">{pctText(best.pct, lang)}%</text>
              </g>
            )}
            {cur && <circle cx={x(cur.i)} cy={y(cur.pct)} r={rEvo + 4} fill="none" stroke={INK} strokeWidth={1.5} />}
          </>}
          {!d && !s.error && Array.from({ length: 50 }, (_, k) => <circle key={k} cx={fx(k / 49)} cy={y1} r={rSeed} fill={TRACK} />)}
        </svg>
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
      <p className="mt-4 text-[14px] leading-snug text-ink-3 tabular-nums lg:mt-6" data-map-caption aria-live="off">
        {!d ? (s.error ? '' : t.gap.wait) : s.searching ? t.gap.running(shown.at(-1)?.i ?? 0, total) : t.gap.caption(d.evals, num(d.seconds, lang))}
      </p>
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

// Что поменял мошенник (макет 02-hole): без плиты, две строки «название / было -> стало», остальное раскрывается плитой поверх карты
export function Changes({ data, searching }: { data: Redteam | null; searching: boolean }) {
  const { t, lang } = useLang()
  const b = data?.best
  const top = b?.diff.slice(0, 2) ?? []
  const rest = b?.diff.slice(2) ?? []
  const bt = data && !searching ? bestTry(data.history) : null
  return (
    <section aria-labelledby="changes-h" className="relative min-w-0" data-changes>
      <div className="flex items-baseline gap-4">
        <h2 id="changes-h" className="text-[16px] font-semibold leading-tight tracking-[-0.01em]" title={bt ? t.gap.tryTitle(bt.i, phaseText(bt, data!, t)) : undefined} data-changes-try={bt?.i}>{t.gap.changes}</h2>
        {data && !searching && (rest.length > 0 || (b?.hints.length ?? 0) > 0) && (
          // раскрытие плитой поверх карты: экран 900 px не растёт, кнопка шага остаётся на месте
          <details className="group">
            <summary className="-my-1.5 inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-lg text-[14px] font-medium text-brand hover:text-ink [&::-webkit-details-marker]:hidden" title={t.gap.more(rest.length)} data-changes-more>
              {t.v22.changesMore(rest.length)}<ChevronDown size={15} strokeWidth={1.75} className="transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] group-open:rotate-180" aria-hidden />
            </summary>
            <div className="reveal-in plate-float !bg-white/[0.97] absolute bottom-[calc(100%+12px)] left-[-20px] z-30 w-[min(460px,calc(100vw-40px))] space-y-2 px-5 py-4">
              {rest.length > 0 && (
                <ul className="space-y-1.5 text-[15px]">
                  {rest.map((d) => (
                    <li key={d.param} className="flex flex-wrap justify-between gap-x-3">
                      <span className="text-ink-3">{paramTitle(d, t)}</span>
                      <span className="font-medium">{diffValue(d.from, d.param, t, lang)} → {diffValue(d.to, d.param, t, lang)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {b?.hints.map((h) => <p key={h} className="text-[15px] leading-snug text-ink-2">{h}</p>)}
            </div>
          </details>
        )}
      </div>
      {!data || searching ? (
        <p className="mt-3 text-[15px] text-ink-3">{t.gap.changesWait}</p>
      ) : (
        <>
          <ul className="mt-[12px] space-y-[8px]">
            {top.map((d, k) => (
              <li key={d.param} className="min-w-0" style={{ ['--d' as string]: `${500 + k * 120}ms` }}>
                <span className="block text-[13px] leading-tight text-ink-3">{paramTitle(d, t)}</span>
                <span className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-2.5 text-[19px] min-[1400px]:flex-nowrap min-[1400px]:whitespace-nowrap font-medium leading-tight tracking-[-0.01em]">
                  <span className="strike text-ink-mute">{diffValue(d.from, d.param, t, lang)}</span>
                  <ArrowRight size={17} strokeWidth={2} className="chg-in shrink-0" aria-label={t.gap.became} role="img" />
                  <span className="chg-in text-ink">{diffValue(d.to, d.param, t, lang)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
