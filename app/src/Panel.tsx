import NumberFlow from '@number-flow/react'
import { ArrowRight, Check, ChevronDown, Play } from 'lucide-react'
import type { Bank, ClientCheck, Metrics, ModelInfo, Redteam, RunKey } from './data'
import { dec, kzt, plural, RULE_RU, ruleValue } from './format'

// Тайминги NumberFlow по спеке п. 1: 600 мс standard, прозрачность цифр короче; reduced motion библиотека гасит сама
const FLOW = {
  transformTiming: { duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  spinTiming: { duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  opacityTiming: { duration: 280, easing: 'ease-out' },
} as const

// Сумма в тенге для крупных чисел: миллионы с одним знаком, ноль как «0 ₸»
export function Money({ v, unitClass = 'unit' }: { v: number; unitClass?: string }) {
  const zero = Math.round(v / 1e5) === 0
  return (
    <span className="whitespace-nowrap" data-value={zero ? '0 ₸' : `${String(Math.round(v / 1e5) / 10).replace('.', ',')} млн ₸`}>
      <NumberFlow value={zero ? 0 : Math.round(v / 1e5) / 10} locales="ru-RU" {...FLOW}
        format={zero ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
      <span className={zero ? `${unitClass} unit-zero` : unitClass}>{zero ? '₸' : 'млн ₸'}</span>
    </span>
  )
}

export interface Shown { w: number; s: number; att: number }

// Цена для честных: задержанные переводы на 10 тыс., одна цифра после запятой
function Per10k({ v }: { v: number }) {
  return (
    <span className="whitespace-nowrap" data-value={`${dec(Math.round(v * 10) / 10)} на 10 тыс.`}>
      <NumberFlow value={Math.round(v * 10) / 10} locales="ru-RU" {...FLOW} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
    </span>
  )
}

// Два числа одного веса: сколько денег ушло и скольких честных задела защита. Меняются вместе, когда включают меру
export function NumberBlock({ shown, per10k }: { shown: Shown; per10k: number }) {
  const { w, att } = shown
  return (
    <div id="number" className="px-6 pb-2 pt-6 short:px-5 short:pt-4" aria-live="polite">
      <div className="glass grid grid-cols-2">
        <div className="min-w-0 px-5 pb-5 pt-5 short:pb-4 short:pt-4">
          <div className="text-[16px] text-ink-2">Выведено</div>
          <div className={`pair-num mt-2.5 transition-colors duration-300 ${w > 0 ? 'text-leak' : 'text-ink'}`}><Money v={w} /></div>
          <div className="mt-2 whitespace-nowrap text-[15px] text-ink-3">{att > 0 ? <>из {kzt(att)}</> : '\u00a0'}</div>
        </div>
        <div className="min-w-0 px-5 pb-5 pt-5 shadow-[inset_1px_0_0_rgba(255,255,255,0.07)] short:pb-4 short:pt-4">
          <div className="text-[16px] text-ink-2">Задето честных</div>
          <div className="pair-num mt-2.5 text-champagne"><Per10k v={per10k} /></div>
          <div className="mt-2 whitespace-nowrap text-[15px] text-ink-3">задержек на 10 тыс.</div>
        </div>
      </div>
    </div>
  )
}

// До первой атаки чисел нет: вместо пустого «0 ₸» приглашение
export function Invite({ clients, onTour }: { clients: number; onTour?: () => void }) {
  return (
    <div id="number" className="px-6 pb-2 pt-6 short:px-5 short:pt-4">
      <div className="glass px-6 pb-5 pt-5 short:px-5 short:pb-4 short:pt-4">
        <h2 className="text-[22px] font-head leading-tight tracking-head">Банк пока спокоен</h2>
        <p className="mt-2 text-[16px] leading-snug text-ink-2">
          {clients.toLocaleString('ru-RU')} клиентов живут обычный день. Запустите атаку.
        </p>
        {onTour && (
          <button className="mt-3 flex min-h-11 items-center gap-2 text-[16px] font-semibold text-gold-ink hover:text-champagne short:mt-2" onClick={onTour}>
            <Play size={16} strokeWidth={2} aria-hidden />Показать за минуту
          </button>
        )}
      </div>
    </div>
  )
}

// Мобильная полоска: те же два числа, прилипает сверху
export function NumberStrip({ shown, per10k }: { shown: Shown; per10k: number }) {
  return (
    <div className="sticky top-0 z-20 grid h-16 grid-cols-2 items-center gap-3 border-b border-white/[0.06] bg-scene/85 px-4 backdrop-blur-lg lg:hidden" aria-hidden>
      <div className="min-w-0">
        <div className="text-[14px] leading-tight text-ink-2">Выведено</div>
        <div className={`num-prop text-[24px] font-light leading-tight tracking-[-0.02em] ${shown.w > 0 ? 'text-leak' : 'text-ink'}`}><Money v={shown.w} unitClass="unit ml-1 text-[14px]" /></div>
      </div>
      <div className="min-w-0">
        <div className="text-[14px] leading-tight text-ink-2">Задето честных</div>
        <div className="num-prop whitespace-nowrap text-[24px] font-light leading-tight tracking-[-0.02em] text-champagne">{dec(Math.round(per10k * 10) / 10)}<span className="unit ml-1 text-[14px]">на 10 тыс.</span></div>
      </div>
    </div>
  )
}

// Шаг «Клиент»: цена защиты при переводе. Формулировки те же, что на слайде 7 презентации
export function ClientPrice({ check }: { check: { data: ClientCheck | null; robust: ClientCheck['robust'] | null } | undefined }) {
  const r = check?.robust
  const h = r?.honest.high_per_10k ?? check?.data?.stats.honest.high_per_10k
  return (
    <section>
      <BlockTitle>Защита клиента при переводе</BlockTitle>
      {h != null && (
        <div className="mt-4 short:mt-2">
          <div className="pair-num text-ink">около {Math.round(h)}</div>
          <p className="mt-2 text-[16px] leading-snug text-ink-2">ложных предупреждений на&nbsp;10&nbsp;тыс. честных переводов</p>
        </div>
      )}
      {r && (
        <div className="mt-5 grid grid-cols-2 gap-5 border-t border-white/[0.07] pt-4 short:mt-3 short:pt-3">
          <div>
            <div className="num-prop text-[30px] font-light leading-none tracking-[-0.02em] text-leak">{dec(r.victims.first_on_card_silent_pct)}%</div>
            <p className="mt-2 text-[15px] leading-snug text-ink-2">первых жертв на свежей карте модель не видит</p>
          </div>
          <div>
            <div className="num-prop text-[30px] font-light leading-none tracking-[-0.02em] text-stop">{dec(r.victims.repeat_on_card_covered_pct)}%</div>
            <p className="mt-2 text-[15px] leading-snug text-ink-2">следующих жертв предупреждены или карта заморожена</p>
          </div>
        </div>
      )}
      {(h != null || r) && (
        <More title="Как читать эти числа">
          <p className="text-[15px] leading-snug text-ink-2" data-metric-note>Предупреждение не задерживает перевод. Это отдельный счёт от «Задето честных»: там задержки.</p>
          {r && <p className="mt-2 text-[15px] leading-snug text-ink-2" data-first-victim>Граница метода: у свежей карты нет истории, первый перевод на неё останавливают только правила банка. После заявления жертвы карту замораживают, дальше защищает модель.</p>}
        </More>
      )}
    </section>
  )
}

// Слова сцены при первом упоминании: жюри без ML-опыта читает их на шаге «Атака», до первой цифры
const SCENE_WORDS: [string, string][] = [
  ['Дроп', 'человек, отдавший карту мошенникам'],
  ['Слой дропов', 'звено цепочки из таких карт'],
  ['Граница банка', 'здесь деньги покидают банк'],
]
export function SceneWords() {
  return (
    <section data-words>
      <More title="Что на сцене">
        <dl className="space-y-1 text-[15px] leading-snug">
          {SCENE_WORDS.map(([w, d]) => <div key={w}><dt className="inline font-medium text-ink">{w}</dt><dd className="inline text-ink-2"> - {d}</dd></div>)}
        </dl>
      </More>
    </section>
  )
}

// Какую задачу кейса BCC закрывает шаг: формулировки из кейса, те же, что в «Как устроено»
const CASE_TASK = ['Предотвращение финансового мошенничества', 'Предотвращение финансового мошенничества', 'Интеллектуальные механизмы безопасности', 'Выявление подозрительных транзакций', 'Защита клиентов при денежных переводах']
export function CaseTask({ step, onHow, narrow = false }: { step: number; onHow: () => void; narrow?: boolean }) {
  return (
    <button className={`case-task pointer-events-auto z-10 flex items-center gap-2 bg-[rgba(12,11,30,0.9)] px-3.5 py-2 max-lg:mx-3 max-lg:mb-2 max-lg:rounded-xl lg:absolute lg:bottom-5 lg:left-6 ${narrow ? 'lg:max-w-[300px] lg:rounded-2xl' : 'lg:max-w-[calc(100%-48px)] lg:rounded-full'} text-left text-[14px] leading-tight text-ink-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] hover:text-ink-2`}
      onClick={onHow} data-case-task title="Все четыре задачи кейса и где их смотреть">
      <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-gold-ink" aria-hidden />
      <span>Задача кейса: <span className="text-ink-2">{CASE_TASK[step].toLowerCase()}</span></span>
    </button>
  )
}

export function BlockTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[18px] font-head tracking-head text-gold-ink">{children}</h2>
}

// Правила банка: до атаки название и порог, после атаки только «сработало» или «молчит», без счётчиков
export function Rules({ bank, hits, note }: { bank: Bank; hits: Record<string, number> | null; note?: string }) {
  return (
    <section>
      <BlockTitle>Правила банка</BlockTitle>
      <ul className="mt-2 space-y-1.5 short:mt-1 short:space-y-1">
        {bank.rule_meta.map((r) => {
          const h = hits?.[r.key] ?? 0
          return (
            <li key={r.key} title={r.title} className={`flex items-baseline justify-between gap-3 text-[16px] ${hits && !h ? 'text-ink-3' : ''}`}>
              <span className="first-letter:uppercase">{RULE_RU[r.key] ?? r.title}</span>
              {hits
                ? <span className={`shrink-0 ${h ? 'font-medium text-stop' : ''}`}>{h ? 'сработало' : 'молчит'}</span>
                : <span className="shrink-0 text-ink-2">{ruleValue(bank.rules[r.param], r.unit)}</span>}
            </li>
          )
        })}
      </ul>
      {note && <p className="mt-2.5 border-t border-white/[0.07] pt-2.5 text-[15px] leading-snug text-ink-2 short:mt-2 short:pt-2" data-rules-note>{note}</p>}
    </section>
  )
}

// Итог атаки одной строкой: правила сработали, но деньги успели уйти до заморозки
export function caughtNote(m: Metrics) {
  const head = `Замечено ${m.chains_caught} из ${m.chains_total} ${plural(m.chains_total, 'цепочки', 'цепочек', 'цепочек')}`
  if (m.minutes_to_first_freeze == null || !m.withdrawn_kzt) return `${head}.`
  return `${head}, но первая заморозка только через ${dec(Math.round(m.minutes_to_first_freeze))} мин.`
}

const PARAM_RU: Record<string, string> = { victim_chunk_max: 'Платёж жертвы', layers: 'Слоёв дропов', pause_min: 'Пауза дропа' }
export const fmtDiff = (v: string | number, param = '') =>
  param === 'victim_chunk_max' && typeof v === 'number' ? (v >= 10_000_000 ? 'одним переводом' : `частями по ${kzt(v)}`)
    : param === 'pause_min' && typeof v === 'number' ? `${dec(Math.round(v))} мин`
      : typeof v === 'number' && v >= 10_000 ? kzt(v) : String(v).replace('.', ',')

// Что поменял ИИ-мошенник: три строки было -> стало, остальное под «ещё»
export function HoleDiff({ data, searching }: { data: Redteam | null; searching: boolean }) {
  if (!data || searching) return <p className="text-[16px] text-ink-2">ИИ-мошенник перебирает варианты схемы.</p>
  const b = data.best
  const top = b.diff.slice(0, 3)
  const rest = b.diff.slice(3)
  return (
    <section className="hole-card glass px-5 pb-1 pt-4 short:pt-3">
      <BlockTitle>ИИ нашёл дыру</BlockTitle>
      {/* вывод шага одной цифрой: доля денег мимо правил, рядом то, что было в схеме из библиотеки */}
      <div className="mt-3 short:mt-2" data-hole-verdict>
        <div className="pair-num text-leak">{dec(b.pct)}%</div>
        <p className="mt-2 text-[16px] leading-snug text-ink-2">денег уходит мимо правил банка<span className="block text-[15px] text-ink-3">в схеме из библиотеки было {dec(data.base.pct)}%</span></p>
      </div>
      <h3 className="mt-4 border-t border-white/[0.07] pt-3 text-[16px] font-medium text-ink-2 short:mt-3 short:pt-2.5">Что поменял мошенник</h3>
      <ul className="mt-0.5">
        {top.map((d, i) => (
          <li key={d.param} style={{ animationDelay: `${120 + i * 60}ms` }} className="hole-row flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
            <div className="text-[16px] text-ink-2">{PARAM_RU[d.param] ?? d.title[0].toUpperCase() + d.title.slice(1)}</div>
            <div className="ml-auto flex flex-wrap items-baseline justify-end gap-x-1.5 text-right">
              <span className="text-[15px] text-ink-3 line-through decoration-1">{fmtDiff(d.from, d.param)}</span>
              <ArrowRight size={14} strokeWidth={2} className="translate-y-[1px] self-center text-ink-3" aria-label="стало" />
              <span className="num-prop whitespace-nowrap text-[18px] font-semibold leading-tight tracking-[-0.015em] text-leak">{fmtDiff(d.to, d.param)}</span>
            </div>
          </li>
        ))}
      </ul>
      {(rest.length > 0 || b.hints.length > 0) && (
        <More title="ещё">
          <ul className="space-y-1 text-[16px]">
            {rest.map((d) => (
              <li key={d.param} className="flex justify-between gap-3"><span className="text-ink-2">{d.title}</span><span className="shrink-0">{fmtDiff(d.from, d.param)} → {fmtDiff(d.to, d.param)}</span></li>
            ))}
          </ul>
          {b.hints.map((h) => <p key={h} className="mt-2 text-[16px] leading-snug">{h}</p>)}
          <p className="mt-2 text-[16px] text-ink-2">{data.evals} прогонов за {dec(data.seconds)} с, молчит правил: {b.silent_rules.length} из 6.</p>
        </More>
      )}
    </section>
  )
}

export function More({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="flex min-h-11 short:min-h-9 cursor-pointer list-none items-center gap-2 text-[16px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronDown size={18} strokeWidth={1.5} className="transition-transform duration-150 group-open:rotate-180" />{title}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  )
}

// Мера «что если»: строка с галочкой. Пометка только там, где без неё нельзя («сценарий» у задержки)
export function Measure({ on, set, title, note, hint, hotkey, disabled }: { on: boolean; set: (v: boolean) => void; title: string; note?: string; hint?: string; hotkey: string; disabled?: boolean }) {
  // подпись идёт второй строкой внутри кнопки: «сценарий, в РК для переводов не действует» не отрывается от меры
  return (
    <button onClick={() => set(!on)} aria-pressed={on} disabled={disabled} aria-keyshortcuts={hotkey}
      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left short:py-2 transition-[background-color,box-shadow,transform] duration-[160ms] ease-[var(--ease-out)] active:scale-[0.99] disabled:opacity-45
        ${on ? 'rounded-2xl bg-stop-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_var(--color-stop-line),0_0_24px_-8px_rgba(31,207,174,0.55)]' : 'glass glass-hover !rounded-2xl'}`}>
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition-colors duration-150 ${on ? 'border-stop bg-stop text-[#062420]' : 'border-white/25 bg-white/[0.04]'}`}>
        {on && <Check size={14} strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[18px] font-head leading-snug tracking-[-0.01em]">{title}</span>
        {note && <span className="block text-[14px] leading-snug text-ink-3">{note}</span>}
        {hint && <span className="block text-[14px] leading-snug text-ink-3 short:hidden">{hint}</span>}
      </span>
    </button>
  )
}

// Сумма строкой с приглушённой единицей: «4,9» и мельче «млн ₸». Текст тот же, что у kzt()
export function Kzt({ v, unit = 'unit text-[0.72em]' }: { v: number; unit?: string }) {
  const s = kzt(v)
  const i = s.search(/[\u00a0 ]/)
  return i < 0 ? <>{s}</> : <span className="whitespace-nowrap">{s.slice(0, i)}<span className={unit}>{s.slice(i)}</span></span>
}

// Проверка на схемах, которых модель не видела: две полосы одной шкалы. Средняя доля ушедших денег по пяти схемам
export function Unseen({ model, wide = false }: { model?: ModelInfo; wide?: boolean }) {
  const m = model?.summary?.withdrawn_pct_mean
  if (!model?.trained || !m) return null
  const bars = [{ t: 'Только правила', v: m.rules, c: 'bg-leak', n: 'text-leak' }, { t: 'С моделью', v: m.boosting, c: 'bg-stop', n: 'text-stop' }]
  return (
    <section data-unseen>
      <BlockTitle>{wide ? 'Схемы, которых модель не видела' : 'На новых схемах уходит'}</BlockTitle>
      {wide && <p className="mt-1 text-[15px] leading-snug text-ink-2">Учили на четырёх схемах, проверяли на пятой. В среднем уходит:</p>}
      <div className={wide ? 'mt-4 space-y-3' : 'mt-2.5 space-y-2 short:mt-1.5 short:space-y-1'}>
        {bars.map((b) => (
          <div key={b.t} className={`grid items-center gap-3 ${wide ? 'grid-cols-[132px_minmax(0,1fr)_72px]' : 'grid-cols-[128px_minmax(0,1fr)_56px]'}`}>
            <span className="whitespace-nowrap text-[15px] text-ink-2">{b.t}</span>
            <span className={`block overflow-hidden rounded-full bg-white/[0.07] ${wide ? 'h-3.5' : 'h-2.5'}`}><span className={`rep-bar block h-full rounded-full ${b.c}`} style={{ width: `${Math.max(b.v, 1.5)}%` }} /></span>
            <span className={`num-prop text-right font-semibold ${wide ? 'text-[22px]' : 'text-[18px]'} ${b.n}`} data-unseen-v>{dec(b.v)}%</span>
          </div>
        ))}
      </div>
      {wide && model.benchmark.length > 0 && (
        <More title="По каждой схеме">
          <table className="w-full text-[15px]">
            <thead><tr className="text-left text-ink-2"><th className="pb-1 font-normal">Схема, ушло денег</th><th className="pb-1 text-right font-normal">правила</th><th className="pb-1 text-right font-normal">с моделью</th></tr></thead>
            <tbody>
              {model.benchmark.map((r) => (
                <tr key={r.key} className="border-t border-hair">
                  <td className="py-1.5 pr-2">{r.title.split(',')[0]}</td>
                  <td className="py-1.5 text-right text-leak">{dec(r.rules_pct)}%</td>
                  <td className="py-1.5 text-right font-semibold text-stop">{dec(r.boosting_pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </More>
      )}
    </section>
  )
}

export type { RunKey }
