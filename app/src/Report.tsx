import { ViewTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, Download, FileJson } from 'lucide-react'
import { loadClientCheck, loadReport, type Bank, type ClientCheck, type Ctx, type Report as R, type RuleSet } from './data'
import { intl, kzt, num } from './format'
import { useLang, type Dict, type Lang } from './i18n'
import { changeText, ruleValue } from './RulesEditor'
import type { Round } from './Rounds'
import { TradeoffMap, type ModelMark } from './Tradeoff'
import { Money, StepTile } from './ui'
import Economics, { econCalc, paybackText, useEcon, type Econ } from './Economics'

// Отчёт краш-теста (v22, макет Penpot 05-report, слайд 5): вывод в два тона, главное число на большой стеклянной плите,
// рядом плитки «с моделью» и «новый поиск против модели». Ниже крупные заголовки разделов: схемы, рекомендации и меры,
// ход проверки (карта компромисса рядом с раундами), защита клиента и правовая опора, экономика, пилот.
// Печать: без фона и стекла, свёрнутое раскрыто, калькулятор одной строкой.

interface Props { ctx: Ctx; bank: Bank; rounds: Round[]; profile: RuleSet; modelMark?: ModelMark | null; scheme?: string; langSwitch?: ReactNode; onBack: () => void }

// моушн-бриф 6.5: отчёт загружается заранее (на шаге «Клиент» и по кнопке), чтобы плита вердикта была в дереве
// в момент перехода и браузер срастил с ней плитку шага (ViewTransition name="hero-tile")
const repCache = new Map<string, { data: R; source: 'api' | 'json' }>()
const repKey = (ctx: Ctx, lang: Lang) => `${lang}:${JSON.stringify(ctx)}`
export const reportReady = (ctx: Ctx, lang: Lang) => repCache.has(repKey(ctx, lang))
export function prefetchReport(ctx: Ctx, lang: Lang) {
  return loadReport(ctx, lang).then((r) => { repCache.set(repKey(ctx, lang), { data: r.data, source: r.source as 'api' | 'json' }); return r })
}

