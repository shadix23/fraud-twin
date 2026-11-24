import { Dialog } from '@base-ui/react/dialog'
import { ArrowRight, ArrowUpRight, X } from 'lucide-react'
import { REPO_URL, type Bank } from './data'
import { More, Unseen } from './Panel'
import { plural } from './format'

// «Как устроено» (v15): карта четырёх задач кейса со ссылками на шаги, цепочка от симулятора до отчёта,
// проверка на невиданных схемах и ограничения. Цифры из bank.json, формулировки задач из кейса BCC.

const TASKS = [
  { step: 1, name: 'Атака', task: 'Предотвращение финансового мошенничества', text: 'Схема дропперов против шести правил: сколько уходит и где правила опаздывают.' },
  { step: 4, name: 'Клиент', task: 'Защита клиентов при денежных переводах', text: 'Клиент видит причину риска до отправки и сам отменяет перевод.' },
  { step: 3, name: 'Защита', task: 'Выявление подозрительных транзакций', text: 'У каждого перевода риск, причина и статус. Задетые честные отдельно.' },
  { step: 2, name: 'Дыра', task: 'Интеллектуальные механизмы безопасности', text: 'ИИ-мошенник перебирает 200 вариантов схемы и находит обход правил.' },
] as const

const LIMITS = [
  'Банк синтетический: клиенты и переводы сгенерированы, данных реальных людей нет.',
  'Параметры двойника и пороги правил - гипотезы, их задаёт калибровка под банк.',
  'Модель обучена и проверена только на синтетике. Это проверка на новой схеме, а не качество на данных банка.',
  'Задержка первого перевода - сценарий, в РК для переводов не действует.',
  'Суммы посчитаны за одни сутки атаки в двойнике. Это не прогноз потерь реального банка.',
]

// Словарь: слова интерфейса простым языком, для жюри без опыта в антифроде и ML
const WORDS: [string, string][] = [
  ['Двойник', 'синтетическая копия банка: клиенты, переводы и правила собраны из агрегатов, без данных людей'],
  ['Дроп, дроппер', 'человек, который отдал свою карту мошенникам. На неё приходят деньги жертв и уходят дальше'],
  ['Слой дропов', 'звено цепочки: деньги пересылают с карты на карту, чтобы запутать след'],
  ['Граница банка', 'место, где деньги покидают банк. До неё перевод можно остановить, после неё нет'],
  ['Дыра', 'вариант атаки, который проходит мимо правил этого банка'],
  ['Граф переводов', 'карта связей: кто кому переводит. Модель смотрит на связи карты получателя, а не на один перевод'],
  ['Крипто P2P', 'покупка криптовалюты с рук у частного продавца. После неё след денег теряется'],
  ['Веер', 'деньги одной жертвы расходятся сразу на несколько карт дропов'],
  ['Карусель', 'деньги гоняют по кругу через много счетов, чтобы скрыть источник'],
]

// Пилот и масштаб: формулировки из описания проекта и слайда 9 (правила и агрегаты, контур банка, две недели, 23 банка РК по АРРФР на 01.07.2026)
export function Pilot({ profiles, className = '' }: { profiles?: number; className?: string }) {
  const items: [string, string][] = [
    ['От банка', 'Правила антифрода и агрегаты базы. Данные клиентов не нужны.'],
    ['Где работает', 'В контуре банка.'],
    ['Через две недели', 'Отчёт: дыры, меры и их цена для честных.'],
    ['Другой банк', `Новый профиль, код тот же${profiles ? `: в шапке ${profiles} ${plural(profiles, 'готовый', 'готовых', 'готовых')}` : ''}. Любой из 23 банков РК (АРРФР, 01.07.2026).`],
  ]
  return (
    <ol className={`grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 ${className}`} data-pilot>
      {items.map(([t, d]) => (
        <li key={t} className="border-t border-white/[0.09] pt-3">
          <div className="text-[16px] font-medium leading-snug">{t}</div>
          <p className="mt-1 text-[15px] leading-snug text-ink-2">{d}</p>
        </li>
      ))}
    </ol>
  )
}

const KEYS: [string, string][] = [['→', 'главное действие шага'], ['Пробел', 'пауза'], ['End', 'в конец атаки'], ['1 и 2', 'меры на шаге «Защита»'], ['K', 'шаг «Клиент»'], ['Esc', 'назад']]

