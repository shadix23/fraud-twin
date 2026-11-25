import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, Download, FileJson } from 'lucide-react'
import { loadClientCheck, loadReport, type Bank, type ClientCheck, type Ctx, type Report as R, type RuleSet } from './data'
import { intl, kzt, num } from './format'
import { useLang, type Dict, type Lang } from './i18n'
import { Pilot } from './How'
import { changeText, ruleValue } from './RulesEditor'
import type { Round } from './Rounds'
import { TradeoffMap, type ModelMark } from './Tradeoff'
import { Money, StepTile } from './ui'
import Economics, { econCalc, paybackText, useEcon, type Econ } from './Economics'

// Отчёт краш-теста (F6, бриф v20): лист 880 на фоне. Сверху тёмная плитка отчёта: вывод одной мыслью и три числа
// (одно главное, два вторых, не ряд равных KPI). Ниже лист: ход проверки с порогами и раундами сессии, схемы, рекомендации,
// меры и цена, защита клиента и правовая опора, справочное свёрнуто. Печать: без фона и стекла, свёрнутое раскрыто.

interface Props { ctx: Ctx; bank: Bank; rounds: Round[]; profile: RuleSet; modelMark?: ModelMark | null; scheme?: string; langSwitch?: ReactNode; onBack: () => void }

