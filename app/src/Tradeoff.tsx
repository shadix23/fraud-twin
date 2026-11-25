import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import type { Ctx, RuleMeta } from './data'
import { useLang } from './i18n'
import { num } from './format'
import { changeText } from './RulesEditor'
import type { Round } from './Rounds'

// Вау 1 (wow-v21, «Закройте дыру сами»): карта компромисса. Жюри играет за банк, каждый ход - точка:
// по горизонтали «задето честных на 10 тыс.», по вертикали «ушло денег». Пороги уводят точку вправо, а не вниз.
// Модель встаёт отдельной точкой в нижнем левом углу (0 ₸ на уже найденной атаке), раунд «ИИ против модели» поднимает её.
// Только точки, подписи ходов и одна линия пути: без сплайнов и закрашенных зон. Точка = событие, движение одно - подъём модели.

export interface ModelMark { x: number; y: number }
interface Anchors {
  scheme: string; preset: string
  moves: { rules: Record<string, number>; pct: number; honest: number; lower_bound?: boolean }[]
  model: { honest: number; pct: number }
  rematch: { honest: number; pct: number; lower_bound?: boolean }
}
interface Pt { key: string; x: number; y: number; label: string; lb?: boolean; base?: boolean }

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const pctText = (v: number, lang: 'ru' | 'en') => (Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : num(v, lang))
// Ось X логарифмическая: профиль 22,7, лимит 500 тыс. (112) и 300 тыс. (332) на линейной оси слипались у края.
// Границы и засечки по ряду 1-2-5: 10, 20, 50, 100, 200, 500...
// ширина подписи по настоящему шрифту: оценка «знаки x 6,6» завышала и прятала подписи на 375
let pen: CanvasRenderingContext2D | null = null
const textW = (s: string) => {
  if (!pen && typeof document !== 'undefined') {
    pen = document.createElement('canvas').getContext('2d')
    if (pen) pen.font = `500 12px ${getComputedStyle(document.body).fontFamily}`
  }
  return pen ? pen.measureText(s).width : s.length * 6.6
}
const nice = (k: number) => [1, 2, 5].map((m) => m * 10 ** k)
const niceUp = (v: number) => { for (let k = -1; k < 7; k++) for (const x of nice(k)) if (x >= v) return x; return v }
const niceDown = (v: number) => { let best = 0.1; for (let k = -1; k < 7; k++) for (const x of nice(k)) if (x <= v) best = x; return best }

// Опорные точки для показа без сервера: только демо-банк и демо-схема
function useAnchors(scheme: string, ctx: Ctx | null): Anchors | null {
  const [a, setA] = useState<Anchors | null>(null)
  useEffect(() => {
    let alive = true
    if (!ctx || ctx.preset !== 'demo') { setA(null); return }
    fetch(`/scenarios/tradeoff_${scheme}.json`).then((r) => (r.ok ? r.json() as Promise<Anchors> : null)).catch(() => null)
      .then((d) => { if (alive) setA(d) })
    return () => { alive = false }
  }, [scheme, ctx?.preset]) // eslint-disable-line react-hooks/exhaustive-deps
  return a
}