export default function How({ open, bank, onClose, onStep }: { open: boolean; bank: Bank; onClose: () => void; onStep: (s: number) => void }) {
  const chain = [
    { t: 'Событийный симулятор', d: `${bank.summary.clients.toLocaleString('ru-RU')} ${plural(bank.summary.clients, 'клиент', 'клиента', 'клиентов')}, ${bank.summary.honest_tx.toLocaleString('ru-RU')} ${plural(bank.summary.honest_tx, 'перевод', 'перевода', 'переводов')} за сутки` },
    { t: `${bank.presets.length} схем дропперов`, d: 'типологии АФМ и СМИ Казахстана' },
    { t: `${bank.rule_meta.length} правил банка`, d: 'лимиты, скорость, возраст счёта, общий телефон' },
    { t: 'Эволюционный поиск', d: '200 прогонов на одну дыру' },
    { t: 'Бустинг на графе переводов', d: bank.model?.worlds ? `обучен на ${bank.model.worlds} синтетических банках` : 'риск перевода по сети получателя' },
    { t: 'Отчёт краш-теста', d: 'дыры, меры и их цена' },
  ]
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[rgba(4,4,12,0.84)] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="sheet fixed inset-2 z-50 mx-auto flex max-w-[1180px] flex-col outline-none sm:inset-x-5 sm:inset-y-5
          transition-[opacity,transform] duration-200 ease-[var(--ease-out)] data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" data-how>
          <div className="flex items-start gap-4 px-5 pb-3 pt-5 sm:px-10 sm:pt-7">
            <div className="min-w-0">
              <Dialog.Title className="text-[30px] font-light leading-[1.1] tracking-[-0.025em] sm:text-[36px]">Как устроен <span className="gold-text font-normal">Fraud Twin</span></Dialog.Title>
              <Dialog.Description className="mt-2 text-[16px] leading-snug text-ink-2">Четыре задачи кейса BCC и шаг с ответом на каждую.</Dialog.Description>
            </div>
            <Dialog.Close className="ctl ctl-quiet ml-auto !h-11 !w-11 shrink-0 !px-0" aria-label="Закрыть"><X size={20} strokeWidth={1.5} /></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-10" tabIndex={0} aria-label="Как устроено, содержание">
            <ol className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4" data-tasks>
              {TASKS.map((x) => (
                <li key={x.step} className="flex flex-col border-t border-white/[0.09] pb-3 pt-4">
                  <h3 className="text-[18px] font-head leading-snug tracking-head">{x.task}</h3>
                  <p className="mt-2 flex-1 text-[15px] leading-snug text-ink-2">{x.text}</p>
                  <button className="link-btn mt-3 self-start" onClick={() => onStep(x.step)} data-task-step={x.step}>Шаг «{x.name}»<ArrowRight size={15} strokeWidth={2} aria-hidden /></button>
                </li>
              ))}
            </ol>

            <h3 className="how-h">От агрегатов банка до отчёта</h3>
            <ol className="how-chain mt-4 grid gap-y-4 sm:grid-cols-3 lg:grid-cols-6" data-chain>
              {chain.map((c) => (
                <li key={c.t} className="relative pl-5 pr-3 lg:pl-0 lg:pt-5">
                  <span className="how-dot" aria-hidden />
                  <div className="text-[16px] font-medium leading-snug">{c.t}</div>
                  <div className="mt-1 text-[14px] leading-snug text-ink-3">{c.d}</div>
                </li>
              ))}
            </ol>

            <div className="mt-7 grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <Unseen model={bank.model} wide />
              </div>
              <div>
                <h3 className="text-[18px] font-head tracking-head text-gold-ink">Пилот в банке и масштаб</h3>
                <Pilot profiles={bank.calib_presets.length} className="mt-3 lg:!grid-cols-2" />
              </div>
            </div>

            {/* v19: справочное свёрнуто, на листе остаются задачи, цепочка, проверка и пилот */}
            <div className="mt-6 border-t border-white/[0.09]" data-how-more>
              <More title={`Ограничения: ${LIMITS.length}`}>
                <ul className="space-y-1.5 text-[15px] leading-snug text-ink-2" data-limits>
                  {LIMITS.map((l) => <li key={l} className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-ink-3">{l}</li>)}
                </ul>
              </More>
              <More title={`Словарь: ${WORDS.length} слов`}>
                <dl className="grid gap-x-10 gap-y-2 text-[15px] leading-snug sm:grid-cols-2 lg:grid-cols-3" data-glossary>
                  {WORDS.map(([w, d]) => <div key={w}><dt className="inline font-medium text-ink">{w}</dt><dd className="inline text-ink-2"> - {d}</dd></div>)}
                </dl>
              </More>
              <More title="Клавиши и источники">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-ink-3 max-lg:hidden" aria-label="Клавиши демо">
                  {KEYS.map(([k, t]) => <span key={k} className="whitespace-nowrap"><kbd className="mr-1.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[14px] text-ink-2 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">{k}</kbd>{t}</span>)}
                </p>
                <p className="mt-3 text-[14px] leading-snug text-ink-3" data-credits>3D-модели сцены: «ATM» - J-Toastie, «server rack» - Jeremy Eyring (CC-BY 3.0, poly.pizza); остальные CC0: Poly Haven, Quaternius. Список в CREDITS.md.</p>
              </More>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-white/[0.09] pt-3 text-[14px] text-ink-3">
              <span data-synthetic>Банк синтетический, параметры двойника - гипотезы.</span>
              <span className="lg:ml-auto">Python, FastAPI, scikit-learn, React, three.js</span>
              {REPO_URL && <a className="link-btn" href={REPO_URL} target="_blank" rel="noreferrer" data-repo>Код на GitHub<ArrowUpRight size={15} strokeWidth={2} aria-hidden /></a>}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
