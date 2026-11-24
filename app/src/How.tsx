import { useEffect, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ArrowRight, ArrowUpRight, X } from 'lucide-react'
import { REPO_URL, type Bank, type ClientCheck, type ModelInfo } from './data'
import { More } from './Panel'
import { intl, kztShort, num } from './format'
import { useLang } from './i18n'
import type { EntryFacts } from './Entry'
import { DotGrid } from './ui'

// «Как устроено» (F6, бриф v20): белый лист. Сетка 2x2 по четырём задачам кейса (капс-метка сверху, заголовок снизу,
// в середине живой кусок продукта из настоящих данных), карточка модели с проверкой на невиданных схемах (точками),
// цепочка от симулятора до отчёта, пилот, справочное свёрнуто. Строка про двойник и гипотезы остаётся внизу.

// Пилот и масштаб: формулировки из описания проекта и слайда 9 (правила и агрегаты, контур банка, две недели, 23 банка РК по АРРФР на 01.07.2026)
export function Pilot({ profiles, className = '' }: { profiles?: number; className?: string }) {
  const { t } = useLang()
  const items: string[][] = [...t.pilot.items, [t.pilot.other, t.pilot.otherText(profiles ?? null)]]
  return (
    <ol className={`grid gap-x-6 gap-y-4 sm:grid-cols-2 ${className}`} data-pilot>
      {items.map(([title, d], i) => (
        <li key={title} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3">
          <span className="mt-[3px] grid size-[22px] place-items-center rounded-full text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" aria-hidden>{i + 1}</span>
          <div>
            <div className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{title}</div>
            <p className="mt-0.5 text-[16px] leading-snug text-ink-2">{d}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// Строка правила как на шаге «Атака»: тумблер, имя, значение-чип. Только показ, без действий
function RuleRow({ name, value, on }: { name: string; value: string; on: boolean }) {
  return (
    <div className="flex min-h-10 items-center gap-3">
      <span className="switch pointer-events-none" aria-hidden data-checked={on ? '' : undefined} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium tracking-[-0.01em]">{name}</span>
      <span className="chip pointer-events-none !bg-white/80">{value}</span>
    </div>
  )
}

// Проверка на схемах, которых модель не видела: 100 точек = 100% денег попытки, цветные ушли.
// Так прежние полосы шага «Защита» стали точками, как все данные продукта
function DotRow({ label, v, tone }: { label: string; v: number; tone: 'leak' | 'stop' | 'warn' }) {
  const { lang } = useLang()
  const n = Math.round(v)
  const c = tone === 'leak' ? 'var(--color-leak-dot)' : tone === 'warn' ? 'var(--color-warn-dot)' : 'var(--color-stop-dot)'
  const txt = tone === 'leak' ? 'text-leak' : tone === 'warn' ? 'text-warn' : 'text-stop'
  return (
    <div className="w-max max-w-full">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium text-ink-2">{label}</span>
        <span className={`text-[22px] font-semibold leading-none tracking-[-0.02em] ${txt}`} data-unseen-v>{num(v, lang)}%</span>
      </div>
      <span className="how-dots mt-2" role="img" aria-label={`${label}: ${num(v, lang)}%`}>
        {Array.from({ length: 100 }, (_, i) => <i key={i} style={i < n ? { background: c } : undefined} />)}
      </span>
    </div>
  )
}

function ModelCard({ model }: { model?: ModelInfo }) {
  const { t, lang } = useLang()
  const m = model?.summary?.withdrawn_pct_mean
  if (!model?.trained || !m) return null
  return (
    <section className="nest p-5 sm:p-7" data-unseen aria-labelledby="how-model">
      <p className="t-caps text-ink-3">{t.how.modelCaps}</p>
      <h3 id="how-model" className="t-title mt-2">{t.how.modelTitle}</h3>
      <p className="mt-2 max-w-[62ch] text-[16px] leading-snug text-ink-2">{t.how.modelLead}</p>
      <div className="mt-6 grid gap-x-12 gap-y-6 lg:grid-cols-[500px_minmax(0,1fr)]">
        <div className="space-y-5">
          <DotRow label={t.how.rows.rules} v={m.rules} tone="leak" />
          {m.heuristic != null && <DotRow label={t.how.rows.heuristic} v={m.heuristic} tone="warn" />}
          <DotRow label={t.how.rows.boosting} v={m.boosting} tone="stop" />
          <p className="t-caption text-ink-3">{t.how.dotNote}</p>
        </div>
        {model.benchmark.length > 0 && (
          <table className="w-full self-start text-[15px] tabular-nums" data-bench>
            <thead>
              <tr className="text-left text-ink-3">
                <th className="pb-2 pr-2 font-medium">{t.how.colScheme}</th>
                <th className="pb-2 text-right font-medium">{t.how.cols.rules}</th>
                <th className="hidden pb-2 pl-2 text-right font-medium sm:table-cell">{t.how.cols.heuristic}</th>
                <th className="pb-2 pl-2 text-right font-medium">{t.how.cols.boosting}</th>
              </tr>
            </thead>
            <tbody>
              {model.benchmark.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-2 pr-2">{r.title.split(',')[0]}</td>
                  <td className="py-2 text-right text-leak">{num(r.rules_pct, lang)}%</td>
                  <td className="hidden py-2 pl-2 text-right text-ink-2 sm:table-cell">{num(r.heuristic_pct, lang)}%</td>
                  <td className="py-2 pl-2 text-right font-semibold text-stop">{num(r.boosting_pct, lang)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-5 grid gap-x-10 gap-y-1 border-t border-line pt-4 text-[16px] leading-snug text-ink-2 lg:grid-cols-2">
        {model.algo && model.worlds && model.rows && <p>{t.how.algo(model.algo.replace(/\s*\(.*\)$/, ''), intl(model.worlds, lang), intl(model.rows, lang))}</p>}
        <p data-where>{t.how.where}</p>
      </div>
    </section>
  )
}

// Строка предупреждения клиенту из готового прогона демо-банка; нет файла - короткая фраза словаря
function useWarn(open: boolean) {
  const { lang } = useLang()
  const [w, setW] = useState<{ score: number; text: string; lang: string } | null>(null)
  useEffect(() => {
    if (!open || w?.lang === lang) return
    let alive = true
    fetch(`/scenarios/${lang}/client_check.json`).then((r) => (r.ok ? (r.json() as Promise<ClientCheck>) : null)).catch(() => null).then((cc) => {
      const c = cc?.cases.high
      if (alive && c) setW({ score: Math.round(Math.min(1, Math.max(0, c.risk.score)) * 100), text: c.reasons.slice(0, 2).map((x) => x.text).join(' '), lang })
    })
    return () => { alive = false }
  }, [open, w, lang])
  return w
}

export default function How({ open, bank, facts, onClose, onStep }: { open: boolean; bank: Bank; facts: EntryFacts | null; onClose: () => void; onStep: (s: number) => void }) {
  const { t, lang } = useLang()
  const warn = useWarn(open)
  const names = [t.steps.attack, t.steps.gap, t.steps.defense, t.steps.customer]
  const rm = bank.rule_meta
  const rule = (k: string) => {
    const m = rm.find((x) => x.key === k)
    if (!m) return null
    const v = bank.rules[m.param]
    const on = m.on_param ? bank.rules[m.on_param] !== false : true
    const name = t.rules.names[m.key] ?? m.title
    const value = typeof v !== 'number' ? '-' : m.unit === '₸' ? kztShort(v, lang) : m.key === 'velocity' ? t.rules.perHour(v) : `${v} ${m.unit}`
    return <RuleRow key={k} name={name} value={value} on={on} />
  }
  const above = facts ? facts.tries.filter((p) => p > facts.base).length : 0
  const dots = facts ? facts.tries.map((p) => (p > facts.base ? 'var(--color-leak-dot)' : 'var(--color-dot-neutral)')) : []
  const modelPct = facts?.modelPct

  // живой кусок продукта в каждой плите: строка правила, карта точек, число, строка предупреждения
  const fragment = (step: number) => {
    if (step === 1) return <div className="space-y-0.5">{rule('amount_limit')}{rule('velocity')}</div>
    if (step === 2) return facts
      ? <div><DotGrid colors={dots} cols={40} size={5} gap={8} label={t.how.mapCap(facts.tries.length, above)} fade={false} className="max-w-full" />
        <p className="t-caption mt-2 text-ink-3">{t.how.mapCap(facts.tries.length, above)}</p></div>
      : <div className="h-[60px]" />
    if (step === 3) return (
      <div className="flex items-baseline gap-3">
        <span className="t-num2 text-stop">{modelPct != null ? `${num(modelPct, lang, modelPct < 0.05 ? 0 : 1)}%` : '-'}</span>
        <span className="text-[15px] font-medium leading-snug text-ink-2">{t.how.modelPct}{facts?.rematchPct ? <b className="block font-semibold text-leak">{t.entry.defenseAgain(num(facts.rematchPct, lang))}</b> : null}</span>
      </div>
    )
    return (
      <div className="flex items-start gap-3 rounded-[14px] bg-white/80 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.9),0_1px_2px_rgba(50,40,120,0.06)]">
        <span className="alert-chip !size-9 shrink-0 !rounded-[11px] text-[17px] font-semibold" aria-hidden>!</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-leak">{warn ? t.how.riskOf(warn.score) : t.client.risk}</div>
          <p className="line-clamp-2 text-[15px] leading-snug text-ink-2">{warn?.text || t.how.warnFallback}</p>
        </div>
      </div>
    )
  }

  const chain = [
    { t: t.how.chain.sim, d: t.how.chain.simText(intl(bank.summary.clients, lang), bank.summary.clients, intl(bank.summary.honest_tx, lang), bank.summary.honest_tx) },
    { t: t.how.chain.schemes(bank.presets.length), d: t.how.chain.schemesText },
    { t: t.how.chain.rules(rm.length), d: t.how.chain.rulesText },
    { t: t.how.chain.search, d: t.how.chain.searchText(facts?.evals ?? null) },
    { t: t.how.chain.model, d: t.how.chain.modelText(bank.model?.worlds ?? null) },
    { t: t.how.chain.report, d: t.how.chain.reportText },
  ]
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[rgba(30,24,70,0.38)] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="sheet fixed inset-2 z-50 mx-auto flex max-w-[1180px] flex-col outline-none sm:inset-x-5 sm:inset-y-5
          transition-[opacity,transform] duration-300 ease-[var(--ease-soft)] data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" data-how>
          <div className="flex items-start gap-4 px-5 pb-4 pt-5 sm:px-10 sm:pt-8">
            <div className="min-w-0">
              <Dialog.Title className="t-h1"><span className="text-ink-mute">{t.how.titleMute}</span> {t.how.titleInk}</Dialog.Title>
              <Dialog.Description className="mt-2 text-[16px] leading-snug text-ink-2">{t.how.lead}</Dialog.Description>
            </div>
            <Dialog.Close className="ctl ctl-quiet ml-auto !h-11 !w-11 shrink-0 !px-0" aria-label={t.how.close}><X size={20} strokeWidth={1.5} /></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 sm:px-10" tabIndex={0} aria-label={t.how.contentAria}>
            <ol className="grid gap-2 sm:grid-cols-2 sm:gap-3" data-tasks>
              {t.how.tasks.map((x) => (
                <li key={x.step} className="nest flex min-h-[260px] flex-col p-5 sm:p-6 max-sm:min-h-0" data-task={x.step}>
                  <p className="t-caps text-ink-3">{x.caps}</p>
                  <div className="my-5 sm:my-auto sm:py-5">{fragment(x.step)}</div>
                  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                    <h3 className="t-title max-w-[26ch]">{x.title}</h3>
                    <button className="link-btn" onClick={() => onStep(x.step)} data-task-step={x.step}>{t.how.toStep(names[x.step - 1])}<ArrowRight size={15} strokeWidth={2} aria-hidden /></button>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-3"><ModelCard model={bank.model} /></div>

            <div className="px-2 sm:px-0">
              <section>
                <h3 className="how-h">{t.how.chainTitle}</h3>
                <ol className="how-chain mt-4 grid gap-y-4 sm:grid-cols-3 lg:grid-cols-6" data-chain>
                  {chain.map((c) => (
                    <li key={c.t} className="relative pl-5 pr-3">
                      <span className="how-dot" aria-hidden />
                      <div className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{c.t}</div>
                      <div className="mt-0.5 text-[15px] leading-snug text-ink-3">{c.d}</div>
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h3 className="how-h">{t.how.pilotTitle}</h3>
                <Pilot profiles={bank.calib_presets.length} className="mt-4 lg:grid-cols-4" />
              </section>
            </div>

            {/* справочное свёрнуто: на листе задачи, модель, цепочка и пилот */}
            <div className="mt-6 border-t border-line px-2 sm:px-0" data-how-more>
              <More title={t.how.limits(t.how.limitList.length)}>
                <ul className="space-y-1.5 text-[16px] leading-snug text-ink-2" data-limits>
                  {t.how.limitList.map((l) => <li key={l} className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-ink-3">{l}</li>)}
                </ul>
              </More>
              <More title={t.how.glossary(t.how.words.length)}>
                <dl className="grid gap-x-10 gap-y-2 text-[16px] leading-snug sm:grid-cols-2 lg:grid-cols-3" data-glossary>
                  {t.how.words.map(([w, d]) => <div key={w}><dt className="inline font-semibold text-ink">{w}</dt><dd className="inline text-ink-2"> - {d}</dd></div>)}
                </dl>
              </More>
              <More title={t.how.keysTitle}>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-ink-3 max-lg:hidden" aria-label={t.how.keysAria}>
                  {t.how.keys.map(([k, d]) => <span key={k} className="whitespace-nowrap"><kbd className="mr-1.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-[14px] text-ink-2 shadow-[0_0_0_1px_rgba(14,14,17,0.08)]">{k}</kbd>{d}</span>)}
                </p>
                <p className="mt-3 text-[16px] leading-snug text-ink-3" data-credits>{t.how.credits}</p>
              </More>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line px-2 pt-3 text-[15px] text-ink-3 sm:px-0">
              <span data-synthetic>{t.how.synthetic}</span>
              <span className="lg:ml-auto">Python, FastAPI, scikit-learn, React, three.js</span>
              {REPO_URL && <a className="link-btn" href={REPO_URL} target="_blank" rel="noreferrer" data-repo>{t.how.repo}<ArrowUpRight size={15} strokeWidth={2} aria-hidden /></a>}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