export default function Report({ ctx, bank, rounds, profile, modelMark = null, scheme = 'student_crypto', langSwitch, onBack }: Props) {
  const { t, lang } = useLang()
  const [rep, setRep] = useState<R | null>(() => repCache.get(repKey(ctx, lang))?.data ?? null)
  const [source, setSource] = useState<'api' | 'json'>(() => repCache.get(repKey(ctx, lang))?.source ?? 'json')
  const [err, setErr] = useState<string | null>(null)
  // экономика для банка: входы живут здесь, чтобы строка в PDF совпадала с калькулятором
  const [econ, setEcon] = useEcon()
  // защита клиента при переводе: честные цифры экрана клиента есть в готовом файле демо-банка
  const [robust, setRobust] = useState<ClientCheck['robust'] | null>(null)
  useEffect(() => { let alive = true; setRobust(null); loadClientCheck('student_crypto', ctx, lang).then((r) => alive && setRobust(r.robust)); return () => { alive = false } }, [ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  // смена языка не прячет отчёт: прежний лист виден, пока не придёт переведённый (числа те же)
  const load = useCallback((keep = false) => {
    setErr(null); if (!keep) setRep(null)
    prefetchReport(ctx, lang).then((r) => { setRep(r.data); setSource(r.source) }).catch((e) => { if (!keep) setErr(e instanceof Error ? e.message : String(e)) })
  }, [ctx, lang])
  const loadedCtx = useRef<Ctx | null>(null)
  useEffect(() => { load(loadedCtx.current === ctx || reportReady(ctx, lang)); loadedCtx.current = ctx }, [load, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  // до отрисовки: снимок новой страницы для перехода берётся уже с начала листа
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [])
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

  const date = lang === 'en'
    ? new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, '')
  const P = t.pilot
  const pilot: string[][] = [...P.items, [P.other, P.otherText(bank.calib_presets.length || null)]]

  return (
    <ViewTransition enter="page-in" exit="page-out">
    <div className="app-h relative isolate min-h-screen overflow-x-clip bg-bg px-5 pb-16 text-ink sm:px-8 lg:px-14 print:bg-white print:p-0">
      {/* v24 (макет 05-report): шапка как у двойника: знак, путь назад, язык. PDF и JSON справа от вывода */}
      <div className="no-print mx-auto flex max-w-[1328px] items-center gap-3 pt-[18px] lg:h-24 lg:pt-0">
        <button className="-m-1 flex items-center gap-2.5 rounded-[11px] p-1" onClick={onBack} aria-label={t.report.back}>
          <span className="rep-mark" aria-hidden>F</span><span className="logo-name max-lg:text-[17px]">Fraud Twin</span>
        </button>
        <div className="ml-auto flex items-center gap-4 lg:gap-5">
          <button className="how-link inline-flex items-center gap-1.5" onClick={onBack}><ArrowLeft size={16} strokeWidth={1.75} aria-hidden /><span className="max-sm:hidden">{t.report.back}</span></button>
          {langSwitch}
        </div>
      </div>

      {err && (
        <div className="plate mx-auto mt-6 max-w-[1328px] p-6 sm:p-10" role="alert">
          <div className="t-title text-leak">{t.report.failed}</div>
          <p className="mt-2 text-[16px] text-ink-2">{err}</p>
          <button className="ctl ctl-quiet mt-5" onClick={() => load()}>{t.report.retry}</button>
        </div>
      )}
      {!rep && !err && (
        <div className="plate mx-auto mt-6 flex max-w-[1328px] items-center gap-3 p-6 text-[16px] text-ink-2 sm:p-10" aria-live="polite">
          <span className="client-spin" aria-hidden />{t.report.loading}
        </div>
      )}
      {rep && <Sheet r={rep} bank={bank} rounds={rounds} profile={profile} robust={robust} t={t} lang={lang} date={date} modelMark={modelMark} scheme={scheme} ctx={ctx} econ={econ}
        actions={<div className="fade-d [--d:560ms] flex shrink-0 flex-wrap gap-3 max-lg:mt-6 lg:flex-col lg:items-end">
            <button className="ctl ctl-main rep-pdf" onClick={() => window.print()} disabled={!rep} data-pdf><Download size={18} strokeWidth={2} aria-hidden />{t.report.pdf}</button>
            <button className="ctl ctl-quiet rep-json max-sm:hidden" onClick={download} disabled={!rep} aria-label={t.report.jsonAria}><FileJson size={17} strokeWidth={1.75} aria-hidden />{t.report.json}</button>
          </div>} />}
      {rep && <Economics v={econ} set={setEcon} />}
      {rep && (
        <section className="no-print mx-auto max-w-[1328px] lg:mt-[70px] lg:grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-x-10" data-rep-pilot aria-labelledby="rep-pilot-h">
          <h2 id="rep-pilot-h" className="rep-h2 rep-h2-sm">{t.report.pilot}</h2>
          <ol className="mt-5 grid gap-y-6 sm:grid-cols-2 sm:gap-x-8 lg:mt-0 lg:grid-cols-4 lg:gap-x-8" data-pilot>
            {pilot.map(([title, d], i) => (
              <li key={title} className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 sm:block">
                <span className={`rep-badge tone-${PILOT_TONES[i]} !size-[26px] !rounded-[8px] !text-[13px] sm:hidden`} aria-hidden>{i + 1}</span>
                <div className="text-[17px] font-semibold leading-snug tracking-[-0.015em]">{title}</div>
                <p className="col-start-2 mt-1.5 text-[14px] leading-snug text-ink-2">{d}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {rep && (
        <footer className="mx-auto mt-12 max-w-[1328px] border-t border-line pt-4 text-[14px] leading-snug text-ink-3 print:mt-10" data-synthetic>
          {t.report.foot(source === 'api', date)}
        </footer>
      )}
    </div>
    </ViewTransition>
  )
}

const PILOT_TONES = ['customer', 'attack', 'defense', 'gap'] as const
const REC_TONES = ['defense', 'report', 'attack'] as const

function Sheet({ r, bank, rounds, profile, robust, t, lang, date, modelMark, scheme, ctx, econ, actions }: {
  r: R; bank: Bank; rounds: Round[]; profile: RuleSet; robust: ClientCheck['robust'] | null; t: Dict; lang: Lang; date: string
  modelMark: ModelMark | null; scheme: string; ctx: Ctx; econ: Econ; actions: ReactNode
}) {
  const s = r.summary
  const T = t.report, V = t.v22
  const rec = r.recommendations.find((x) => x.kind === 'measure')
  const [more, setMore] = useState(false)
  const [tech, setTech] = useState(false)
  const [thr, setThr] = useState(false)
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
  const changed = yours ? bank.rule_meta.filter((m) => fmt(m, profile) !== fmt(m, lastSet)) : []
  const pct = (v: number) => (Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : num(v, lang))
  // «51,8 из 54,3 млн ₸»: одна единица на пару сумм
  const pair = (a: number, b: number): [string, string] => {
    const x = kzt(a, lang), y = kzt(b, lang), u = ' млн ₸'
    return lang === 'ru' && x.endsWith(u) && y.endsWith(u) ? [x.slice(0, -u.length), y] : [x, y]
  }
  const holeAtt = s.hole_attempted ?? s.attempted
  const showMap = rounds.some((x) => x.source === 'live' && (x.asked.length > 0 || x.vsModel)) || !!modelMark || (ctx.preset === 'demo' && scheme === 'student_crypto')

  const Rec = ({ x, i }: { x: R['recommendations'][number]; i: number }) => (
    <li className="break-avoid grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 sm:gap-x-6">
      <span className={`rep-badge ${i < 3 ? `tone-${REC_TONES[i]}` : 'rep-badge-quiet'}`} aria-hidden>{i + 1}</span>
      <div>
        <div className="text-[19px] font-semibold leading-[1.25] tracking-[-0.015em]"><span className="sr-only">{i + 1}. </span>{x.title}</div>
        <p className="mt-1.5 text-[16px] leading-snug text-ink-2">{x.text}</p>
        {x.where && x.where.length > 0 && <p className="mt-1 text-[15px] leading-snug text-ink-3">{T.recWhere(x.where.join(', '))}</p>}
      </div>
    </li>
  )

  return (
    <article className="print-sheet mx-auto w-full max-w-[1328px]" data-report>
      {/* вывод в два тона, как заголовки шагов и слайд 5 */}
      <header className="break-avoid pt-8 lg:flex lg:items-start lg:justify-between lg:gap-10 lg:pt-10 print:block print:pt-0">
        <div className="min-w-0">
        <p className="t-caps hidden text-ink-3 print:mb-3 print:block">{T.caps}</p>
        <h1 className="rep-hero head-mask max-w-[1000px]" data-rep-verdict>
          {/* заголовок вердикта выезжает из-под маски после перехода */}
          <span className="rise-y block">
          {nobreak(V.repInk(s.holes_found, s.schemes))}{' '}
          <span className="text-ink-mute sm:block print:text-ink-3">{nobreak(V.repMute(bypass > 0))}</span>
          </span>
        </h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[16px] leading-snug text-ink-3">
          <span>{r.bank.name}, {date}. {T.twin(intl(r.bank.clients, lang), r.bank.clients, intl(r.bank.honest_tx, lang), r.bank.honest_tx)}</span>
          {yours && <span className="rounded-full bg-white/80 px-3 py-1 text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" data-rep-yours>{T.yours}</span>}
        </p>
        </div>
        <div className="no-print">{actions}</div>
      </header>

      {/* главное число на большой стеклянной плите, справа две плитки: с моделью и новый поиск против модели */}
      <div className="mt-8 grid gap-5 sm:mt-10 lg:mt-7 lg:grid-cols-[minmax(0,820fr)_minmax(0,484fr)] lg:gap-x-6" data-rep-top>
        <ViewTransition name="hero-tile">
        <section className="plate rep-verdict break-avoid flex flex-col justify-center px-6 py-7 sm:px-11 sm:py-10 lg:px-12" aria-label={T.now}>
          {lb && <p className="text-[18px] font-medium text-leak">{V.atLeast}</p>}
          <p className="rep-big mt-2 text-leak" data-rep-main>{num(s.hole_pct, lang)}%</p>
          <p className="mt-5 max-w-[620px] text-[19px] leading-[1.4] text-ink-2 lg:text-[20px]">{V.repMain(...pair(s.hole_withdrawn, holeAtt), pct(s.lib_pct))}</p>
        </section>
        </ViewTransition>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 lg:gap-5">
          <StepTile tone="defense" className="rep-side in-r [--x:56px] [--d:300ms] break-avoid flex flex-col justify-center px-6 py-6 sm:px-8">
            <p className="rep-mid" data-rep-model>{mod ? <Money v={mod.hole_withdrawn} flow={false} /> : '-'}</p>
            {mod && base && <p className="mt-3 max-w-[340px] text-[15px] leading-[1.35] opacity-90">{V.repModel(num(mod.delayed_per_10k, lang), num(base.delayed_per_10k, lang))}</p>}
          </StepTile>
          <StepTile tone="report" className="rep-side in-r [--x:56px] [--d:390ms] break-avoid flex flex-col justify-center px-6 py-6 sm:px-8">
            {lb && bypass > 0 && <p className="text-[14px] font-medium opacity-80">{V.atLeast}</p>}
            <p className="rep-mid mt-1" data-rep-again>{num(bypass > 0 ? s.rematch_pct : 0, lang)}%</p>
            <p className="mt-3 max-w-[340px] text-[15px] leading-[1.35] opacity-90">
              {bypass > 0 && s.rematch_attempted ? V.repAgain(...pair(s.rematch_withdrawn, s.rematch_attempted), bypass, s.schemes) : bypass > 0 ? T.againSub(bypass, s.schemes) : V.repAgainNone}
            </p>
          </StepTile>
        </div>
      </div>

      {/* ход проверки: карта компромисса рядом с раундами сессии */}
      <section className="print:break-before-page" data-rep-course aria-labelledby="rep-course-h">
        <h2 id="rep-course-h" className="rep-h2">{T.course}</h2>
        <p className="mt-2 text-[16px] leading-snug text-ink-3">{V.repCourseSub}</p>
        {yours && <p className="mt-1 text-[16px] leading-snug text-ink-3" data-rep-honest>{T.honest(bank.name)}</p>}
        <div className={`mt-5 grid gap-5 lg:gap-x-7 ${showMap ? 'lg:grid-cols-[minmax(0,820fr)_minmax(0,484fr)]' : ''}`}>
          {showMap && (
            <div className="plate break-avoid px-4 pb-5 pt-5 sm:px-8 sm:pt-7" data-rep-tradeoff>
              <TradeoffMap rounds={rounds} model={modelMark} meta={bank.rule_meta} unseen={bank.model?.summary?.withdrawn_pct_mean?.boosting ?? null} scheme={scheme} ctx={ctx} still />
            </div>
          )}
          <div className="plate break-avoid flex flex-col px-5 pb-5 pt-6 sm:px-8">
            {rounds.length > 0 ? (
              <table className="rep-table rep-rounds" data-rep-rounds>
                <caption className="sr-only">{V.repRounds}</caption>
                <thead>
                  <tr>
                    <th className="w-8 !pb-3 align-bottom"><span className="sr-only">{T.colN}</span></th>
                    <th className="!pb-3 !text-[19px] !font-semibold !text-ink" aria-hidden>{V.repRounds}</th>
                    <th className="r !pb-3 align-bottom">{V.repGone}</th>
                    <th className="r !pb-3 align-bottom">{V.repHit}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rounds].reverse().map((x) => {
                    const words = [...(x.vsModel ? [t.rounds.vsModel] : []), ...x.asked.map((c) => changeText(bank.rule_meta, c.param, c.to, t, lang)).filter(Boolean) as string[]]
                    return (
                      <tr key={x.n} data-round={x.n}>
                        <td className="font-medium text-ink-mute">{x.n}</td>
                        <td>
                          <span className="font-medium text-ink">{cap(words.join(', ') || t.rounds.profile)}</span>
                          {x.source === 'ready' && <span className="block text-[14px] text-ink-3">{T.ready}</span>}
                        </td>
                        <td className="r font-semibold text-leak">{x.atLeast && x.pct < 99.95 ? '≥' : ''}{pct(x.pct)}%</td>
                        <td className="r text-ink-2">{x.honest != null ? num(x.honest, lang) : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : <p className="text-[16px] leading-snug text-ink-2">{T.noRounds}</p>}

            <div className="mt-auto pt-6">
              <p className="text-[15px] leading-snug text-ink-3">{T.thresholds}{changed.length ? `: ${changed.map((m) => (t.rules.names[m.key] ?? m.title).toLowerCase()).join(', ')}` : ''}</p>
              {changed.length ? changed.map((m) => <p key={m.key} className="mt-0.5 text-[15px] font-medium leading-snug text-ink-2">{V.repThrDiff(fmt(m, profile), fmt(m, lastSet))}</p>)
                : <p className="mt-0.5 text-[15px] font-medium leading-snug text-ink-2">{V.repThrSame}</p>}
              <button className="no-print link-btn mt-2 !text-[15px]" onClick={() => setThr((v) => !v)} aria-expanded={thr} aria-controls="rep-thr" data-rep-thr-btn>
                {thr ? V.repThrHide : V.repThrAll(bank.rule_meta.length)}<ChevronDown size={16} strokeWidth={2} className={thr ? 'rotate-180' : ''} aria-hidden />
              </button>
              <table id="rep-thr" className={`reveal-in rep-table break-avoid mt-3 print:table ${thr ? '' : 'hidden'}`} data-rep-thresholds>
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
            </div>
          </div>
        </div>
      </section>

      {/* схемы: строка без бейджей и полос, три суммы колонками */}
      <section data-rep-schemes aria-labelledby="rep-schemes-h">
        <h2 id="rep-schemes-h" className="rep-h2">{T.schemes}</h2>
        <div className="plate mt-4 px-5 pb-5 pt-6 sm:px-9 sm:pb-7 sm:pt-8">
          <div className="hidden grid-cols-[minmax(0,1fr)_130px_130px_130px] gap-x-4 pb-3 text-[14px] font-medium text-ink-3 sm:grid" aria-hidden>
            <span>{T.colScheme}</span><span className="text-right">{T.colLib}</span><span className="text-right">{T.colHole}</span><span className="text-right">{T.colRematch}</span>
          </div>
          <ul>
            {r.schemes.map((x, i) => (
              <li key={x.key} className={`break-avoid grid gap-x-4 gap-y-2 py-4 sm:grid-cols-[minmax(0,1fr)_130px_130px_130px] ${i ? 'border-t border-line' : 'max-sm:pt-0 sm:border-t sm:border-line'}`} data-scheme={x.key}>
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{x.title}</div>
                  <div className="mt-1 text-[14px] leading-snug text-ink-3">{diffLine(x.diff, t, lang)}</div>
                </div>
                <div className="grid grid-cols-3 gap-x-3 text-[16px] tabular-nums sm:contents">
                  <span className="text-ink-2 sm:text-right"><span className="t-caption block text-ink-3 sm:sr-only">{T.colLib}</span>{kzt(x.lib.base.withdrawn, lang)}</span>
                  <span className="font-semibold text-leak sm:text-right"><span className="t-caption block font-medium text-ink-3 sm:sr-only">{T.colHole}</span>{kzt(x.hole.base.withdrawn, lang)}</span>
                  <span className={`sm:text-right ${x.rematch.withdrawn > 0 ? 'text-ink-2' : 'text-stop'}`}><span className="t-caption block text-ink-3 sm:sr-only">{T.colRematch}</span>{x.rematch.withdrawn > 0 ? kzt(x.rematch.withdrawn, lang) : T.noBypass}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line pt-4 text-[14px] leading-snug text-ink-3">{T.rematchNote}</p>
        </div>
      </section>

      {/* рекомендации и меры рядом */}
      <div className="grid gap-x-7 lg:grid-cols-2">
        <section data-rep-recs aria-labelledby="rep-recs-h">
          <h2 id="rep-recs-h" className="rep-h2">{T.recs}</h2>
          <ol className="mt-6 space-y-7 lg:pr-10" data-rec="top">{top.map((x, i) => <Rec key={i} x={x} i={i} />)}</ol>
          {rest.length > 0 && (
            <>
              <button className="no-print link-btn ml-14 mt-5 sm:ml-16 !text-[16px] max-sm:!whitespace-normal max-sm:text-left" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-controls="rep-rest">
                {more ? T.collapse : T.showMore(rest.length)}<ChevronDown size={16} strokeWidth={2} className={more ? 'rotate-180' : ''} aria-hidden />
              </button>
              {/* на экране свёрнуто, в печати раскрыто всегда */}
              <div id="rep-rest" className={`reveal-in print:block ${more ? '' : 'hidden'}`}>
                <h3 className="mt-6 hidden text-[16px] font-semibold print:block">{T.recsMore}</h3>
                <ol className="mt-6 space-y-7 lg:pr-10" data-rec="rest">{rest.map((x, i) => <Rec key={i} x={x} i={i + 3} />)}</ol>
              </div>
            </>
          )}
        </section>

        <section className="break-avoid" data-rep-measures aria-labelledby="rep-measures-h">
          <h2 id="rep-measures-h" className="rep-h2">{V.repMeasures}</h2>
          <div className="plate mt-4 px-5 pb-5 pt-6 sm:px-8 sm:pb-7">
            <table className="rep-table">
              <thead>
                <tr><th>{T.colMeasure}</th><th className="r">{T.colHole}</th><th className="r">{V.repPrice}</th></tr>
              </thead>
              <tbody>
                {r.measures.map((x) => {
                  const best = !!rec && rec.title.toLowerCase().includes(x.title.toLowerCase())
                  const scenario = x.key === 'hold' || x.key === 'model_hold'
                  const sub = best ? V.repFirst : scenario ? T.scenario : x.key === 'base' ? V.repNow : null
                  return (
                    <tr key={x.key} data-measure={x.key}>
                      <td>
                        <span className={`font-medium ${best ? '!font-semibold' : ''} text-ink`}>{x.title}</span>
                        {sub && <span className={`mt-0.5 block text-[14px] ${best ? 'font-medium text-stop' : 'text-ink-3'}`}>{sub}</span>}
                      </td>
                      <td className={`r ${x.hole_withdrawn > 0 ? 'text-leak' : 'font-semibold text-stop'}`}>{kzt(x.hole_withdrawn, lang)}</td>
                      <td className={`r ${best ? 'font-semibold text-ink' : 'text-ink-2'}`}>{num(x.delayed_per_10k, lang)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-4 text-[14px] leading-snug text-ink-3">{T.priceNote} {bypass > 0 && s.rematch_attempted ? T.measuresNote(num(s.rematch_pct, lang), lb) : ''}</p>
          </div>
        </section>
      </div>

      {/* защита клиента: три числа в ряд; рядом правовая опора */}
      <div className="grid gap-x-7 lg:grid-cols-[minmax(0,820fr)_minmax(0,484fr)]">
        {robust ? (
          <section className="break-avoid" data-rep-client aria-labelledby="rep-client-h">
            <h2 id="rep-client-h" className="rep-h2">{T.client}</h2>
            <p className="mt-2 max-w-[56ch] text-[16px] leading-snug text-ink-3">{T.clientLead}</p>
            <dl className="mt-5 sm:mt-8 sm:grid sm:grid-cols-3 sm:gap-x-8 lg:max-w-[620px]">
              {([
                [T.approx(Math.round(robust.honest.high_per_10k)), T.falseWarn, 'text-ink'],
                [`${pct(robust.victims.first_on_card_silent_pct)}%`, T.firstSilent, 'text-leak'],
                [`${pct(robust.victims.repeat_on_card_covered_pct)}%`, T.repeatCovered, 'text-stop'],
              ] as const).map(([v, d, c]) => (
                <div key={d} className="grid grid-cols-[116px_minmax(0,1fr)] items-baseline gap-x-4 border-t border-line py-3 sm:flex sm:flex-col sm:items-start sm:border-0 sm:py-0">
                  <dt className={`text-[28px] font-medium leading-none tracking-[-0.035em] sm:text-[clamp(30px,3.4vw,40px)] ${c}`}>{v}</dt>
                  <dd className="text-[15px] leading-snug text-ink-2 sm:mt-3">{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : <div />}
        <section className="break-avoid" data-rep-law aria-labelledby="rep-law-h">
          <h2 id="rep-law-h" className="rep-h2">{T.law}</h2>
          <p className="mt-2 max-w-[68ch] text-[16px] leading-[1.45] text-ink-2">{T.lawText}</p>
          <button className="no-print link-btn mt-5 !text-[16px] max-sm:!whitespace-normal max-sm:text-left" onClick={() => setTech((v) => !v)} aria-expanded={tech} aria-controls="rep-tech" data-rep-tech-btn>
            {tech ? T.techHide : T.techShow(r.caveats.length)}<ChevronDown size={16} strokeWidth={2} className={tech ? 'rotate-180' : ''} aria-hidden />
          </button>
        </section>
      </div>

      {/* на экране свёрнуто, в печати раскрыто */}
      <div id="rep-tech" className={`reveal-in plate mt-6 px-5 pb-6 pt-1 sm:px-9 print:block ${tech ? '' : 'hidden'}`} data-rep-tech>
        <h2 className="rep-h3 !mt-5">{T.params}</h2>
        <p className="mt-2 text-[16px] leading-snug text-ink-2">
          {T.paramsText(kzt(r.bank.rules.amount_limit, lang), kzt(r.bank.rules.daily_limit, lang), r.bank.rules.reaction_delay_min,
            Math.round(r.bank.calib.share_student * 100), Math.round(r.bank.calib.share_pensioner * 100))}
        </p>
        <h2 className="rep-h3 !mt-6">{T.caveats}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[16px] leading-snug text-ink-2">
          {r.caveats.map((c) => <li key={c} className="break-avoid">{c}</li>)}
        </ul>
      </div>

      {/* экономика: на экране калькулятор под листом, в PDF одна строка с его текущими значениями */}
      <section className="break-avoid hidden print:block" data-rep-econ-print>
        <h2 className="rep-h2">{t.econ.printH}</h2>
        <p className="mt-2 max-w-[68ch] text-[16px] leading-snug text-ink-2">{(() => {
          const e = econCalc(econ)
          return t.econ.print(kzt(e.saves, lang), paybackText(e.payback, t, lang), kzt(econ.P, lang), kzt(econ.L, lang),
            Math.round(econ.h * 100), Math.round(econ.c * 100), kzt(econ.O, lang), Math.round(econ.o * 100))
        })()}</p>
      </section>
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
