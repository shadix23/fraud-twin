import { useLang } from './i18n'

// Вход и показ без докладчика (v14). Подписи автопоказа в словаре (tour), шаг и задача кейса по ключу

// Автопоказ: те же шаги, что и вручную, с короткой подписью. Последняя стадия открывает отчёт без подписи
export const TOUR = [
  { id: 'attack', step: 'attack', task: 0 },
  { id: 'hole', step: 'gap', task: 1 },
  { id: 'holeRun', step: 'defense', task: 1 },
  { id: 'defense', step: 'defense', task: 2 },
  { id: 'client', step: 'customer', task: 3 },
  { id: 'report', step: 'report', task: -1 },
] as const
export type TourId = (typeof TOUR)[number]['id']
const STEPS = ['attack', 'gap', 'defense', 'customer', 'report'] as const

export function TourCaption({ i, onStop }: { i: number; onStop: () => void }) {
  const { t } = useLang()
  const s = TOUR[i]
  if (s.id === 'report') return null
  const n = STEPS.indexOf(s.step) + 1
  return (
    <div key={s.id} className="tour-card tour-in fixed inset-x-2 bottom-2 z-50 px-5 pb-4 pt-3 text-ink lg:absolute lg:inset-x-auto lg:bottom-6 lg:left-6 lg:w-[460px]" data-tour={s.id}>
      <div className="flex items-center gap-3">
        <span className="text-[18px] font-semibold tracking-[-0.02em] text-brand">{t.steps[s.step]}</span>
        <span className="text-[15px] text-ink-3">{t.tour.stepOf(n, STEPS.length)}</span>
        <button className="-mr-2 ml-auto flex min-h-10 items-center gap-2 rounded-full px-3 text-[15px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink" onClick={onStop} aria-keyshortcuts="Escape">
          {t.tour.stop}<kbd className="rounded-md bg-surface-2 px-1.5 tabular-nums text-[14px] font-normal text-ink-3 shadow-[0_0_0_1px_rgba(14,14,17,0.08)] max-lg:hidden">Esc</kbd>
        </button>
      </div>
      <div key={s.id} className="step-in" role="status">
        <p className="mt-1 text-[17px] leading-snug">{t.tour[s.id]}</p>
        <p className="mt-2 text-[14px] leading-snug text-ink-3">{t.scene.caseTask}: {t.how.tasks[s.task].caps.toLowerCase()}</p>
      </div>
    </div>
  )
}