// head: переключатель карт; с ним карта живёт в нижней широкой плите шага «Дыра» (поле слева, итог справа), без него - в отчёте
export function TradeoffMap({ rounds, model, meta, unseen, scheme, ctx, still = false, head }: {
  rounds: Round[]; model: ModelMark | null; meta: RuleMeta[]; unseen: number | null; scheme: string; ctx: Ctx | null; still?: boolean; head?: ReactNode
}) {
  const { t, lang } = useLang()
  const T = t.tradeoff
  const anchors = useAnchors(scheme, ctx)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const on = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    on()
    const ro = new ResizeObserver(on)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // свой ход банка ещё не сделан: можно проиграть готовый пример (три хода, модель, обход модели)
  const own = rounds.some((r) => r.source === 'live' && (r.asked.length > 0 || r.vsModel)) || !!model
  const [demo, setDemo] = useState<number | null>(null)
  useEffect(() => { setDemo(null) }, [rounds.length, model])
  useEffect(() => {
    if (demo == null || !anchors) return
    const total = anchors.moves.length + 2
    if (demo >= total) return
    const id = setTimeout(() => setDemo((d) => (d == null ? d : d + 1)), demo === 0 ? 120 : 1100)
    return () => clearTimeout(id)
  }, [demo, anchors])
  const playDemo = () => { if (anchors) setDemo(reduced() ? anchors.moves.length + 2 : 0) }

  // точки: ходы банка по правилам, точка модели и подъём модели после раунда «ИИ против модели»
  const valueOf = (param: string, to: number | boolean | null) => {
    const s = changeText(meta, param, to, t, lang)
    return s ? s.slice(s.indexOf(': ') + 2) : ''
  }
  let moves: Pt[] = []
  let mark: ModelMark | null = model
  let again: { y: number; x: number; lb?: boolean } | null = null
  // отчёт без своих раундов (открыт сразу по #report): ход проверки по опорным точкам демо-банка, без анимации
  const autoDemo = still && !own && !!anchors && anchors.scheme === scheme
  const showDemo = (demo != null || autoDemo) && anchors
  if (showDemo) {
    const k = autoDemo ? anchors!.moves.length + 2 : demo!
    moves = anchors!.moves.slice(0, Math.min(k, anchors!.moves.length)).map((m, i) => {
      const e = Object.entries(m.rules)
      return { key: `d${i}`, x: m.honest, y: m.pct, lb: m.lower_bound, base: !e.length, label: e.length ? e.map(([p, v]) => valueOf(p, v)).join(', ') : T.profile }
    })
    mark = k > anchors!.moves.length ? { x: anchors!.model.honest, y: anchors!.model.pct } : null
    again = k > anchors!.moves.length + 1 ? { x: anchors!.rematch.honest, y: anchors!.rematch.pct, lb: anchors!.rematch.lower_bound } : null
  } else {
    moves = rounds.filter((r) => !r.vsModel && r.honest != null).map((r) => ({
      key: `r${r.n}`, x: r.honest!, y: r.pct, lb: r.atLeast, base: r.asked.length === 0,
      label: r.asked.length ? r.asked.map((c) => valueOf(c.param, c.to)).filter(Boolean).join(', ') : T.profile,
    }))
    const vm = [...rounds].reverse().find((r) => r.vsModel)
    if (vm) {
      again = { x: vm.honest ?? mark?.x ?? 0, y: vm.pct, lb: vm.atLeast }
      if (!mark) mark = { x: again.x, y: 0 }
    }
  }

  const xs = [...moves.map((p) => p.x), ...(mark ? [mark.x] : []), ...(again ? [again.x] : [])].filter((v) => v > 0)
  let xLo = niceDown(Math.min(10, Math.min(...xs) / 1.25)), xHi = niceUp(Math.max(100, ...xs) * 1.2)
  if (xHi / xLo < 10) xHi = xLo * 10
  const lgLo = Math.log10(xLo), lgSpan = Math.log10(xHi) - lgLo
  // поле графика: слева место под «100%», снизу засечки оси. Подписи осей - строкой рядом с итогом, высота отдана долям
  // на узкой ширине над верхними точками два ряда подписей: ходы банка стоят почти на одной высоте
  const narrow = size.w > 0 && size.w < 480
  const padL = 34, padR = 14, padT = narrow ? 34 : 14, padB = 20
  const W = Math.max(0, size.w - padL - padR), H = Math.max(0, size.h - padT - padB)
  const px = (x: number) => padL + ((Math.log10(Math.min(xHi, Math.max(xLo, x))) - lgLo) / lgSpan) * W
  const xText = (v: number) => (v >= 100 ? num(v, lang, 0) : pctText(v, lang))
  // засечки по 1-2-5; соседние ближе 30 px пропускаем
  const ticks: number[] = []
  for (let k = -1; k < 7; k++) for (const v of nice(k)) if (v >= xLo && v <= xHi && (!ticks.length || px(v) - px(ticks.at(-1)!) >= 30)) ticks.push(v)
  const py = (y: number) => padT + (1 - Math.min(100, Math.max(0, y)) / 100) * H
  const ready = size.w > 0
  const modelY = again ? again.y : mark?.y ?? 0

  // итог под полем: последний ход банка, модель на найденной атаке, обход модели
  const realMoves = moves.filter((p) => !p.base)
  const last = realMoves.at(-1)
  const lines: string[] = []
  if (last) lines.push(T.sumMoves(realMoves.length, pctText(last.y, lang), pctText(last.x, lang), !!last.lb && last.y < 99.95))
  // 2,2% на невиданных схемах - в итоге отчёта; на рабочей плите итог короче
  if (mark) lines.push(T.sumModel(pctText(mark.y, lang), pctText(mark.x, lang), still && unseen != null ? pctText(unseen, lang) : null))
  if (again) lines.push(T.sumAgain(pctText(again.y, lang), !!again.lb && again.y < 99.95))
  const summary = lines.join(' ') || T.wait
  const anim = !still

  // подписи без наложений: ходы банка стоят почти на одной высоте (пороги уводят вправо), модель под профилем.
  // Жадная раскладка: справа, слева, сверху, снизу от точки; ширина подписи оценена по числу знаков
  const lbl = (text: string, x: number, y: number) => ({ text, x: px(x), y: py(y), w: Math.ceil(textW(text)) + 14 })
  const items = [
    ...(mark ? [{ key: 'model', ...lbl(`${again ? T.rematch : T.model} ${again?.lb && again.y < 99.95 ? '≥' : ''}${pctText(modelY, lang)}%`, again?.x ?? mark.x, modelY) }] : []),
    // у ходов банка подпись - только порог: доля видна по оси и в ленте раундов под картой
    // профиль - точка отсчёта, подписан первым; дальше новые ходы раньше старых
    // к подписи хода добавлено «задето» (значение по оси X): шкала логарифмическая, по засечкам число не прочесть
    // на узкой ширине - по порядку ходов: тогда нижний ряд подписей стоит ровно над своими точками, верхний над крайней правой
    ...[...moves.filter((p) => p.base), ...(narrow ? moves : [...moves].reverse()).filter((p) => !p.base)].map((p) => ({ key: p.key, ...lbl(`${p.label} ${xText(p.x)}`, p.x, p.y) })),
  ]
  const placed: { key: string; l: number; t: number; r: number; b: number }[] = []
  const place: Record<string, { left: number; top: number } | null> = {}
  for (const it of items) {
    // повтор той же точки (вернули правила профиля) подписан один раз
    if (items.some((o) => o !== it && o.text === it.text && Math.abs(o.x - it.x) < 1 && Math.abs(o.y - it.y) < 1 && place[o.key])) { place[it.key] = null; continue }
    // справа, над точкой, слева, под точкой: подпись слева от точки читалась как подпись соседней точки
    const c = [[10, -8], [-it.w / 2, -27], [-it.w + 10, -27], [-10 - it.w, -8], [-it.w / 2, 10], [4, -26], [-it.w - 4, -26], [4, 9], [-it.w - 4, 9],
      ...(narrow ? [[-it.w / 2, -45], [-it.w + 10, -45]] : [])]
    let got: { left: number; top: number } | null = null
    for (const [dx, dy] of c) {
      const l = it.x + dx, t = it.y + dy, r = l + it.w, b = t + 16
      // не заходит на подписи оси «100%», «50%», «0» и не уходит ниже оси; над полем есть 8 px запаса
      if (l < padL + 2 || r > size.w + 6 || t < -8 || b > padT + H + 4) continue
      // точки других ходов подпись тоже не закрывает
      const hitsDot = items.some((o) => o !== it && (Math.abs(o.x - it.x) > 1 || Math.abs(o.y - it.y) > 1) && o.x > l - 6 && o.x < r + 6 && o.y > t - 6 && o.y < b + 6)
      if (hitsDot || placed.some((q) => l < q.r && r > q.l && t < q.b && b > q.t)) continue
      got = { left: dx, top: dy }; placed.push({ key: it.key, l, t, r, b }); break
    }
    place[it.key] = got
  }
  // подпись, которой не нашлось места, остаётся в итоге и в aria-label; на поле точка без подписи
  const lstyle = (k: string) => { const q = place[k]; return q ? { left: q.left, top: q.top } : { display: 'none' } }
  const dot = (p: { x: number; y: number }) => ({ transform: `translate(${px(p.x)}px, ${py(p.y)}px)` })

  const plot = (
    <div ref={box} className={`relative ${head ? 'h-[248px] lg:h-auto lg:min-h-0 lg:flex-1' : `mt-1.5 ${still ? 'h-[200px] lg:h-[290px] print:h-[200px]' : 'h-[172px] short:h-[144px]'}`}`}
      role="img" aria-label={T.aria(summary)} data-tradeoff-plot>
      {ready && <>
        <svg className="absolute inset-0 overflow-visible" width={size.w} height={size.h} aria-hidden>
          {/* оси: две линии, пунктир на 50%, засечки 1-2-5 по логарифмической шкале */}
          <line x1={padL} y1={padT + H} x2={padL + W} y2={padT + H} stroke="var(--color-line)" />
          <line x1={padL} y1={padT} x2={padL} y2={padT + H} stroke="var(--color-line)" />
          <line x1={padL} y1={py(50)} x2={padL + W} y2={py(50)} stroke="var(--color-line)" strokeDasharray="2 4" />
          <text x={padL - 6} y={py(100) + 4} textAnchor="end" className="fill-ink-3 text-[11px] font-medium">100%</text>
          <text x={padL - 6} y={py(50) + 4} textAnchor="end" className="fill-ink-3 text-[11px] font-medium">50%</text>
          <text x={padL - 6} y={py(0) + 4} textAnchor="end" className="fill-ink-3 text-[11px] font-medium">0</text>
          {ticks.map((v) => <g key={v} data-tradeoff-tick={v}>
            <line x1={px(v)} x2={px(v)} y1={padT + H} y2={padT + H + 4} stroke="var(--color-line)" />
            <text x={px(v)} y={padT + H + 15} textAnchor={px(v) - padL < 8 ? 'start' : 'middle'} className="fill-ink-3 text-[11px] font-medium tabular-nums">{num(v, lang, 0)}</text>
          </g>)}
          {/* путь банка: тонкая линия между ходами, без сглаживания */}
          {moves.length > 1 && <polyline points={moves.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill="none" stroke="var(--color-brand-dot)" strokeOpacity="0.45" strokeWidth="1.5" />}
          {/* модель поднялась: пунктир от места на найденной атаке */}
          {mark && again && <line x1={px(mark.x)} y1={py(mark.y)} x2={px(again.x)} y2={py(again.y)} stroke="var(--color-leak-dot)" strokeOpacity="0.6" strokeDasharray="3 3"
            className={anim ? 'to-line' : ''} />}
        </svg>

        {/* угол, куда порогами не попасть: подпись появляется вместе с точкой модели */}
        {mark && <span className="pointer-events-none absolute whitespace-nowrap text-[11px] font-medium leading-none text-stop" style={{ left: px(mark.x) + 12, top: py(0) - 18 }} data-tradeoff-corner>{T.corner}</span>}

        {moves.map((p) => (
          <div key={p.key} className="absolute left-0 top-0" style={dot(p)} data-tradeoff-move>
            <span className={`to-dot ${anim ? 'to-pop' : ''} ${p.base ? 'bg-ink' : 'bg-brand'}`} />
            <span className={`to-label ${anim ? 'to-fade' : ''}`} style={lstyle(p.key)}>
              {p.label} <span className="tabular-nums text-ink-3">{xText(p.x)}</span>
            </span>
          </div>
        ))}

        {mark && <>
          {again && <div className="absolute left-0 top-0" style={dot(mark)} aria-hidden><span className="to-dot to-ghost" /></div>}
          <div className={`absolute left-0 top-0 ${anim ? 'to-rise' : ''}`} style={dot({ x: again?.x ?? mark.x, y: modelY })} data-tradeoff-model={again ? 'again' : 'found'}>
            <span className={`to-dot ${anim ? 'to-pop' : ''} ${again ? 'bg-leak-dot' : 'bg-stop-dot'}`} />
            <span className={`to-label ${anim ? 'to-fade' : ''}`} style={lstyle('model')} key={again ? 'a' : 'f'}>
              {again ? T.rematch : T.model} <b className={`font-semibold ${again ? 'text-leak' : 'text-stop'}`}>{again?.lb && again.y < 99.95 ? '≥' : ''}{pctText(modelY, lang)}%</b>
            </span>
          </div>
        </>}
      </>}
    </div>
  )
  const axes = (
    <p className={`flex flex-wrap gap-x-4 text-[12px] font-medium leading-snug text-ink-3 ${head ? '' : 'mt-1'}`} data-tradeoff-axes>
      <span>↑ {T.yAxis}</span><span>{T.xAxis}</span>
    </p>
  )
  const sum = (
    <p className={`text-[13px] font-medium leading-snug text-ink-2 ${head ? '' : 'mt-1.5'}`} data-tradeoff-sum aria-live={still ? undefined : 'polite'}>
      {showDemo && <span className="text-ink-3">{T.demoNote} </span>}{summary}
    </p>
  )
  const demoBtn = !still && anchors && anchors.scheme === scheme && !own && demo == null && (
    <button type="button" className={`ctl ctl-quiet !h-9 !gap-2 !px-3.5 !text-[14px] !font-medium ${head ? 'self-start' : 'mt-2'}`} onClick={playDemo} data-tradeoff-demo>
      <Play size={13} strokeWidth={2.25} aria-hidden />{T.demo}
    </button>
  )

  // нижняя плита шага «Дыра»: та же высота, что у карты поиска, поле во всю ширину слева, итог колонкой справа
  if (head) return (
    <section className="plate map-xl flex shrink-0 flex-col px-4 pb-4 pt-4 max-lg:order-5 max-lg:mt-5 sm:px-6 lg:!pl-[56px]" data-tradeoff aria-label={T.caps}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <h2 className="sr-only">{T.caps}</h2>
        {head}
        <span className="t-caption text-ink-2 sm:ml-auto">{T.goal}</span>
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 lg:mt-6 lg:flex-row lg:gap-7">
        {plot}
        <div className="flex flex-col gap-2 lg:w-[268px] lg:shrink-0 lg:justify-center lg:overflow-y-auto">{axes}{sum}{demoBtn}</div>
      </div>
    </section>
  )
  return (
    <section className="nest px-3 pb-3 pt-2.5 sm:px-4" data-tradeoff aria-label={T.caps}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-caps whitespace-nowrap text-ink-3">{T.caps}</span>
        <span className="t-caption text-ink-2">{T.goal}</span>
      </div>
      {plot}
      {axes}
      {sum}
      {demoBtn}
    </section>
  )
}
