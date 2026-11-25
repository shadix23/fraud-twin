import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import NumberFlow, { NumberFlowGroup } from '@number-flow/react'
import { spring } from './motion'
import { Slider } from '@base-ui/react/slider'
import { Money, StepTile, flowTiming } from './ui'
import { useLang, type Dict, type Lang } from './i18n'
import { kzt, num } from './format'

// Экономика для банка (hackathon/economics.md): банк вводит свои входы, видит экономию, окупаемость и точку безубыточности.
// По умолчанию базовый сценарий на допущениях. Формула: экономия = L*h*c + O*o; окупаемость = (P + I) / (экономия / 12).

export interface Econ { L: number; h: number; c: number; O: number; o: number; P: number }
export type Scenario = 'cautious' | 'base'
export const ECON_PRESETS: Record<Scenario, Econ> = {
  cautious: { L: 600e6, h: 0.2, c: 0.2, O: 60e6, o: 0.05, P: 24e6 },
  base: { L: 1200e6, h: 0.3, c: 0.4, O: 120e6, o: 0.1, P: 24e6 },
}
/** Внутренние затраты банка на внедрение (допущение, economics.md п. 2) */
export const ECON_SETUP = 1e6

export function econCalc(e: Econ) {
  const loss = e.L * e.h * e.c
  const ops = e.O * e.o
  const saves = loss + ops
  const cost = e.P + ECON_SETUP
  const payback = saves > 0 ? cost / (saves / 12) : Infinity
  const ret = e.P > 0 ? saves / e.P : null
  const breakeven = e.L > 0 ? (cost / e.L) * 100 : null
  return { loss, ops, saves, net: saves - cost, payback, ret, breakeven }
}

export const useEcon = () => useState<Econ>(ECON_PRESETS.base)

export function paybackText(m: number, t: Dict, lang: Lang) {
  if (!Number.isFinite(m)) return t.econ.never
  if (m > 36) return t.econ.over3y
  return t.econ.months(m < 12 ? num(m, lang) : String(Math.round(m)))
}

/** Плита калькулятора под листом отчёта (на экране; в PDF вместо неё строка в листе).
 *  v22: вывод «Окупается, если убрать X% потерь» заголовком раздела, итог на зелёной плитке справа от входов */
