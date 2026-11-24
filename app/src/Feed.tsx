import { memo, useMemo, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { ArrowRight, X } from 'lucide-react'
import type { GNode, HonestFeed, HonestRow, Scenario, TxEvent } from './data'
import { clock, dec, plainKzt, RULE_RU } from './format'
import { BlockTitle } from './Panel'

// Лента переводов (v15): у каждого перевода атаки есть время, сумма, стороны, риск модели, причина словами и статус.
// Честные переводы, которые задела мера, идут отдельным списком и своим тоном (лаванда, как число «Задето честных»).

type Tone = 'leak' | 'stop' | 'wait' | 'honest'
export interface FeedRow { id: string; t: number; amount: number; from: string; to: string; risk: number | null; why: string; tone: Tone; label: string; honest: boolean }

const TONE: Record<Tone, string> = { leak: 'text-leak', stop: 'text-stop', wait: 'text-ink-2', honest: 'text-champagne' }
const mask = (id: number) => `*${1000 + (id % 9000)}`

function party(id: number, nodes: Map<number, GNode>, honest: boolean): string {
  const n = nodes.get(id)
  if (n?.label) return n.label
  if (id < 0) return id === -1 ? 'Банкомат' : 'Другой банк'
  if (honest) return `Клиент ${mask(id)}`
  if (n?.role === 'drop') return `Дроп ${mask(id)}`
  if (n?.role === 'victim') return `Жертва ${mask(id)}`
  if (n?.role === 'trader') return `Криптообменник ${mask(id)}`
  return `Клиент ${mask(id)}`
}

const frozenBy = (rule: string, who: string) =>
  rule === 'model' ? `Карта ${who} заморожена моделью` : rule === 'first_hold' ? `Карта ${who} заморожена за время задержки`
    : `Карта ${who} заморожена правилом «${RULE_RU[rule] ?? rule}»`

function attackRow(e: TxEvent, i: number, nodes: Map<number, GNode>): FeedRow {
  const st = e.status
  const [tone, label]: [Tone, string] =
    st === 'ok' ? ['leak', e.kind === 'cashout' ? 'выведен' : 'прошёл']
      : st === 'held' ? ['wait', 'задержан']
        : st === 'cancelled' ? ['stop', 'отменён клиентом']
          : st === 'blocked' ? ['stop', 'отклонён']
            : ['stop', 'остановлен']
  const why = st === 'frozen_dst' ? frozenBy(e.rule, 'получателя') : st === 'frozen_src' ? frozenBy(e.rule, 'отправителя')
    : st === 'held' ? 'Первый перевод новому получателю' : st === 'cancelled' ? 'За время задержки клиент отменил перевод'
      : st === 'blocked' ? `Правило «${RULE_RU[e.rule] ?? e.rule}»` : e.why || (e.risk != null ? 'Модель не видит признаков дропа' : '')
  return { id: `a${i}`, t: e.t, amount: e.amount, from: party(e.src, nodes, false), to: party(e.dst, nodes, false), risk: e.risk ?? null, why, tone, label, honest: false }
}

const HONEST_LABEL: Record<HonestRow['status'], string> = { blocked: 'отклонён', suspended: 'остановлен', held: 'задержан' }
const honestRow = (e: HonestRow, i: number, nodes: Map<number, GNode>): FeedRow => ({
  id: `h${i}`, t: e.t, amount: e.amount, from: party(e.src, nodes, true), to: party(e.dst, nodes, true), risk: e.risk, why: e.why, tone: 'honest', label: HONEST_LABEL[e.status], honest: true,
})

// Риск: число и короткая шкала. Красный от рабочего порога модели, лаванда от мягкого (0,35 порога), ниже приглушён
function Risk({ v, thr, honest }: { v: number | null; thr: number; honest: boolean }) {
  // честный перевод без оценки остановило правило; у переводов атаки из старого прогона оценки нет вовсе
  if (v == null) return honest ? <span className="text-[14px] text-ink-3">правило</span> : null
  const pct = Math.round(v * 100)
  const c = v >= thr ? 'text-leak' : v >= thr * 0.35 ? 'text-champagne' : 'text-ink-3'
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${c}`} aria-label={`Риск ${pct}%`}>
      <span className="h-1.5 w-9 overflow-hidden rounded-full bg-white/10" aria-hidden><span className="block h-full rounded-full bg-current" style={{ width: `${Math.max(pct, 4)}%` }} /></span>
      <span className="w-[4ch] text-[15px] font-medium">{pct}%</span>
    </span>
  )
}

// Строка в две линии: панель справа и узкие экраны
// extra: на невысоком экране панель показывает меньше строк (две до 1000 px по высоте, одну до 820 px)
const Row = memo(function Row({ r, thr, extra = '' }: { r: FeedRow; thr: number; extra?: string }) {
  return (
    <li className={`feed-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-2.5 ${r.honest ? 'feed-honest' : ''} ${extra}`}>
      {/* телефон: время и сумма, ниже стороны целиком, ниже риск, причина и статус; шире 640 px первые три в одну линию */}
      <span className="order-1 self-baseline font-mono text-[14px] text-ink-3">{clock(r.t)}</span>
      <span className="order-3 min-w-0 truncate text-[15px] max-sm:col-span-2 sm:order-2">{r.from}<span className="text-ink-3"> → </span>{r.to}</span>
      <span className="order-2 whitespace-nowrap text-right text-[15px] font-medium sm:order-3">{plainKzt(r.amount)}</span>
      <span className="order-4 flex min-w-0 items-center gap-2.5 text-[14px] text-ink-2 sm:col-span-2">
        <Risk v={r.risk} thr={thr} honest={r.honest} />
        <span className="truncate" title={r.why}>{r.why}</span>
      </span>
      <span className={`order-5 whitespace-nowrap text-right text-[14px] font-semibold ${TONE[r.tone]}`}>{r.label}</span>
    </li>
  )
})

export function useFeed(sc: Scenario, log: TxEvent[], honest: HonestFeed | undefined) {
  return useMemo(() => {
    const nodes = new Map(sc.nodes.map((n) => [n.id, n]))
    const attack = log.map((e, i) => attackRow(e, i, nodes))
    const hon = (honest?.rows ?? []).map((e, i) => honestRow(e, i, nodes))
    const hasRisk = log.some((e) => e.risk != null)
    return { attack, hon, hasRisk }
  }, [sc, log, honest])
}

// Панель шага «Защита»: счётчики и три последних перевода, остальное в полном списке
export function FeedPanel({ sc, log, honest, t, all, thr, onOpen }: {
  sc: Scenario; log: TxEvent[]; honest: HonestFeed | undefined; t: number; all: boolean; thr: number; onOpen: (tab: 'attack' | 'honest') => void
}) {
  const { attack } = useFeed(sc, log, honest)
  // сколько переводов уже случилось: строки перерисовываются только когда это число меняется
  let n = attack.length
  if (!all) { n = 0; while (n < attack.length && attack[n].t <= t) n++ }
  const total = honest ? honest.total.blocked + honest.total.suspended + honest.total.held : 0
  return (
    <section aria-label="Лента переводов">
      <div className="flex items-baseline justify-between gap-3">
        <BlockTitle>Переводы</BlockTitle>
        <button className="link-btn" onClick={() => onOpen('attack')}>Все переводы<ArrowRight size={15} strokeWidth={2} aria-hidden /></button>
      </div>
      <Ticker rows={attack} n={n} thr={thr} />
      {honest && (
        <button className="feed-honest mt-1 flex w-full items-baseline justify-between gap-3 rounded-xl px-3 py-2 text-left text-[15px] hover:bg-[rgba(176,124,255,0.14)]" onClick={() => onOpen('honest')}>
          <span className="text-ink-2">Честных задето за сутки</span>
          <span className="whitespace-nowrap font-semibold text-champagne">{total.toLocaleString('ru-RU')} из {honest.watched.toLocaleString('ru-RU')}</span>
        </button>
      )}
    </section>
  )
}

const Ticker = memo(function Ticker({ rows, n, thr }: { rows: FeedRow[]; n: number; thr: number }) {
  const seen = rows.slice(0, n)
  const stopped = seen.filter((r) => r.tone === 'stop').length
  const last = seen.slice(-3).reverse()
  return (
    <>
      {/* три счётчика в строку: «внутри банка» отвечает на вопрос, почему переводы прошли, а выведено 0 */}
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[15px] text-ink-2" data-feed-count>
        {n === 0 ? 'Атака ещё не началась.' : <>
          <span className="whitespace-nowrap"><span className="font-semibold text-stop">{stopped}</span> остановлено</span>
          <span className="whitespace-nowrap" title="Перевод прошёл между картами, но деньги не вышли из банка"><span className="font-semibold text-ink">{seen.filter((r) => r.label === 'прошёл').length}</span> внутри банка</span>
          <span className="whitespace-nowrap"><span className="font-semibold text-leak">{seen.filter((r) => r.label === 'выведен').length}</span> выведено</span>
        </>}
      </p>
      <ul className="mt-1 divide-y divide-white/[0.06]" data-feed="panel">
        {last.map((r, i) => <Row key={r.id} r={r} thr={thr} extra={i === 2 ? 'mid:hidden' : i === 1 ? 'short:hidden' : ''} />)}
      </ul>
    </>
  )
})

// Таблица не перерисовывается на каждом кадре атаки: строки и порог не меняются, пока не сменили вкладку или фильтр
const Rows = memo(function Rows({ rows, thr }: { rows: FeedRow[]; thr: number }) {
  return (
    <>
      <table className="w-full text-[15px] max-md:hidden">
        <thead className="sticky top-0 z-10 bg-[#110f2a] text-left text-ink-3">
          <tr>{['Время', 'Сумма', 'От кого', 'Кому', 'Риск', 'Причина', 'Статус'].map((h, i) => <th key={h} className={`py-2 pr-4 font-normal ${i === 1 ? 'text-right' : ''} ${i === 6 ? '!pr-0 text-right' : ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-white/[0.06] ${r.honest ? 'feed-honest' : ''}`}>
              <td className="py-2 pr-4 font-mono text-[14px] text-ink-3">{clock(r.t)}</td>
              <td className="whitespace-nowrap py-2 pr-4 text-right font-medium">{plainKzt(r.amount)}</td>
              <td className="whitespace-nowrap py-2 pr-4">{r.from}</td>
              <td className="whitespace-nowrap py-2 pr-4">{r.to}</td>
              <td className="py-2 pr-4"><Risk v={r.risk} thr={thr} honest={r.honest} /></td>
              <td className="py-2 pr-4 leading-snug text-ink-2">{r.why}</td>
              <td className={`whitespace-nowrap py-2 text-right font-semibold ${TONE[r.tone]}`}>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-white/[0.06] md:hidden">{rows.map((r) => <Row key={r.id} r={r} thr={thr} />)}</ul>
    </>
  )
})

// Полный список: таблица на широком экране, те же строки в две линии на телефоне
export function FeedDialog({ open, tab, setTab, onClose, sc, log, honest, thr, measure }: {
  open: boolean; tab: 'attack' | 'honest'; setTab: (t: 'attack' | 'honest') => void; onClose: () => void
  sc: Scenario; log: TxEvent[]; honest: HonestFeed | undefined; thr: number; measure: string
}) {
  const { attack, hon, hasRisk } = useFeed(sc, log, honest)
  const [only, setOnly] = useState<'all' | 'stop' | 'leak'>('all')
  const rows = useMemo(() => (tab === 'honest' ? hon : only === 'all' ? attack : attack.filter((r) => r.tone === only)), [tab, only, attack, hon])
  const total = honest ? honest.total.blocked + honest.total.suspended + honest.total.held : 0
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[rgba(4,4,12,0.72)] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="sheet fixed inset-2 z-50 mx-auto flex max-w-[1180px] flex-col outline-none sm:inset-x-5 sm:inset-y-6 lg:inset-y-10
          transition-[opacity,transform] duration-200 ease-[var(--ease-out)] data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" data-feed-dialog>
          <div className="flex items-start gap-4 px-5 pb-3 pt-5 sm:px-8 sm:pt-6">
            <div className="min-w-0">
              <Dialog.Title className="text-[26px] font-head leading-tight tracking-head">Переводы</Dialog.Title>
              <Dialog.Description className="mt-1 text-[15px] leading-snug text-ink-2">
                {measure}. {hasRisk ? <>Риск ставит модель по картам отправителя и получателя за сутки до перевода, рабочий порог {dec(Math.round(thr * 100))}%.</> : 'Риск по переводам появится после пересборки прогонов.'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="ctl ctl-quiet ml-auto !h-11 !w-11 shrink-0 !px-0" aria-label="Закрыть"><X size={20} strokeWidth={1.5} /></Dialog.Close>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 sm:px-8">
            <ToggleGroup value={[tab]} onValueChange={(v) => v[0] && setTab(v[0] as 'attack' | 'honest')} aria-label="Какие переводы" className="flex rounded-full bg-white/[0.05] p-1">
              <Toggle value="attack" className="tab-pill">Атака<span className="ml-2 text-ink-3">{attack.length}</span></Toggle>
              <Toggle value="honest" className="tab-pill data-[pressed]:!text-champagne">Честные, задетые мерой<span className="ml-2 text-ink-3">{total}</span></Toggle>
            </ToggleGroup>
            {tab === 'attack' && (
              <ToggleGroup value={[only]} onValueChange={(v) => v[0] && setOnly(v[0] as typeof only)} aria-label="Статус" className="flex gap-1 text-[15px]">
                {([['all', 'все'], ['stop', 'остановлены'], ['leak', 'прошли']] as const).map(([k, t]) => (
                  <Toggle key={k} value={k} className="h-9 rounded-full px-3 font-medium text-ink-3 hover:text-ink data-[pressed]:bg-white/[0.07] data-[pressed]:text-ink">{t}</Toggle>
                ))}
              </ToggleGroup>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-8" tabIndex={0} aria-label="Список переводов">
            {tab === 'honest' && honest && (
              <p className="feed-honest mb-2 rounded-xl px-3 py-2 text-[15px] leading-snug text-ink-2">
                Это цена меры: {total.toLocaleString('ru-RU')} из {honest.watched.toLocaleString('ru-RU')} честных переводов за сутки без атаки.
                {honest.rows.length < total ? ` Показаны первые ${honest.rows.length}.` : ''}
              </p>
            )}
            <Rows rows={rows} thr={thr} />
            {rows.length === 0 && <p className="py-6 text-[16px] text-ink-2">{tab === 'honest' ? 'Эта мера не задела ни одного честного перевода.' : 'Таких переводов нет.'}</p>}
          </div>
          <p className="flex items-center gap-2 border-t border-white/[0.07] px-5 py-3 text-[14px] text-ink-3 sm:px-8"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stop-scene" aria-hidden />Синтетический банк. Роли «жертва» и «дроп» известны только в двойнике, банк их не видит.</p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
