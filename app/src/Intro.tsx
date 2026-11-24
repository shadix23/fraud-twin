import { motion } from 'motion/react'
import { ArrowRight, Play } from 'lucide-react'

// Вход и показ без докладчика (v14): одна фраза, цифра рынка с источником, две кнопки.
// Тексты сверены с презентацией v4: слайд 2 (112 млрд ₸, АФМ РК, 11.07.2026) и слайд 8 («находим дыру раньше мошенников»).

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function Landing({ clients, onStart, onTour, onHow }: { clients: number; onStart: () => void; onTour: () => void; onHow: () => void }) {
  return (
    <motion.div className="intro absolute inset-0 z-30 flex flex-col overflow-y-auto" data-intro
      initial={false} exit={{ opacity: 0, transition: { duration: reduced() ? 0 : 0.2, ease: [0.4, 0, 1, 1] } }}>
      <div data-cover="left" className="mt-auto w-full max-w-[680px] px-5 pb-6 pt-3 sm:px-8 sm:pb-8 lg:max-w-[min(680px,44vw)] lg:pb-20 lg:pl-12 lg:pr-0 short:pb-10">
        <h2 className="intro-title">Краш-тест антифрода. ИИ находит дыру в правилах банка <span className="gold-text">раньше мошенников</span></h2>
        <p className="mt-3 max-w-[560px] text-[16px] leading-snug text-ink-2 sm:mt-4 sm:text-[17px] short:mt-3 short:text-[16px]" data-intro-lead>Банк получает отчёт: где дыра, какая мера её закрывает и скольких честных клиентов она заденет.</p>
        <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-2 sm:mt-6 short:mt-4">
          <div className="intro-num text-leak">112<span className="unit">млрд ₸</span></div>
          <p className="pb-1 text-[16px] leading-snug text-ink-2">прошло через карты дропперов в Казахстане<span className="block text-[15px] text-ink-3">АФМ РК, 11.07.2026<span className="max-sm:hidden">. Дроппер отдаёт свою карту мошенникам под вывод денег</span></span></p>
        </div>
        <div className="mt-6 flex flex-col gap-3 whitespace-nowrap sm:mt-8 sm:flex-row sm:flex-wrap short:mt-6">
          <button className="ctl ctl-main !justify-between gap-4 !px-6 short:!text-[16px]" onClick={onStart}>
            Запустить краш-тест<ArrowRight size={20} strokeWidth={1.75} className="next" aria-hidden />
          </button>
          <button className="ctl ctl-scene !px-5 short:!text-[16px]" onClick={onTour}>
            <Play size={17} strokeWidth={2} aria-hidden />Показать за минуту
          </button>
        </div>
        <p className="mt-4 text-[15px] leading-snug text-ink-3 sm:mt-6 short:mt-4">
          Синтетический банк, он же двойник: {clients.toLocaleString('ru-RU')} клиентов, данных реальных людей нет.<span className="sm:block"> Параметры двойника - гипотезы.</span>
        </p>
        <button className="link-btn mt-2" onClick={onHow}>Четыре задачи кейса и как это устроено<ArrowRight size={15} strokeWidth={2} aria-hidden /></button>
      </div>
    </motion.div>
  )
}

// Автопоказ: те же шаги, что и вручную, с короткой подписью. Последняя стадия открывает отчёт без подписи
export const TOUR = [
  { id: 'attack', step: 'Атака', text: 'Деньги жертв идут через карты дропов, подставных студентов, в крипту. Правила ловят все цепочки, но поздно: часть денег уже ушла.', task: 'Предотвращение финансового мошенничества' },
  { id: 'hole', step: 'Дыра', text: 'ИИ играет за мошенника: перебирает 200 вариантов схемы против правил этого банка.', task: 'Интеллектуальные механизмы безопасности' },
  { id: 'holeRun', step: 'Защита', text: 'Сначала найденная атака без защиты: платежи частями, одно звено подставных карт вместо двух. Уходит уже две трети денег.', task: 'Интеллектуальные механизмы безопасности' },
  { id: 'defense', step: 'Защита', text: 'Теперь с моделью: она смотрит на связи карты получателя, а не на один перевод. Та же атака выводит ноль, а честных задето почти столько же.', task: 'Выявление подозрительных транзакций' },
  { id: 'client', step: 'Клиент', text: 'Та же модель проверяет получателя до перевода. Клиент видит причину и сам отменяет перевод.', task: 'Защита клиентов при денежных переводах' },
  { id: 'report', step: 'Отчёт', text: '', task: '' },
] as const
export type TourId = (typeof TOUR)[number]['id']
const STEPS = ['Атака', 'Дыра', 'Защита', 'Клиент', 'Отчёт']

export function TourCaption({ i, onStop }: { i: number; onStop: () => void }) {
  const s = TOUR[i]
  if (!s.text) return null
  const n = STEPS.indexOf(s.step) + 1
  return (
    <div className="tour-card fixed inset-x-2 bottom-2 z-50 px-5 pb-4 pt-3 text-ink lg:absolute lg:inset-x-auto lg:bottom-6 lg:left-6 lg:w-[460px]" data-tour={s.id}>
      <div className="flex items-center gap-3">
        <span className="text-[18px] font-head tracking-head text-gold-ink">{s.step}</span>
        <span className="text-[15px] text-ink-3">шаг {n} из {STEPS.length}</span>
        <button className="-mr-2 ml-auto flex min-h-10 items-center gap-2 rounded-full px-3 text-[15px] font-semibold text-ink-2 hover:bg-white/[0.07] hover:text-ink" onClick={onStop} aria-keyshortcuts="Escape">
          Дальше сам<kbd className="rounded-md bg-white/[0.06] px-1.5 font-mono text-[14px] font-normal text-ink-3 shadow-[0_0_0_1px_rgba(255,255,255,0.12)] max-lg:hidden">Esc</kbd>
        </button>
      </div>
      <div key={s.id} className="step-in" role="status">
        <p className="mt-1 text-[17px] leading-snug">{s.text}</p>
        <p className="mt-2 text-[15px] leading-snug text-ink-3">Задача кейса: {s.task.toLowerCase()}</p>
      </div>
    </div>
  )
}
