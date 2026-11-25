import { ChevronDown, CircleHelp } from 'lucide-react'
import { Popover } from '@base-ui/react/popover'
import type { Metrics } from './data'
import { num } from './format'
import { useLang, type Dict, type Lang } from './i18n'

export interface Shown { w: number; s: number; att: number }

// Слова сцены при первом упоминании: жюри без ML-опыта читает их на шаге «Атака», до первой цифры
export function SceneWords() {
  const { t } = useLang()
  return (
    <section data-words>
      <More title={t.scene.wordsTitle}>
        <dl className="space-y-1 text-[15px] leading-snug">
          {t.scene.words.map(([w, d]) => <div key={w}><dt className="inline font-medium text-ink">{w}</dt><dd className="inline text-ink-2"> - {d}</dd></div>)}
        </dl>
      </More>
    </section>
  )
}

// v22 (п. 3 CHANGES): «Что на сцене» пилюлей на плите сцены рядом с выбором схемы, слова открываются поповером
export function SceneWordsPill() {
  const { t } = useLang()
  return (
    <Popover.Root>
      <Popover.Trigger className="ctl ctl-scene !h-10 !gap-2 !px-[18px] !text-[14px] !font-medium !text-ink-2" data-words>
        <CircleHelp size={16} strokeWidth={1.75} aria-hidden />{t.scene.wordsTitle}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} align="start" className="z-40">
          <Popover.Popup className="w-[min(420px,calc(100vw-24px))] rounded-[20px] bg-surface p-4 text-ink shadow-[0_1px_2px_rgba(14,14,17,0.06),0_18px_40px_-16px_rgba(14,14,17,0.3)] outline-none
            origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
            <Popover.Title className="text-[15px] font-semibold">{t.scene.wordsTitle}</Popover.Title>
            <dl className="mt-2 space-y-1.5 text-[14.5px] leading-snug">
              {t.scene.words.map(([w, d]) => <div key={w}><dt className="inline font-medium text-ink">{w}</dt><dd className="inline text-ink-2"> - {d}</dd></div>)}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// Какую задачу кейса BCC закрывает шаг: формулировки из кейса, те же, что в «Как устроено» (шаги 0 и 1 - первая задача)
const TASK_OF_STEP = [0, 0, 1, 2, 3]
export function CaseTask({ step, onHow, narrow = false }: { step: number; onHow: () => void; narrow?: boolean }) {
  const { t } = useLang()
  return (
    <button className={`case-task pointer-events-auto z-10 flex items-center gap-2 bg-[rgba(12,11,30,0.9)] px-3.5 py-2 max-lg:mx-3 max-lg:mb-2 max-lg:rounded-xl lg:absolute lg:bottom-5 lg:left-6 ${narrow ? 'lg:max-w-[300px] lg:rounded-2xl' : 'lg:max-w-[calc(100%-48px)] lg:rounded-full'} text-left text-[14px] leading-tight text-white/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:text-white`}
      onClick={onHow} data-case-task title={t.scene.caseTaskTitle}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-dot" aria-hidden />
      <span>{t.scene.caseTask}: <span className="text-white">{t.how.tasks[TASK_OF_STEP[step]].caps.toLowerCase()}</span></span>
    </button>
  )
}

export function BlockTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="t-title text-ink">{children}</h2>
}

// Итог атаки одной строкой: правила сработали, но деньги успели уйти до заморозки
export function caughtNote(m: Metrics, t: Dict, lang: Lang) {
  const head = t.scene.caught(m.chains_caught, m.chains_total)
  if (m.minutes_to_first_freeze == null || !m.withdrawn_kzt) return `${head}.`
  return t.scene.caughtLate(head, num(Math.round(m.minutes_to_first_freeze), lang, 0))
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