export default function Economics({ v, set }: { v: Econ; set: (e: Econ) => void }) {
  const { t, lang } = useLang()
  const E = t.econ, V = t.v22
  const r = econCalc(v)
  const scen = (Object.keys(ECON_PRESETS) as Scenario[]).find((k) => (Object.keys(v) as (keyof Econ)[]).every((f) => ECON_PRESETS[k][f] === v[f]))
  const put = (k: keyof Econ) => (x: number) => set({ ...v, [k]: x })
  const be = r.breakeven != null && Number.isFinite(r.breakeven) ? r.breakeven : null
  // моушн-бриф 6.5: пока тянут ползунок, числа считают за 220 мс; после отпускания и при смене сценария 700 мс
  const [drag, setDrag] = useState(false)
  const ft = flowTiming(drag ? 220 : 700)
  const loc = lang === 'en' ? 'en-US' : 'ru-RU'
  const [hPre, hPost] = V.repEconH('\u0000').split('\u0000')
  const pb = r.payback
  const pbFlow = Number.isFinite(pb) && pb <= 36

  return (
    <section className="no-print mx-auto max-w-[1328px]" data-rep-econ aria-labelledby="econ-h">
      <h2 id="econ-h" className="rep-h2" aria-live="polite" data-econ-be aria-label={be != null ? V.repEconH(num(be, lang)) : undefined}>
        {be != null ? <span aria-hidden>{hPre}<NumberFlow value={Math.round(be * 10) / 10} locales={loc} {...ft} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />{hPost}</span> : E.title}
      </h2>
      <p className="mt-2 text-[16px] leading-snug text-ink-3">{V.repEconSub}</p>

      <div className="plate mt-5 grid gap-x-12 gap-y-7 px-5 py-6 sm:px-11 sm:py-9 lg:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 lg:col-start-1 lg:row-start-1">
          <h3 className="text-[19px] font-semibold tracking-[-0.015em]">{V.repEconIn}</h3>
          <div className="seg seg-sm seg-in" role="group" aria-label={E.scenAria}>
            {(Object.keys(ECON_PRESETS) as Scenario[]).map((k) => (
              <button key={k} type="button" className="seg-item" aria-pressed={scen === k} onClick={() => set(ECON_PRESETS[k])} data-econ-scen={k}>
                {scen === k && <motion.span layoutId="seg-econ" transition={spring.ui} className="seg-on" aria-hidden />}<span className="relative">{E.scen[k]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* итог: на телефоне сразу под заголовком, на широком справа от входов */}
        <div className="econ-out self-start lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <StepTile tone="defense" className="econ-tile px-6 py-6 sm:px-8 sm:py-7 lg:px-10 lg:py-9">
            <NumberFlowGroup><div aria-live="polite" data-econ-out>
              <p className="text-[15px] font-medium opacity-80">{E.saves}</p>
              <p className="rep-xl mt-3" data-econ-saves><Money v={r.saves} timing={drag ? 220 : 700} /></p>
              <p className="mt-3 text-[14px] leading-snug opacity-90">{E.savesSub(kzt(r.loss, lang), kzt(r.ops, lang))}</p>
              <dl className="mt-8 space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <dd className="rep-kpi" data-econ-payback aria-label={paybackText(pb, t, lang)}>
                    {pbFlow ? <span aria-hidden><NumberFlow value={pb < 12 ? Math.round(pb * 10) / 10 : Math.round(pb)} locales={loc} {...ft}
                      format={pb < 12 ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }} suffix={lang === 'en' ? ' mo' : ' мес.'} /></span>
                      : paybackText(pb, t, lang)}
                  </dd>
                  <dt className="order-2 text-[14px] opacity-85">{V.repPayback}</dt>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <dd className="rep-kpi">{r.ret == null ? '-' : (() => {
                    const n = <NumberFlow value={Math.round(r.ret * 10) / 10} locales={loc} {...ft} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                    return lang === 'en' ? <><span className="rep-kpi-u">₸</span>{n}</> : <>{n}<span className="rep-kpi-u ml-[0.18em]">₸</span></>
                  })()}</dd>
                  <dt className="order-2 text-[14px] opacity-85">{V.repPerTenge}</dt>
                </div>
              </dl>
            </div></NumberFlowGroup>
          </StepTile>
          <p className="mt-4 text-[14px] leading-[1.4] text-ink-3">{V.repEconNote(kzt(v.P, lang))}</p>
        </div>

        <div className="space-y-6 lg:col-start-1 lg:row-start-2">
          <MoneyField label={E.f.L} v={v.L} set={put('L')} />
          <PctField label={E.f.h} v={v.h} set={put('h')} max={0.8} onDrag={setDrag} />
          <PctField label={E.f.c} v={v.c} set={put('c')} max={1} hint={E.twinHint} onDrag={setDrag} />
          <MoneyField label={E.f.O} v={v.O} set={put('O')} />
          <PctField label={E.f.o} v={v.o} set={put('o')} max={0.5} onDrag={setDrag} />
          <MoneyField label={E.f.P} v={v.P} set={put('P')} />
        </div>
      </div>
    </section>
  )
}

const parse = (s: string, lang: Lang = 'ru') => { const r = (lang === 'en' ? s.replace(/,/g, '') : s).replace(/\s/g, '').replace(',', '.'); return r === '' ? NaN : Number(r) }
const millions = (v: number, lang: Lang) => { const m = Math.round(v / 1e5) / 10; return lang === 'en' ? String(m) : m.toLocaleString('ru-RU', { maximumFractionDigits: 1 }).replace(/\s/g, '\u00a0') }

/** Сумма в млн ₸: поле ввода, своё значение банка. Пустое или не число - красная рамка, итог не меняется */
function MoneyField({ label, v, set, hint }: { label: string; v: number; set: (x: number) => void; hint?: string }) {
  const { t, lang } = useLang()
  const [draft, setDraft] = useState(millions(v, lang))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setDraft(millions(v, lang)) }, [v, lang, focus])
  const x = parse(draft, lang)
  const bad = !Number.isFinite(x) || x < 0 || x > 1e6
  const id = useId()
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="min-w-0 text-[16px] leading-snug">{label}</label>
        <span className={`flex h-11 w-[124px] shrink-0 sm:w-[150px] items-center rounded-[12px] bg-surface pr-3 shadow-[inset_0_0_0_1px_var(--color-line)] focus-within:shadow-[inset_0_0_0_1px_var(--color-ink)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand ${bad ? '!shadow-[inset_0_0_0_1.5px_var(--color-leak)]' : ''}`}>
          {lang === 'en' && <span className="pl-3 text-[15px] text-ink-3" aria-hidden>₸</span>}
          <input id={id} value={draft} inputMode="decimal" enterKeyHint="done" aria-invalid={bad || undefined}
            className="h-full min-w-0 flex-1 bg-transparent pl-3 text-right text-[16px] font-semibold tabular-nums text-ink outline-none"
            onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            onChange={(e) => { setDraft(e.target.value); const n = parse(e.target.value, lang); if (Number.isFinite(n) && n >= 0 && n <= 1e6) set(n * 1e6) }} />
          <span className="pl-1.5 text-[15px] text-ink-3" aria-hidden>{t.econ.unitM}</span>
        </span>
      </div>
      {bad && <p className="mt-1 text-[14px] text-leak" role="alert">{t.econ.invalid}</p>}
      {hint && !bad && <p className="mt-1 text-[14px] leading-snug text-ink-3">{hint}</p>}
    </div>
  )
}

