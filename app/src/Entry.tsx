import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { readyDir, type ClientCheck, type Ctx, type Redteam, type Report } from './data'
import { useLang, useT } from './i18n'
import { intl, num } from './format'
import { DotGrid, Money, StepTile, useTilt } from './ui'

// Вход v20 (бриф, «Экраны: Вход»): один экран, не лендинг. Слева плита с заголовком, справа сцена (в App),
// снизу ряд пяти плиток шагов 3-2-2-2-3, в каждой одно настоящее число из готовых прогонов.

// rematchPct: новый поиск ИИ уже против модели на этой схеме (готовый отчёт), нижняя оценка. 0% модели верно только для найденной атаки
export interface EntryFacts { tries: number[]; base: number; evals: number; modelPct: number | null; warnPer10k: number | null; rematchPct: number | null }

// Готовые прогоны лежат статикой: вход не запускает живой поиск и не ждёт сервер
export function useEntryFacts(scKey: string, ctx: Ctx): EntryFacts | null {
  const [f, setF] = useState<EntryFacts | null>(null)
  const { lang } = useLang()
  useEffect(() => {
    let alive = true
    const dir = readyDir(ctx, lang)
    if (!dir) { setF(null); return }
    const get = <T,>(u: string) => fetch(u).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
    Promise.all([get<Redteam>(`${dir}/redteam_${scKey}.json`), ctx.preset === 'demo' ? get<ClientCheck>(`${dir}/client_check.json`) : null, get<Report>(`${dir}/report.json`)]).then(([rt, cc, rep]) => {
      if (!alive || !rt) return
      const runs = rt.scenario.runs
      const att = runs.base.metrics.attempted_kzt
      setF({
        tries: rt.history.map((h) => h.pct), base: rt.base.pct, evals: rt.evals,
        modelPct: att ? (runs.model.metrics.withdrawn_kzt / att) * 100 : null,
        warnPer10k: cc?.robust?.honest.high_per_10k ?? cc?.stats.honest.high_per_10k ?? null,
        rematchPct: rep?.schemes.find((x) => x.key === scKey)?.rematch.pct ?? null,
      })
    })
    return () => { alive = false }
  }, [scKey, ctx.preset, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  return f
}

// слово через дефис не рвётся на строке («ИИ-мошенник»): неразрывный дефис U+2011 в Inter нет, берём nowrap
const nobreak = (s: string) => s.split(/(\S+-\S+)/).map((w, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{w}</span> : w))

export function EntryPlate({ clients, onStart, onTour }: { clients: number; onStart: () => void; onTour: () => void }) {
  const t = useT()
  const { lang } = useLang()
  return (
    <section className="plate flex min-h-0 flex-col p-5 sm:p-8 lg:col-span-7 lg:p-10 short:p-8" aria-labelledby="entry-title" data-cover="left">
      <p className="t-caps text-ink-3">{t.entry.caps}</p>
      <h1 id="entry-title" className="t-display mt-4 max-w-[15ch] lg:mt-auto">
        <span className="text-ink-mute">{nobreak(t.entry.titleMute)}</span> {nobreak(t.entry.titleInk)}
      </h1>
      <p className="mt-4 max-w-[52ch] text-[16px] leading-[1.45] text-ink-2 short:mt-3">{t.entry.lead}</p>
      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row short:mt-5">
        <button className="ctl ctl-main h-14 !justify-between gap-6 !px-7 sm:!justify-center" onClick={onStart}>
          {t.entry.start}<ArrowRight size={18} strokeWidth={2} className="next" aria-hidden />
        </button>
        <button className="ctl ctl-quiet h-14 !px-6" onClick={onTour}>
          <Play size={15} strokeWidth={2.25} aria-hidden />{t.entry.tour}
        </button>
      </div>
      <p className="t-caption mt-6 text-ink-3 short:mt-4" data-synthetic>{t.entry.synthetic(intl(clients, lang))}</p>
    </section>
  )
}

// Пять шагов разной ширины; числа разного вида, чтобы ряд не читался как одинаковые KPI
export function EntryTiles({ facts, withdrawn, schemes, onPick }: { facts: EntryFacts | null; withdrawn: number; schemes: number; onPick: (s: number) => void }) {
  const t = useT()
  const { lang } = useLang()
  const row = useRef<HTMLElement>(null)
  useTilt(row)
  // точки в тоне янтарной плитки: прорыв глубоким коричневым, остальные его прозрачной тенью
  const dots = facts ? facts.tries.map((p) => (p > facts.base ? '#4A2A06' : 'rgba(74,42,6,0.22)')) : []
  const tile = 'flex min-h-[176px] flex-col p-5 short:min-h-[132px] short:p-4 max-lg:min-h-[156px]'
  const head = (name: string) => (
    <span className="flex items-center justify-between gap-2"><span className="t-caps">{name}</span><ArrowRight size={16} strokeWidth={2} className="tile-go opacity-80" aria-hidden /></span>
  )
  return (
    <nav ref={row} className="grid grid-cols-2 gap-2 lg:col-span-12 lg:grid-cols-12 lg:gap-3" aria-label={t.entry.tilesAria}>
      <StepTile as="button" tone="attack" className={`${tile} col-span-2 lg:col-span-3`} onClick={() => onPick(1)}>
        {head(t.steps.attack)}
        <span className="t-num2 mt-4 short:mt-3"><Money v={withdrawn} flow={false} /></span>
        <span className="t-caption mt-1.5">{t.entry.attack}</span>
      </StepTile>
      <StepTile as="button" tone="gap" className={`${tile} lg:col-span-2`} onClick={() => onPick(2)}>
        {head(t.steps.gap)}
        <span className="mt-4 short:mt-3">{facts && <DotGrid colors={dots} cols={25} size={4} gap={7} label={t.entry.gap(facts.evals)} className="max-w-full" />}</span>
        <span className="t-caption mt-2">{facts ? t.entry.gap(facts.evals) : ' '}</span>
      </StepTile>
      <StepTile as="button" tone="defense" className={`${tile} lg:col-span-2`} onClick={() => onPick(3)}>
        {head(t.steps.defense)}
        <span className="t-num2 mt-4 short:mt-3">{facts?.modelPct != null ? `${num(facts.modelPct, lang, facts.modelPct < 0.05 ? 0 : 1)}%` : ' '}</span>
        <span className="t-caption mt-1.5">{t.entry.defense}</span>
        {facts?.rematchPct ? <span className="t-caption mt-auto pt-1 font-semibold" data-entry-rematch>{t.entry.defenseAgain(num(facts.rematchPct, lang))}</span> : null}
      </StepTile>
      <StepTile as="button" tone="customer" className={`${tile} lg:col-span-2`} onClick={() => onPick(4)}>
        {head(t.steps.customer)}
        <span className="t-num2 mt-4 short:mt-3">{facts?.warnPer10k != null
          ? <>{Math.round(facts.warnPer10k)}<span className="u">{lang === 'en' ? 'in 10k' : 'из 10 тыс.'}</span></> : ' '}</span>
        <span className="t-caption mt-1.5">{t.entry.customer}</span>
      </StepTile>
      <StepTile as="button" tone="report" className={`${tile} col-span-2 lg:col-span-3`} onClick={() => onPick(5)}>
        {head(t.steps.report)}
        <span className="t-num2 mt-4 short:mt-3">PDF</span>
        <span className="t-caption mt-1.5">{t.entry.report(schemes)}</span>
      </StepTile>
    </nav>
  )
}