export default function Report({ ctx, bank, rounds, profile, modelMark = null, scheme = 'student_crypto', langSwitch, onBack }: Props) {
  const { t, lang } = useLang()
  const [rep, setRep] = useState<R | null>(null)
  const [source, setSource] = useState<'api' | 'json'>('json')
  const [err, setErr] = useState<string | null>(null)
  // экономика для банка: входы живут здесь, чтобы строка в PDF совпадала с калькулятором
  const [econ, setEcon] = useEcon()
  // защита клиента при переводе: честные цифры экрана клиента есть в готовом файле демо-банка
  const [robust, setRobust] = useState<ClientCheck['robust'] | null>(null)
  useEffect(() => { let alive = true; setRobust(null); loadClientCheck('student_crypto', ctx, lang).then((r) => alive && setRobust(r.robust)); return () => { alive = false } }, [ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  // смена языка не прячет отчёт: прежний лист виден, пока не придёт переведённый (числа те же)
  const load = useCallback((keep = false) => {
    setErr(null); if (!keep) setRep(null)
    loadReport(ctx, lang).then((r) => { setRep(r.data); setSource(r.source) }).catch((e) => { if (!keep) setErr(e instanceof Error ? e.message : String(e)) })
  }, [ctx, lang])
  const loadedCtx = useRef<Ctx | null>(null)
  useEffect(() => { load(loadedCtx.current === ctx); loadedCtx.current = ctx }, [load, ctx])
  useEffect(() => { window.scrollTo(0, 0) }, [])
  // имя PDF при печати берётся из заголовка вкладки
  useEffect(() => {
    if (!rep) return
    let prev = document.title
    const before = () => { prev = document.title; document.title = `Fraud Twin - ${t.steps.report} - ${rep.bank.name}` }
    const after = () => { document.title = prev }
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [rep, t])

  const download = () => {
    if (!rep) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...rep, rounds }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = `fraud-twin-report-${rep.bank.preset ?? 'custom'}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="app-h relative isolate min-h-screen bg-bg px-2 pb-16 text-ink sm:px-4 print:bg-white print:p-0">
      <div className="no-print mx-auto flex max-w-[880px] items-center gap-2 pb-3 pt-3 sm:pt-5">
        <button className="ctl ctl-quiet !h-11 max-sm:!w-11 max-sm:!px-0" onClick={onBack} aria-label={t.report.back}>
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden /><span className="max-sm:hidden">{t.report.back}</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {langSwitch}
          <button className="ctl ctl-quiet !h-11 max-sm:hidden" onClick={download} disabled={!rep} aria-label={t.report.jsonAria}><FileJson size={17} strokeWidth={1.75} aria-hidden />{t.report.json}</button>
          <button className="ctl ctl-main !h-11 sm:!h-[52px]" onClick={() => window.print()} disabled={!rep} data-pdf><Download size={17} strokeWidth={2} aria-hidden />{t.report.pdf}</button>
        </div>
      </div>

      {err && (
        <div className="plate mx-auto max-w-[880px] p-6 sm:p-10" role="alert">
          <div className="t-title text-leak">{t.report.failed}</div>
          <p className="mt-2 text-[16px] text-ink-2">{err}</p>
          <button className="ctl ctl-quiet mt-5" onClick={() => load()}>{t.report.retry}</button>
        </div>
      )}
      {!rep && !err && (
        <div className="plate mx-auto flex max-w-[880px] items-center gap-3 p-6 text-[16px] text-ink-2 sm:p-10" aria-live="polite">
          <span className="client-spin" aria-hidden />{t.report.loading}
        </div>
      )}
      {rep && <Sheet r={rep} bank={bank} rounds={rounds} profile={profile} source={source} robust={robust} t={t} lang={lang} modelMark={modelMark} scheme={scheme} ctx={ctx} econ={econ} />}
      {rep && <Economics v={econ} set={setEcon} />}
      {rep && (
        <section className="plate no-print mx-auto mt-3 max-w-[880px] p-5 sm:px-12 sm:py-9" data-rep-pilot>
          <h2 className="t-title">{t.report.pilot}</h2>
          <Pilot className="mt-5" profiles={bank.calib_presets.length} />
        </section>
      )}
    </div>
  )
}

function Sheet({ r, bank, rounds, profile, source, robust, t, lang, modelMark, scheme, ctx, econ }: {
  r: R; bank: Bank; rounds: Round[]; profile: RuleSet; source: 'api' | 'json'; robust: ClientCheck['robust'] | null; t: Dict; lang: Lang
  modelMark: ModelMark | null; scheme: string; ctx: Ctx; econ: Econ
}) {
  const s = r.summary
  const T = t.report
  const date = lang === 'en'
    ? new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, ' года')
  const rec = r.recommendations.find((x) => x.kind === 'measure')
  const [more, setMore] = useState(false)
  const [tech, setTech] = useState(false)
  const base = r.measures.find((x) => x.key === 'base'), mod = r.measures.find((x) => x.key === 'model')
  const bypass = r.schemes.filter((x) => x.rematch.withdrawn > 0).length
  // v21: результат поиска - нижняя оценка («не меньше»); в старых прогонах поля нет
  const lb = !!s.lower_bound
  const top = r.recommendations.slice(0, 3), rest = r.recommendations.slice(3)
  // свои пороги: последний живой раунд с правками. Таблицы схем и мер посчитаны для профиля, это сказано честной строкой
  const lastChanged = [...rounds].reverse().find((x) => x.source === 'live' && x.asked.length > 0)
  const yours = !!lastChanged
  const lastSet: RuleSet = { ...profile }
  for (const c of lastChanged?.asked ?? []) if (c.to != null) lastSet[c.param] = c.to
  const fmt = (m: Bank['rule_meta'][number], set: RuleSet) => {
    if (m.on_param && set[m.on_param] === false) return T.off
    const v = set[m.param]
    return typeof v === 'number' ? ruleValue(m, v, t, lang) : '-'
  }
  const pct = (v: number) => (Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : num(v, lang))

  const Rec = ({ x, i }: { x: R['recommendations'][number]; i: number }) => (
    <li className="break-avoid grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <span className="mt-0.5 grid size-7 place-items-center rounded-full bg-ink text-[13px] font-semibold text-white print:bg-white print:text-ink print:shadow-[inset_0_0_0_1px_var(--color-ink)]">{i + 1}</span>
      <div>
        <div className="text-[18px] font-semibold leading-snug tracking-[-0.015em]">{x.title}</div>
        <p className="mt-1 text-[16px] leading-snug text-ink-2">{x.text}</p>
        {x.where && x.where.length > 0 && <p className="mt-1 text-[16px] leading-snug text-ink-3">{T.recWhere(x.where.join(', '))}</p>}
      </div>
    </li>
  )

  return (
    <article className="print-sheet mx-auto w-full max-w-[880px]" data-report>
      {/* вывод и три числа в одной тёмной плитке: главное слева крупно, два вторых справа */}
      <StepTile tone="report" className="rep-tile break-avoid p-6 sm:p-9">
        <p className="t-caps opacity-80">{T.caps}</p>
        <h1 className="mt-6 max-w-[26ch] text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[36px]" data-rep-verdict>
          <span className="opacity-60 print:text-ink-3 print:opacity-100">{T.verdictMute(num(s.hole_pct, lang), lb)}</span>{' '}
          {nobreak(bypass > 0 ? T.verdictBypass(bypass, s.schemes) : T.verdictClosed)}
        </h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] font-medium opacity-90">
          <span>{T.profile(r.bank.name)}</span>
          <span>{date}</span>
          <span className="opacity-80">{T.twin(intl(r.bank.clients, lang), r.bank.clients, intl(r.bank.honest_tx, lang), r.bank.honest_tx)}</span>
          {yours && <span className="rounded-full bg-white/18 px-3 py-1 text-[13px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] print:shadow-[inset_0_0_0_1px_var(--color-ink)]" data-rep-yours>{T.yours}</span>}
        </p>

        <div className="mt-8 grid gap-x-8 gap-y-6 border-t border-white/20 pt-6 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] print:border-line" data-rep-top>
          <div>
            <p className="flex items-center gap-2 text-[15px] font-medium opacity-90"><span className="rep-dot bg-leak-dot" aria-hidden />{T.now}</p>
            <p className="rep-num1 mt-3 print:text-leak"><Money v={s.hole_withdrawn} flow={false} /></p>
            <p className="mt-3 text-[16px] leading-snug opacity-80">{T.nowSub(kzt(s.hole_attempted ?? s.attempted, lang), s.holes_found, s.schemes)}</p>
          </div>
          <div className="grid gap-y-5 sm:border-l sm:border-white/20 sm:pl-8 print:border-line">
            <div>
              <p className="flex items-center gap-2 text-[15px] font-medium opacity-90"><span className="rep-dot bg-stop-dot" aria-hidden />{T.model}</p>
              <p className="rep-num2 mt-2 print:text-stop">{mod ? <Money v={mod.hole_withdrawn} flow={false} /> : '-'}</p>
              {mod && base && <p className="mt-2 text-[16px] leading-snug opacity-80">{T.modelSub(num(mod.delayed_per_10k, lang), num(base.delayed_per_10k, lang))}</p>}
            </div>
            <div>
              <p className="flex items-center gap-2 text-[15px] font-medium opacity-90"><span className="rep-dot bg-leak-dot" aria-hidden />{T.again}</p>
              <p className="rep-num2 mt-2 print:text-leak"><Money v={s.rematch_withdrawn} flow={false} /></p>
              <p className="mt-2 text-[16px] leading-snug opacity-80">{bypass > 0 ? T.againSub(bypass, s.schemes, s.rematch_attempted ? num(s.rematch_pct, lang) : null, s.rematch_attempted ? kzt(s.rematch_attempted, lang) : null, lb) : T.againNone}</p>
            </div>
          </div>
        </div>
      </StepTile>

      <div className="plate print-sheet mt-3 print:!mt-8 px-5 py-7 sm:px-12 sm:py-10">
        {/* ход проверки: пороги профиля и последнего раунда, раунды этой сессии */}
        <section data-rep-course>
          <h2 className="rep-h2 !mt-0">{T.course}</h2>
          {yours ? <p className="mt-2 text-[16px] leading-snug text-ink-2" data-rep-honest>{T.honest(bank.name)}</p>
            : rounds.length === 0 && <p className="mt-2 text-[16px] leading-snug text-ink-2">{T.noRounds}</p>}

          {/* вау 1: та же карта компромисса, без движения; свои ходы банка этой сессии */}
          {(rounds.some((x) => x.source === 'live' && (x.asked.length > 0 || x.vsModel)) || modelMark) && (
            <div className="break-avoid mt-5 max-w-[640px]" data-rep-tradeoff>
              <TradeoffMap rounds={rounds} model={modelMark} meta={bank.rule_meta} unseen={bank.model?.summary?.withdrawn_pct_mean?.boosting ?? null} scheme={scheme} ctx={ctx} still />
            </div>
          )}
          {rounds.length > 0 && (
            <table className="rep-table break-avoid mt-5" data-rep-rounds>
              <thead>
                <tr><th className="w-14">{T.colN}</th><th>{T.colWhat}</th><th className="r">{T.colPct}</th><th className="r max-sm:hidden">{T.colW}</th><th className="r">{T.colH}</th></tr>
              </thead>
              <tbody>
                {rounds.map((x) => {
                  const words = [...(x.vsModel ? [t.rounds.vsModel] : []), ...x.asked.map((c) => changeText(bank.rule_meta, c.param, c.to, t, lang)).filter(Boolean) as string[]]
                  return (
                    <tr key={x.n} data-round={x.n}>
                      <td className="font-medium text-ink-3">{x.n}</td>
                      <td>
                        <span className="font-medium text-ink">{cap(words.join(', ') || t.rounds.profile)}</span>
                        {x.source === 'ready' && <span className="block text-[14px] text-ink-3">{T.ready}</span>}
                      </td>
                      <td className="r font-semibold text-leak">{x.atLeast && x.pct < 99.95 ? '≥' : ''}{pct(x.pct)}%</td>
                      <td className="r max-sm:hidden">{kzt(x.withdrawn, lang)}</td>
                      <td className="r font-semibold text-warn">{x.honest != null ? num(x.honest, lang) : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <h3 className="mt-7 text-[16px] font-semibold">{T.thresholds}</h3>
          <table className="rep-table break-avoid mt-2 max-w-[640px]" data-rep-thresholds>
            <thead><tr><th>{T.colRule}</th><th className="r">{T.colProfile}</th>{yours && <th className="r">{T.colLast}</th>}</tr></thead>
            <tbody>
              {bank.rule_meta.map((m) => {
                const a = fmt(m, profile), b = fmt(m, lastSet)
                return (
                  <tr key={m.key}>
                    <td>{t.rules.names[m.key] ?? m.title}</td>
                    <td className="r text-ink-2">{a}</td>
                    {yours && <td className={`r ${a !== b ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                      {a !== b && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-ink align-middle" aria-hidden />}{b}
                    </td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* схемы: строка без бейджей и полос, три суммы колонками */}
        <section data-rep-schemes>
          <h2 className="rep-h2">{T.schemes}</h2>
          <div className="mt-4 hidden grid-cols-[minmax(0,1fr)_104px_104px_104px] gap-x-4 pb-2 text-[15px] font-medium text-ink-3 sm:grid" aria-hidden>
            <span>{T.colScheme}</span><span className="text-right">{T.colLib}</span><span className="text-right">{T.colHole}</span><span className="text-right">{T.colRematch}</span>
          </div>
          <ul className="max-sm:mt-3">
            {r.schemes.map((x) => (
              <li key={x.key} className="break-avoid grid gap-x-4 gap-y-2 border-t border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_104px_104px_104px]" data-scheme={x.key}>
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{x.title}</div>
                  <div className="mt-1 text-[15px] leading-snug text-ink-2">{diffLine(x.diff, t, lang)}</div>
                </div>
                <div className="grid grid-cols-3 gap-x-3 text-[15px] tabular-nums sm:contents">
                  <span className="sm:text-right"><span className="t-caption block text-ink-3 sm:sr-only">{T.colLib}</span>{kzt(x.lib.base.withdrawn, lang)}</span>
                  <span className="font-semibold text-leak sm:text-right"><span className="t-caption block font-medium text-ink-3 sm:sr-only">{T.colHole}</span>{kzt(x.hole.base.withdrawn, lang)}</span>
                  <span className={`sm:text-right ${x.rematch.withdrawn > 0 ? '' : 'text-stop'}`}><span className="t-caption block text-ink-3 sm:sr-only">{T.colRematch}</span>{x.rematch.withdrawn > 0 ? kzt(x.rematch.withdrawn, lang) : T.noBypass}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line pt-3 text-[16px] leading-snug text-ink-3">{T.rematchNote}</p>
        </section>

        <section data-rep-recs>
          <h2 className="rep-h2">{T.recs}</h2>
          <ol className="mt-4 space-y-5" data-rec="top">{top.map((x, i) => <Rec key={i} x={x} i={i} />)}</ol>
          {rest.length > 0 && (
            <>
              <button className="no-print link-btn mt-4 !text-[16px] max-sm:!whitespace-normal max-sm:text-left" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-controls="rep-rest">
                {more ? T.collapse : T.showMore(rest.length)}<ChevronDown size={16} strokeWidth={2} className={more ? 'rotate-180' : ''} aria-hidden />
              </button>
              {/* на экране свёрнуто, в печати раскрыто всегда */}
              <div id="rep-rest" className={`print:block ${more ? '' : 'hidden'}`}>
                <h3 className="mt-6 hidden text-[16px] font-semibold print:block">{T.recsMore}</h3>
                <ol className="mt-4 space-y-5" data-rec="rest">{rest.map((x, i) => <Rec key={i} x={x} i={i + 3} />)}</ol>
              </div>
            </>
          )}
        </section>

        <section className="break-avoid" data-rep-measures>
          <h2 className="rep-h2">{T.measures}</h2>
          <table className="rep-table mt-4">
            <thead>
              <tr><th>{T.colMeasure}</th><th className="r">{T.colHole}</th><th className="r max-sm:hidden">{T.colLib}</th><th className="r">{T.colDelayed}</th></tr>
            </thead>
            <tbody>
              {r.measures.map((x) => {
                const best = !!rec && rec.title.toLowerCase().includes(x.title.toLowerCase())
                const scenario = x.key === 'hold' || x.key === 'model_hold'
                return (
                  <tr key={x.key} className={scenario ? 'text-ink-2' : ''} data-measure={x.key}>
                    <td>
                      <span className={best ? 'font-semibold text-ink' : ''}>{x.title}</span>
                      {best && <span className="ml-2 inline-flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-stop"><span className="rep-dot bg-stop-dot" aria-hidden />{T.recommended}</span>}
                      {scenario && <span className="block text-[14px] text-ink-3">{T.scenario}</span>}
                    </td>
                    <td className={`r ${x.hole_withdrawn > 0 ? 'text-leak' : 'font-semibold text-stop'}`}>{kzt(x.hole_withdrawn, lang)}</td>
                    <td className="r max-sm:hidden">{kzt(x.lib_withdrawn, lang)}</td>
                    <td className="r">{num(x.delayed_per_10k, lang)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[16px] leading-snug text-ink-3">{T.priceNote} {bypass > 0 && s.rematch_attempted ? T.measuresNote(num(s.rematch_pct, lang), lb) : ''}</p>
        </section>

        {robust && (
          <section className="break-avoid" data-rep-client>
            <h2 className="rep-h2">{T.client}</h2>
            <p className="mt-2 max-w-[62ch] text-[16px] leading-snug text-ink-2">{T.clientLead}</p>
            <dl className="mt-4">
              {([
                [T.approx(Math.round(robust.honest.high_per_10k)), T.falseWarn, 'text-ink'],
                [`${num(robust.victims.first_on_card_silent_pct, lang)}%`, T.firstSilent, 'text-leak'],
                [`${num(robust.victims.repeat_on_card_covered_pct, lang)}%`, T.repeatCovered, 'text-stop'],
              ] as const).map(([v, d, c]) => (
                <div key={d} className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-4 border-t border-line py-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className={`text-[26px] font-semibold leading-none tracking-[-0.025em] ${c}`}>{v}</dt>
                  <dd className="text-[16px] leading-snug text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {/* экономика: на экране калькулятор под листом, в PDF одна строка с его текущими значениями */}
        <section className="break-avoid hidden print:block" data-rep-econ-print>
          <h2 className="rep-h2">{t.econ.printH}</h2>
          <p className="mt-2 max-w-[68ch] text-[16px] leading-snug text-ink-2">{(() => {
            const e = econCalc(econ)
            return t.econ.print(kzt(e.saves, lang), paybackText(e.payback, t, lang), kzt(econ.P, lang), kzt(econ.L, lang),
              Math.round(econ.h * 100), Math.round(econ.c * 100), kzt(econ.O, lang), Math.round(econ.o * 100))
          })()}</p>
        </section>
        <section className="break-avoid" data-rep-law>
          <h2 className="rep-h2">{T.law}</h2>
          <p className="mt-2 max-w-[68ch] text-[16px] leading-snug text-ink-2">{T.lawText}</p>
        </section>

        {/* на экране свёрнуто, в печати раскрыто */}
        <div className="no-print mt-10 border-t border-line pt-3">
          <button className="link-btn !text-[16px] max-sm:!whitespace-normal max-sm:text-left" onClick={() => setTech((v) => !v)} aria-expanded={tech} aria-controls="rep-tech" data-rep-tech-btn>
            {tech ? T.techHide : T.techShow(r.caveats.length)}<ChevronDown size={16} strokeWidth={2} className={tech ? 'rotate-180' : ''} aria-hidden />
          </button>
        </div>
        <div id="rep-tech" className={`print:block ${tech ? '' : 'hidden'}`} data-rep-tech>
          <h2 className="rep-h2 !mt-5 print:!mt-11">{T.params}</h2>
          <p className="mt-2 text-[16px] leading-snug text-ink-2">
            {T.paramsText(kzt(r.bank.rules.amount_limit, lang), kzt(r.bank.rules.daily_limit, lang), r.bank.rules.reaction_delay_min,
              Math.round(r.bank.calib.share_student * 100), Math.round(r.bank.calib.share_pensioner * 100))}
          </p>
          <h2 className="rep-h2 !mt-8">{T.caveats}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[16px] leading-snug text-ink-2">
            {r.caveats.map((c) => <li key={c} className="break-avoid">{c}</li>)}
          </ul>
        </div>

        <footer className="mt-10 border-t border-line pt-3 text-[15px] leading-snug text-ink-3" data-synthetic>
          {T.foot(source === 'api', date)}
        </footer>
      </div>
    </article>
  )
}

// слово через дефис не рвётся на строке («ИИ-мошенник»)
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const nobreak = (s: string) => s.split(/(\S+-\S+)/).map((w, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{w}</span> : w))

// Что поменял мошенник, одной строкой: три главных изменения
function diffLine(diff: { param: string; title: string; from: string | number; to: string | number }[], t: Dict, lang: Lang) {
  const n = (v: string | number) => (typeof v === 'number' ? num(Math.round(v), lang, 0) : String(v))
  const val = (v: string | number, param: string) => {
    if (param === 'victim_chunk_max' && typeof v === 'number') return v >= 10_000_000 ? t.gap.oneShot : t.gap.parts(kzt(v, lang))
    if (typeof v === 'number') return v >= 10_000 ? kzt(v, lang) : num(v, lang, Number.isInteger(v) ? 0 : 1)
    return v
  }
  return diff.slice(0, 3).map((d) =>
    d.param === 'victim_chunk_max' ? `${t.gap.victimPay.toLowerCase()} ${val(d.from, d.param)} → ${val(d.to, d.param)}`
      : d.param === 'layers' ? t.report.layers(n(d.from), n(d.to))
        : d.param === 'pause_min' ? t.report.pause(n(d.from), n(d.to))
          : `${d.title} ${val(d.from, d.param)} → ${val(d.to, d.param)}`).join(', ')
}
