import { memo, useMemo, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { X } from 'lucide-react'
import type { GNode, HonestFeed, HonestRow, Scenario, TxEvent } from './data'
import { clock, intl, num, plainKzt } from './format'
import { useLang, type Dict, type Lang } from './i18n'

// Лента переводов (v15): у каждого перевода атаки есть время, сумма, стороны, риск модели, причина словами и статус.
// Честные переводы, которые задела мера, идут отдельным списком и своим тоном (лаванда, как число «Задето честных»).
// Подписи узлов и причины (why) переводит симулятор, остальное собирает фронт из словаря

type Tone = 'leak' | 'stop' | 'wait' | 'honest'
type Kind = 'cashout' | 'passed' | 'other'
export interface FeedRow { id: string; t: number; amount: number; from: string; to: string; risk: number | null; why: string; tone: Tone; label: string; kind: Kind; honest: boolean }

const TONE: Record<Tone, string> = { leak: 'text-leak', stop: 'text-stop', wait: 'text-ink-2', honest: 'text-warn' }
const mask = (id: number) => `*${1000 + (id % 9000)}`

function party(id: number, nodes: Map<number, GNode>, honest: boolean, t: Dict): string {
  const n = nodes.get(id)
  if (n?.label) return n.label
  const F = t.feed
  if (id < 0) return id === -1 ? F.atm : F.otherBank
  if (honest) return F.client(mask(id))
  if (n?.role === 'drop') return F.drop(mask(id))
  if (n?.role === 'victim') return F.victim(mask(id))
  if (n?.role === 'trader') return F.trader(mask(id))
  return F.client(mask(id))
}

const ruleName = (rule: string, t: Dict) => (t.rules.names[rule] ?? rule).toLowerCase()
const frozenBy = (rule: string, who: string, t: Dict) =>
  rule === 'model' ? t.feed.frozenModel(who) : rule === 'first_hold' ? t.feed.frozenHold(who) : t.feed.frozenRule(who, ruleName(rule, t))

function attackRow(e: TxEvent, i: number, nodes: Map<number, GNode>, t: Dict): FeedRow {
  const st = e.status, F = t.feed
  const [tone, label, kind]: [Tone, string, Kind] =
    st === 'ok' ? (e.kind === 'cashout' ? ['leak', F.cashedOut, 'cashout'] : ['leak', F.passed, 'passed'])
      : st === 'held' ? ['wait', F.held, 'other']
        : st === 'cancelled' ? ['stop', F.cancelled, 'other']
          : st === 'blocked' ? ['stop', F.blocked, 'other']
            : ['stop', F.stopped, 'other']
  const why = st === 'frozen_dst' ? frozenBy(e.rule, F.recipient, t) : st === 'frozen_src' ? frozenBy(e.rule, F.sender, t)
    : st === 'held' ? F.heldWhy : st === 'cancelled' ? F.cancelledWhy
      : st === 'blocked' ? F.blockedWhy(ruleName(e.rule, t)) : e.why || (e.risk != null ? F.clean : '')
  return { id: `a${i}`, t: e.t, amount: e.amount, from: party(e.src, nodes, false, t), to: party(e.dst, nodes, false, t), risk: e.risk ?? null, why, tone, label, kind, honest: false }
}

const honestRow = (e: HonestRow, i: number, nodes: Map<number, GNode>, t: Dict): FeedRow => ({
  id: `h${i}`, t: e.t, amount: e.amount, from: party(e.src, nodes, true, t), to: party(e.dst, nodes, true, t), risk: e.risk, why: e.why, tone: 'honest',
  label: e.status === 'blocked' ? t.feed.blocked : e.status === 'held' ? t.feed.held : t.feed.stopped, kind: 'other', honest: true,
})

// Риск: число и короткая шкала. Красный от рабочего порога модели, лаванда от мягкого (0,35 порога), ниже приглушён
function Risk({ v, thr, honest, t }: { v: number | null; thr: number; honest: boolean; t: Dict }) {
  // честный перевод без оценки остановило правило; у переводов атаки из старого прогона оценки нет вовсе
  if (v == null) return honest ? <span className="text-[14px] text-ink-3">{t.feed.byRule}</span> : null
  const pct = Math.round(v * 100)
  const c = v >= thr ? 'text-leak' : v >= thr * 0.35 ? 'text-warn' : 'text-ink-3'
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${c}`} aria-label={t.feed.riskAria(pct)}>
      <span className="h-1.5 w-9 overflow-hidden rounded-full bg-track" aria-hidden><span className="block h-full rounded-full bg-current" style={{ width: `${Math.max(pct, 4)}%` }} /></span>
      <span className="w-[4ch] text-[15px] font-medium">{pct}%</span>
    </span>
  )
}

// Строка в две линии: узкие экраны
const Row = memo(function Row({ r, thr, t, lang }: { r: FeedRow; thr: number; t: Dict; lang: Lang }) {
  return (
    <li className={`feed-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-2.5 ${r.honest ? 'feed-honest' : ''}`}>
      {/* телефон: время и сумма, ниже стороны целиком, ниже риск, причина и статус; шире 640 px первые три в одну линию */}
      <span className="order-1 self-baseline tabular-nums text-[14px] text-ink-3">{clock(r.t)}</span>
      <span className="order-3 min-w-0 truncate text-[15px] max-sm:col-span-2 sm:order-2">{r.from}<span className="text-ink-3"> → </span>{r.to}</span>
      <span className="order-2 whitespace-nowrap text-right text-[15px] font-medium sm:order-3">{plainKzt(r.amount, lang)}</span>
      <span className="order-4 flex min-w-0 items-center gap-2.5 text-[14px] text-ink-2 sm:col-span-2">
        <Risk v={r.risk} thr={thr} honest={r.honest} t={t} />
        <span className="truncate" title={r.why}>{r.why}</span>
      </span>
      <span className={`order-5 whitespace-nowrap text-right text-[14px] font-semibold ${TONE[r.tone]}`}>{r.label}</span>
    </li>
  )
})

function useFeed(sc: Scenario, log: TxEvent[], honest: HonestFeed | undefined, t: Dict) {
  return useMemo(() => {
    const nodes = new Map(sc.nodes.map((n) => [n.id, n]))
    const attack = log.map((e, i) => attackRow(e, i, nodes, t))
    const hon = (honest?.rows ?? []).map((e, i) => honestRow(e, i, nodes, t))
    const hasRisk = log.some((e) => e.risk != null)
    return { attack, hon, hasRisk }
  }, [sc, log, honest, t])
}

// Таблица не перерисовывается на каждом кадре атаки: строки и порог не меняются, пока не сменили вкладку или фильтр
const Rows = memo(function Rows({ rows, thr, t, lang }: { rows: FeedRow[]; thr: number; t: Dict; lang: Lang }) {
  return (
    <>
      <table className="w-full text-[15px] max-md:hidden">
        <thead className="sticky top-0 z-10 bg-[#110f2a] text-left text-ink-3">
          <tr>{t.feed.cols.map((h, i) => <th key={h} className={`py-2 pr-4 font-normal ${i === 1 ? 'text-right' : ''} ${i === 6 ? '!pr-0 text-right' : ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-line ${r.honest ? 'feed-honest' : ''}`}>
              <td className="py-2 pr-4 tabular-nums text-[14px] text-ink-3">{clock(r.t)}</td>
              <td className="whitespace-nowrap py-2 pr-4 text-right font-medium">{plainKzt(r.amount, lang)}</td>
              <td className="whitespace-nowrap py-2 pr-4">{r.from}</td>
              <td className="whitespace-nowrap py-2 pr-4">{r.to}</td>
              <td className="py-2 pr-4"><Risk v={r.risk} thr={thr} honest={r.honest} t={t} /></td>
              <td className="py-2 pr-4 leading-snug text-ink-2">{r.why}</td>
              <td className={`whitespace-nowrap py-2 text-right font-semibold ${TONE[r.tone]}`}>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">{rows.map((r) => <Row key={r.id} r={r} thr={thr} t={t} lang={lang} />)}</ul>
    </>
  )
})

// Полный список: таблица на широком экране, те же строки в две линии на телефоне
export function FeedDialog({ open, tab, setTab, onClose, sc, log, honest, thr, measure }: {
  open: boolean; tab: 'attack' | 'honest'; setTab: (t: 'attack' | 'honest') => void; onClose: () => void
  sc: Scenario; log: TxEvent[]; honest: HonestFeed | undefined; thr: number; measure: string
}) {
  const { t, lang } = useLang()
  const F = t.feed
  const { attack, hon, hasRisk } = useFeed(sc, log, honest, t)
  const [only, setOnly] = useState<'all' | 'stop' | 'leak'>('all')
  const rows = useMemo(() => (tab === 'honest' ? hon : only === 'all' ? attack : attack.filter((r) => r.tone === only)), [tab, only, attack, hon])
  const total = honest ? honest.total.blocked + honest.total.suspended + honest.total.held : 0
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[rgba(4,4,12,0.84)] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="sheet fixed inset-2 z-50 mx-auto flex max-w-[1180px] flex-col outline-none sm:inset-x-5 sm:inset-y-6 lg:inset-y-10
          transition-[opacity,transform] duration-200 ease-[var(--ease-out)] data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" data-feed-dialog>
          <div className="flex items-start gap-4 px-5 pb-3 pt-5 sm:px-8 sm:pt-6">
            <div className="min-w-0">
              <Dialog.Title className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{F.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-[15px] leading-snug text-ink-2">
                {measure}. {hasRisk ? F.risk(num(Math.round(thr * 100), lang, 0)) : F.noRisk}
              </Dialog.Description>
            </div>
            <Dialog.Close className="ctl ctl-quiet ml-auto !h-11 !w-11 shrink-0 !px-0" aria-label={F.close}><X size={20} strokeWidth={1.5} /></Dialog.Close>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 sm:px-8">
            <ToggleGroup value={[tab]} onValueChange={(v) => v[0] && setTab(v[0] as 'attack' | 'honest')} aria-label={F.which} className="flex rounded-full bg-surface-2 p-1">
              <Toggle value="attack" className="tab-pill">{F.attack}<span className="ml-2 text-ink-3">{attack.length}</span></Toggle>
              <Toggle value="honest" className="tab-pill data-[pressed]:!text-white">{F.honest}<span className="ml-2 text-ink-3">{total}</span></Toggle>
            </ToggleGroup>
            {tab === 'attack' && (
              <ToggleGroup value={[only]} onValueChange={(v) => v[0] && setOnly(v[0] as typeof only)} aria-label={F.status} className="flex gap-1 text-[15px]">
                {(['all', 'stop', 'leak'] as const).map((k) => (
                  <Toggle key={k} value={k} className="h-9 rounded-full px-3 font-medium text-ink-3 hover:text-ink data-[pressed]:bg-surface-2 data-[pressed]:text-ink">{F.filters[k]}</Toggle>
                ))}
              </ToggleGroup>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-8" tabIndex={0} aria-label={F.list}>
            {tab === 'honest' && honest && (
              <p className="feed-honest mb-2 rounded-xl px-3 py-2 text-[15px] leading-snug text-ink-2">
                {F.price(intl(total, lang), intl(honest.watched, lang))}
                {honest.rows.length < total ? F.first(honest.rows.length) : ''}
              </p>
            )}
            <Rows rows={rows} thr={thr} t={t} lang={lang} />
            {rows.length === 0 && <p className="py-6 text-[16px] text-ink-2">{tab === 'honest' ? F.noHonest : F.none}</p>}
          </div>
          <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-[14px] text-ink-3 sm:px-8"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stop-dot" aria-hidden />{F.foot}</p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