/** Ползунок (моушн-бриф 6.5): заполнение - полоса во всю ширину со scaleX от левого края, ручка едет через translateX.
 *  Пока тянут, ручка идёт за пальцем 1:1 без пружины; смена сценария переносит ручку пружиной spring.ui (0,5 с).
 *  Base UI держит доступность и ввод (клавиатура, указатель), позицию рисуем сами: ручка стоит в левом краю, x = доля * ширина дорожки */
function PctField({ label, v, set, max, hint, onDrag }: { label: string; v: number; set: (x: number) => void; max: number; hint?: string; onDrag: (d: boolean) => void }) {
  const id = useId()
  const p = useMotionValue(v / max)
  const w = useMotionValue(0)
  const x = useTransform(() => p.get() * w.get())
  const track = useRef<HTMLDivElement>(null)
  const mine = useRef<number | null>(null)
  const [grab, setGrab] = useState(false)
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(() => w.set(el.clientWidth))
    ro.observe(el)
    w.set(el.clientWidth)
    return () => ro.disconnect()
  }, [w])
  useEffect(() => {
    const to = v / max
    if (mine.current === v) { mine.current = null; p.jump(to); return }
    const a = animate(p, to, { ...spring.ui, visualDuration: 0.5 })
    return () => a.stop()
  }, [v, max, p])
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-[16px]">
        <span id={id} className="min-w-0 leading-snug">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{Math.round(v * 100)}%</span>
      </div>
      <Slider.Root value={v} min={0} max={max} step={0.01} aria-labelledby={id}
        onValueChange={(n) => { const r = Math.round(Number(n) * 100) / 100; mine.current = r; if (!grab) { setGrab(true); onDrag(true) } set(r) }}
        onValueCommitted={() => { setGrab(false); onDrag(false) }} className="mt-2">
        <Slider.Control className="flex h-6 w-full cursor-pointer touch-none items-center">
          <Slider.Track ref={track} className="relative h-1.5 w-full rounded-full bg-line">
            <span aria-hidden className="absolute inset-0 overflow-hidden rounded-full">
              <motion.span className="absolute inset-0 origin-left bg-stop" style={{ scaleX: p }} />
            </span>
            <Slider.Thumb aria-label={label} style={{ insetInlineStart: 0 }} data-grab={grab ? '' : undefined}
              render={<motion.div style={{ x }} />}
              className="eco-thumb h-5 w-5 rounded-full border-2 border-stop bg-surface shadow-[0_1px_3px_rgba(16,12,40,0.25)] focus-visible:outline-[3px] focus-visible:outline-brand has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-brand" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      {hint && <p className="mt-1 text-[14px] leading-snug text-ink-3">{hint}</p>}
    </div>
  )
}
