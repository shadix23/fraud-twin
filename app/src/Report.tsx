import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronDown, Download, Printer } from 'lucide-react'
import { loadClientCheck, loadReport, type ClientCheck, type Ctx, type Report as R } from './data'
import { dec, kzt, plainKzt, plural, RULE_RU } from './format'
import { fmtDiff, Kzt } from './Panel'
import { Pilot } from './How'

// Отчёт краш-теста для фрод-директора: белый лист под печать A4
export default function Report({ ctx, onBack }: { ctx: Ctx; onBack: () => void }) {
  const [rep, setRep] = useState<R | null>(null)
  const [source, setSource] = useState<'api' | 'json'>('json')
  const [err, setErr] = useState<string | null>(null)
  // блок «Защита клиента при переводе»: честные цифры экрана клиента есть в готовом файле демо-банка
  const [robust, setRobust] = useState<ClientCheck['robust'] | null>(null)
  useEffect(() => { let alive = true; setRobust(null); loadClientCheck('student_crypto', ctx).then((r) => alive && setRobust(r.robust)); return () => { alive = false } }, [ctx])

  const load = useCallback(() => {
    setErr(null); setRep(null)
    loadReport(ctx).then((r) => { setRep(r.data); setSource(r.source) }).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [ctx])
  useEffect(() => { load() }, [load])
  useEffect(() => { window.scrollTo(0, 0) }, [])

  const download = () => {
    if (!rep) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = `fraud-twin-report-${rep.bank.preset ?? 'custom'}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="app-glow relative isolate min-h-screen bg-scene pb-16 text-ink print:bg-white print:pb-0">
      <div className="no-print mx-auto flex max-w-[840px] flex-wrap items-center gap-2 px-4 pb-4 pt-6 sm:px-0">
        <button className="ctl ctl-quiet" onClick={onBack}><ArrowLeft size={18} strokeWidth={1.5} />Назад к двойнику</button>
        <div className="ml-auto flex gap-2">
          <button className="ctl ctl-quiet" onClick={download} disabled={!rep}><Download size={18} strokeWidth={1.5} />JSON</button>
          <button className="ctl ctl-main" onClick={() => window.print()} disabled={!rep}><Printer size={18} strokeWidth={1.5} />Печать или PDF</button>
        </div>
      </div>

      {err && (
        <div className="mx-auto max-w-[640px] p-6" role="alert">
          <div className="text-[18px] font-semibold text-leak">Отчёт не собрался</div>
          <p className="mt-1 text-[16px] text-ink-2">{err}</p>
          <button className="ctl ctl-quiet mt-4" onClick={load}>Собрать ещё раз</button>
        </div>
      )}
      {!rep && !err && (
        <div className="mx-auto max-w-[840px] glass p-10 text-[18px] text-ink-2" aria-live="polite">
          Собираем отчёт: 5 схем, ИИ-мошенник ищет дыры против правил и против модели. Живой пересчёт занимает до 20 секунд.
        </div>
      )}
      {rep && <Sheet r={rep} source={source} robust={robust} />}
      {/* под листом, только на экране: что нужно, чтобы получить такой отчёт по своему банку */}
      {rep && (
        <section className="no-print mx-auto mt-6 w-full max-w-[840px] px-5 sm:px-12" data-rep-pilot>
          <h2 className="text-[22px] font-head tracking-head text-deep">Такой отчёт по вашему банку</h2>
          <Pilot className="mt-3 lg:!grid-cols-2" />
        </section>
      )}
    </div>
  )
}

function Sheet({ r, source, robust }: { r: R; source: 'api' | 'json'; robust: ClientCheck['robust'] | null }) {
  const s = r.summary
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, ' года')
  const rec = r.recommendations.find((x) => x.kind === 'measure')
  const [more, setMore] = useState(false)
  const [tech, setTech] = useState(false)
  const base = r.measures.find((x) => x.key === 'base'), mod = r.measures.find((x) => x.key === 'model')
  const bypass = r.schemes.filter((x) => x.rematch.withdrawn > 0).length
  const top = r.recommendations.slice(0, 3), rest = r.recommendations.slice(3)
  const Rec = ({ x, i }: { x: R['recommendations'][number]; i: number }) => (
    <li className="break-avoid grid grid-cols-[28px_minmax(0,1fr)] gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[linear-gradient(160deg,#7a3cf0,#6d3cf5_55%,#4b22c9)] text-[14px] font-semibold tracking-[-0.02em] text-gold-on shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_0_1px_#5a2bc0]">{String(i + 1).padStart(2, '0')}</span>
      <div>
        <div className="text-[18px] font-semibold">{x.title}</div>
        <p className="mt-0.5 text-[16px] leading-relaxed text-ink-2">{x.text}</p>
        {x.where && x.where.length > 0 && <p className="text-[14px] text-ink-3">Схемы: {x.where.join(', ')}.</p>}
      </div>
    </li>
  )
  const H2 = 'mt-12 flex items-center gap-2.5 text-[22px] font-head tracking-head text-deep before:block before:h-[2px] before:w-5 before:rounded-full before:bg-money'

  return (
    <article className="print-sheet mx-auto w-full max-w-[840px] glass !rounded-[28px] px-5 py-8 text-ink sm:px-12 sm:py-12">
      <header className="relative pb-5">
        {/* светящаяся лента индиго -> фиолет под шапкой отчёта: 2 px металла, сохраняется в печати */}
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[linear-gradient(90deg,#4361ee,#9000f8_30%,#c48bff_55%,#9000f8_78%,#b03fc4)]" aria-hidden />
        {/* двухтоновый заголовок (tailark dusk): первая фраза чернилами, продолжение приглушено */}
        <h1 className="text-[36px] font-light leading-[1.1] tracking-[-0.03em] text-deep">Отчёт краш-теста антифрода. <span className="text-ink-3">{r.bank.name}</span></h1>
        <p className="mt-3 text-[16px] text-ink-2">{date}. {r.bank.clients.toLocaleString('ru-RU')} {plural(r.bank.clients, 'клиент', 'клиента', 'клиентов')}, {r.bank.honest_tx.toLocaleString('ru-RU')} {plural(r.bank.honest_tx, 'честный перевод', 'честных перевода', 'честных переводов')} за сутки</p>
        <p className="mt-1 flex items-center gap-2 text-[16px] text-ink-2"><span className="h-2 w-2 shrink-0 rotate-45 bg-money" aria-hidden />Синтетический банк, реальных данных клиентов нет. Параметры двойника - гипотезы</p>
      </header>

      {/* вывод одной фразой: жюри и фрод-директор читают его первым, цифры ниже его раскрывают */}
      <p className="mt-9 text-[22px] font-normal leading-snug tracking-[-0.015em] text-deep" data-rep-verdict>
        Правила банка пропускают {dec(s.hole_pct)}% денег в найденных атаках. Модель на графе переводов закрывает эти дыры, {bypass > 0
          ? <>но мошенник подстраивается: после нового поиска уходит {kzt(s.rematch_withdrawn)} вместо {kzt(s.hole_withdrawn)}. Поэтому краш-тест повторяют после каждой смены защиты.</>
          : <>и новый поиск обхода не нашёл. Краш-тест всё равно повторяют после каждой смены защиты.</>}
      </p>
      <p className="mt-3 text-[16px] leading-snug text-ink-2">
        ИИ-мошенник нашёл дыру в {s.holes_found} из {s.schemes} схем. За сутки атаки мошенники пытались вывести {kzt(s.attempted)}. Все суммы посчитаны в синтетическом банке.
      </p>
      {/* первая страница для фрод-директора: что уходит сейчас, что с мерой, что после нового поиска */}
      <div className="rep-top break-avoid mt-5 grid gap-y-5 sm:grid-cols-3" data-rep-top>
        <div>
          <div className="flex items-start text-[16px] leading-snug text-ink-2 sm:min-h-[44px]"><span className="rep-step">1</span><span>Сейчас уходит</span></div>
          <div className="rep-num rep-three mt-2 text-leak"><Kzt v={s.hole_withdrawn} unit="unit text-[0.42em] tracking-[-0.01em]" /></div>
          <div className="mt-2 text-[15px] leading-snug text-ink-3">через найденные дыры, {dec(s.hole_pct)}% от попытки</div>
        </div>
        <div>
          <div className="flex items-start text-[16px] leading-snug text-ink-2 sm:min-h-[44px]"><span className="rep-step">2</span><span>Те же атаки, с моделью</span></div>
          <div className="rep-num rep-three mt-2 text-stop" style={{ animationDelay: '90ms' }}>{mod ? <Kzt v={mod.hole_withdrawn} unit="unit text-[0.42em] tracking-[-0.01em]" /> : '-'}</div>
          <div className="mt-2 text-[15px] leading-snug text-ink-3">{mod && base ? <>{mod.hole_withdrawn === 0 ? 'ноль, потому что эти атаки искали против правил, а не против модели. ' : ''}Задето честных {dec(mod.delayed_per_10k)} на 10 тыс. вместо {dec(base.delayed_per_10k)}</> : ''}</div>
        </div>
        <div>
          <div className="flex items-start text-[16px] leading-snug text-ink-2 sm:min-h-[44px]"><span className="rep-step">3</span><span>Мошенник ищет заново</span></div>
          <div className="rep-num rep-three mt-2 text-leak" style={{ animationDelay: '180ms' }}><Kzt v={s.rematch_withdrawn} unit="unit text-[0.42em] tracking-[-0.01em]" /></div>
          <div className="mt-2 text-[15px] leading-snug text-ink-3">{bypass > 0 ? <>честный итог: уже против модели ИИ-мошенник находит обход в {bypass} из {s.schemes} схем</> : 'обхода модели ИИ-мошенник не нашёл'}</div>
        </div>
      </div>

      <h2 className={H2}>Три главные рекомендации</h2>
      <ol className="mt-3 space-y-4" data-rec="top">{top.map((x, i) => <Rec key={i} x={x} i={i} />)}</ol>

      {robust && (
        <section className="break-avoid" data-rep-client>
          <h2 className={H2}>Защита клиента при переводе</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-ink-2">
            Та же модель оценивает карту получателя до отправки. Клиент видит причину риска словами и сам отменяет перевод, деньги ещё у него.
          </p>
          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <div className="num-prop text-[30px] font-light leading-none tracking-[-0.02em]">около {Math.round(robust.honest.high_per_10k)}</div>
              <p className="mt-2 text-[15px] leading-snug text-ink-2">ложных предупреждений на 10 тыс. честных переводов</p>
            </div>
            <div>
              <div className="num-prop text-[30px] font-light leading-none tracking-[-0.02em] text-leak">{dec(robust.victims.first_on_card_silent_pct)}%</div>
              <p className="mt-2 text-[15px] leading-snug text-ink-2">первая жертва на свежей карте проходит молча: у карты ещё нет истории</p>
            </div>
            <div>
              <div className="num-prop text-[30px] font-light leading-none tracking-[-0.02em] text-stop">{dec(robust.victims.repeat_on_card_covered_pct)}%</div>
              <p className="mt-2 text-[15px] leading-snug text-ink-2">следующие жертвы предупреждены или карта уже заморожена</p>
            </div>
          </div>
          <p className="mt-4 text-[14px] leading-snug text-ink-3">
            Правовая опора: Закон РК «О платежах и платёжных системах», ст. 25-1. Банк вправе приостановить перевод не более чем на пять рабочих дней и сообщает клиенту причины (п. 3-1). Банк, перечисливший деньги получателю из базы Антифрод-центра, возмещает их клиенту (п. 7).
          </p>
        </section>
      )}

      <h2 className={H2}>Дыры по схемам, за сутки атаки</h2>
      {/* телефон: легенда строкой; шире 640 px легенда становится шапкой трёх колонок, подписи в строках не повторяются */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-ink-2 sm:hidden" aria-hidden>
        <span className="flex items-center gap-2"><Tick kind="lib" inline />схема из библиотеки</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-5 bg-leak" />дыра ИИ</span>
        <span className="flex items-center gap-2"><Tick kind="rematch" inline />с моделью, новый поиск</span>
      </div>
      <div className="mt-3 hidden grid-cols-[minmax(0,1fr)_312px] items-end gap-6 text-[14px] text-ink-2 sm:grid">
        <span>Схема и что в ней поменял ИИ-мошенник</span>
        <div className="grid grid-cols-3 gap-2">
          <span className="flex items-center gap-1.5 whitespace-nowrap"><Tick kind="lib" inline />библиотека</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="h-2.5 w-4 shrink-0 bg-leak" />дыра ИИ</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><span className="shrink-0"><Tick kind="rematch" inline /></span>с моделью</span>
        </div>
      </div>
      <ul className="mt-2 sm:mt-1.5">
        {r.schemes.map((x) => {
          const h = x.hole.base
          const att = h.attempted || 1
          const p = (v: number) => Math.min(100, (100 * v) / att)
          return (
            <li key={x.key} className="break-avoid border-t border-hair py-4 sm:py-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_312px] sm:items-center sm:gap-6">
                <div className="min-w-0 text-[18px] font-head tracking-[-0.01em]">{x.title}</div>
                <div>
                  <div className="relative h-3 bg-page">
                    <div className="h-full" style={{ width: `${p(h.withdrawn)}%` }}><div className="rep-bar h-full bg-leak" /></div>
                    <span className="absolute -top-1" style={{ left: `${p(x.lib.base.withdrawn)}%` }}><Tick kind="lib" /></span>
                    <span className="absolute -top-px" style={{ left: `clamp(7px, ${p(x.rematch.withdrawn)}%, calc(100% - 7px))` }}><Tick kind="rematch" /></span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[14px]">
                    <span><span className="block text-ink-3 sm:sr-only">библиотека</span>{kzt(x.lib.base.withdrawn)}</span>
                    <span className="font-semibold text-leak"><span className="block font-normal text-ink-3 sm:sr-only">дыра ИИ</span>{kzt(h.withdrawn)}</span>
                    <span><span className="block text-ink-3 sm:sr-only">с моделью</span>{x.rematch.withdrawn > 0 ? kzt(x.rematch.withdrawn) : 'обхода нет'}</span>
                  </div>
                </div>
              </div>
              {/* что поменял мошенник: строкой во всю ширину под названием и полосой, так строка схемы ниже */}
              <div className="mt-2 text-[14px] leading-snug text-ink-2 sm:mt-1.5">{diffLine(x.diff)}</div>
            </li>
          )
        })}
      </ul>

      <h2 className={H2}>Какие меры закрывают дыры и какой ценой</h2>
      <table className="break-avoid mt-3 w-full text-[16px]">
        <thead>
          <tr className="border-b border-line text-left text-ink-2">
            <th className="py-2 pr-2 font-normal">Мера</th>
            <th className="py-2 px-2 text-right font-normal">Дыры ИИ</th>
            <th className="hidden py-2 px-2 text-right font-normal sm:table-cell">Библиотека</th>
            <th className="py-2 pl-2 text-right font-normal">Задержано на 10 тыс.</th>
          </tr>
        </thead>
        <tbody>
          {r.measures.map((x) => {
            const best = !!rec && rec.title.toLowerCase().includes(x.title.toLowerCase())
            // задержка первого перевода - сценарий для обсуждения: строка приглушена и подписана
            const scenario = x.key === 'hold' || x.key === 'model_hold'
            return (
              <tr key={x.key} className={`border-b border-hair ${best ? 'bg-stop-bg font-semibold' : ''} ${scenario ? 'text-ink-2' : ''}`}>
                <td className="py-2.5 pr-2">{x.title}{best ? ' (рекомендуем)' : ''}{scenario && <span className="block text-[14px] text-ink-3">сценарий, в РК для переводов не действует</span>}</td>
                <td className={`py-2.5 px-2 text-right ${x.hole_withdrawn > 0 ? 'text-leak' : 'text-stop'}`}>{kzt(x.hole_withdrawn)}</td>
                <td className="hidden py-2.5 px-2 text-right sm:table-cell">{kzt(x.lib_withdrawn)}</td>
                <td className="py-2.5 pl-2 text-right">{dec(x.delayed_per_10k)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[14px] text-ink-2">Цена: прогон всего честного трафика двойника без атаки, сколько обычных переводов задержано.</p>

      {rest.length > 0 && (
        <>
          <h2 className={H2}>Остальные рекомендации</h2>
          <button className="no-print link-btn mt-1 !text-[16px]" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-controls="rep-rest">
            {more ? 'Свернуть' : `Показать ещё ${rest.length}`}<ChevronDown size={16} strokeWidth={2} className={more ? 'rotate-180' : ''} aria-hidden />
          </button>
          {/* на экране свёрнуто, в печати и PDF раскрыто всегда */}
          <ol id="rep-rest" className={`mt-3 space-y-4 print:block ${more ? '' : 'hidden'}`} data-rec="rest">{rest.map((x, i) => <Rec key={i} x={x} i={i + 3} />)}</ol>
        </>
      )}

      {/* на экране свёрнуто: отчёт короче на экран, пометка о синтетике и гипотезах стоит в шапке. В печати и PDF раскрыто всегда */}
      <div className="no-print mt-12 border-t border-hair pt-4">
        <button className="link-btn !text-[16px]" onClick={() => setTech((v) => !v)} aria-expanded={tech} aria-controls="rep-tech" data-rep-tech-btn>
          {tech ? 'Свернуть параметры и ограничения' : `Параметры двойника и ограничения: ${r.caveats.length} ${plural(r.caveats.length, 'пункт', 'пункта', 'пунктов')}`}<ChevronDown size={16} strokeWidth={2} className={tech ? 'rotate-180' : ''} aria-hidden />
        </button>
      </div>
      <div id="rep-tech" className={`print:block ${tech ? '' : 'hidden'}`} data-rep-tech>
        <h2 className={H2.replace('mt-12', 'mt-5 print:mt-12')}>Параметры двойника</h2>
      <p className="mt-2 text-[16px] leading-relaxed text-ink-2">
        Лимит перевода {plainKzt(r.bank.rules.amount_limit)}, суточный лимит {plainKzt(r.bank.rules.daily_limit)},
        заморозка через {r.bank.rules.reaction_delay_min} мин после сигнала.
        Студентов {Math.round(r.bank.calib.share_student * 100)}%, пенсионеров {Math.round(r.bank.calib.share_pensioner * 100)}%.
        Правила: {Object.keys(RULE_RU).slice(0, 6).map((k) => RULE_RU[k]).join(', ')}.
      </p>

      <h2 className={H2.replace('mt-12', 'mt-10')}>Ограничения</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[16px] text-ink-2">
        {r.caveats.map((c) => <li key={c} className="break-avoid">{c}</li>)}
      </ul>

      </div>

      <footer className="mt-10 border-t border-money pt-3 text-[14px] text-ink-3">
        Fraud Twin. {source === 'api' ? 'Живой прогон симулятора' : 'Готовый прогон симулятора'}, {date}. Краш-тест на синтетическом банке, а не аудит реальной системы.
      </footer>
    </article>
  )
}

// Отметки на шкале различаются формой, а не только цветом: читается в ч/б печати
function Tick({ kind, inline = false }: { kind: 'lib' | 'rematch'; inline?: boolean }) {
  const shift = inline ? '' : '-translate-x-1/2'
  return kind === 'lib'
    ? <span className={`block h-5 w-[3px] bg-deep ${shift}`} />
    : <span className={`block h-[14px] w-[14px] rounded-full border-[2.5px] border-deep bg-paper ${shift}`} />
}

// Что поменял мошенник, одной строкой: только три главных изменения, без повторов единиц
function diffLine(diff: { param: string; title: string; from: string | number; to: string | number }[]) {
  const num = (v: string | number) => (typeof v === 'number' ? dec(Math.round(v)) : String(v))
  return diff.slice(0, 3).map((d) =>
    d.param === 'victim_chunk_max' ? (typeof d.from === 'number' && d.from < 10_000_000 && typeof d.to === 'number'
      ? `платёж жертвы частями по ${kzt(d.from)} → ${kzt(d.to)}` : `платёж жертвы ${fmtDiff(d.to, d.param)}`)
      : d.param === 'layers' ? `слоёв дропов ${num(d.from)} → ${num(d.to)}`
        : d.param === 'pause_min' ? `пауза дропа ${num(d.from)} → ${num(d.to)} мин`
          : `${d.title} ${fmtDiff(d.from, d.param)} → ${fmtDiff(d.to, d.param)}`).join(', ')
}
