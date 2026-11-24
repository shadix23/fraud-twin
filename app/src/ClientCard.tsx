import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRightLeft, CalendarDays, Check, Link2, Lock, PhoneCall, Send, ShieldAlert, Smartphone, Sparkles, UserPlus, Users, X, type LucideIcon } from 'lucide-react'
import type { ClientButton, ClientCase, ClientCheck, ClientLevel } from './data'
import { plainKzt } from './format'

// Шаг «Клиент» (v14): одна карточка-предупреждение поверх сцены, без корпуса телефона.
// До отправки модель смотрит на карту получателя; тексты и причины берём из ответа как есть.

type Stage = 'checking' | 'result' | 'after'
export interface PhoneState { level: ClientLevel | null; after: string | null }

const ICON: Record<string, LucideIcon> = {
  young: CalendarDays, phone: Smartphone, strangers: Users, transit: ArrowRightLeft,
  chain: Link2, new_recipient: UserPlus, blocked: Lock,
}
const FALLBACK: ClientCase = {
  transfer: { amount: 579000, time: '11:24', new_recipient: true, recipient: { name: 'Получатель', phone_mask: '+7 7** *** ** **', card_mask: '**** ****' } },
  risk: { score: 0, level: 'low', basis: 'no_history' }, reasons: [],
  screen: { title: 'Перевод отправлен', subtitle: '', buttons: [{ id: 'done', label: 'Готово', primary: true }] },
}
const DEFAULT_BUTTONS: Record<ClientLevel, ClientButton[]> = {
  high: [{ id: 'cancel', label: 'Отменить перевод', primary: true }, { id: 'call', label: 'Позвонить в банк' }, { id: 'send_anyway', label: 'Всё равно отправить', quiet: true }],
  medium: [{ id: 'send', label: 'Продолжить перевод', primary: true }, { id: 'cancel', label: 'Отменить' }],
  low: [{ id: 'done', label: 'Готово', primary: true }],
  blocked: [{ id: 'call', label: 'Позвонить в банк', primary: true }, { id: 'done', label: 'Закрыть' }],
}
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function ClientCard({ data, auto, falsePer10k, onState, onClose }: {
  data: ClientCheck | null | undefined // undefined - ещё грузим
  auto?: boolean // автопоказ: клиент сам отменяет перевод через несколько секунд
  falsePer10k?: number
  onState: (s: PhoneState) => void
  onClose: () => void // назад к шагу «Защита»
}) {
  const [stage, setStage] = useState<Stage>(() => (reduced() ? 'result' : 'checking'))
  const [after, setAfter] = useState<string | null>(null)
  const [waited, setWaited] = useState(false)
  const c: ClientCase = (data && data.cases[data.demo]) || FALLBACK
  const level = c.risk.level
  const tr = c.transfer
  const ready = data !== undefined || waited
  const primary = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)

  // короткая проверка получателя: до 1 с ждём ответ API, затем решение
  useEffect(() => {
    if (stage !== 'checking') return
    const w = setTimeout(() => setWaited(true), 1000)
    return () => clearTimeout(w)
  }, [stage])
  useEffect(() => {
    if (stage !== 'checking' || !ready) return
    const id = setTimeout(() => setStage('result'), 800)
    return () => clearTimeout(id)
  }, [stage, ready])
  useEffect(() => {
    if (stage === 'result' && ready) onState({ level, after: null })
  }, [stage, ready, level, onState])
  useEffect(() => { if (stage !== 'checking') primary.current?.focus({ preventScroll: true }) }, [stage])
  useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])

  const press = (b: ClientButton) => {
    if (b.id === 'done') { onClose(); return }
    setAfter(b.id); setStage('after'); onState({ level, after: b.id })
  }
  // автопоказ: даём прочитать причины и нажимаем главную кнопку, как это сделал бы клиент
  const pressRef = useRef(press)
  pressRef.current = press
  useEffect(() => {
    if (!auto || stage !== 'result' || !ready || level === 'low') return
    const list = c.screen.buttons?.length ? c.screen.buttons : DEFAULT_BUTTONS[level]
    const b = list.find((x) => x.id === 'cancel') ?? list.find((x) => x.primary)
    if (!b) return
    const id = setTimeout(() => pressRef.current(b), reduced() ? 1500 : 4200)
    return () => clearTimeout(id)
  }, [auto, stage, ready, level, c])
  const restart = () => { setAfter(null); setWaited(false); setStage(reduced() ? 'result' : 'checking'); onState({ level: null, after: null }) }

  const showResult = (stage === 'result' && ready) || stage === 'after'

  return (
    <div ref={root} tabIndex={-1} role="group" aria-label="Что видит клиент: проверка перевода"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      className="pointer-events-auto fixed inset-x-0 bottom-[73px] top-0 z-40 flex flex-col items-center overflow-y-auto bg-scene-0 px-4 py-4 outline-none lg:justify-center
        lg:pointer-events-none lg:absolute lg:inset-auto lg:bottom-0 lg:right-6 lg:top-[64px] lg:z-20 lg:items-end lg:overflow-visible lg:bg-transparent lg:p-0">
      <p className="mb-2.5 mt-auto flex items-center gap-1.5 text-[14px] leading-tight text-mist lg:hidden" data-synthetic><span className="h-1.5 w-1.5 rounded-full bg-stop-scene shadow-[0_0_8px_#1fcfae]" aria-hidden />Синтетический банк, экран клиента при переводе</p>
      <motion.div data-cover="right" className="client-card phone pointer-events-auto relative w-full max-w-[392px] rounded-[26px] px-5 pb-4 pt-4 text-ink lg:max-w-[432px] lg:px-6 lg:pb-5 lg:pt-5 tight:lg:max-w-[404px] tight:lg:px-5 tight:lg:pb-4 tight:lg:pt-4"
        initial={reduced() ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
        <div className="flex items-center gap-3 text-[15px] text-ink-3">
          <span className="min-w-0 flex-1 truncate">{tr.recipient.name}, карта {tr.recipient.card_mask.replace('**** ', '')}</span>
          {!showResult && <span className="shrink-0 font-semibold text-ink">{plainKzt(tr.amount)}</span>}
          <button className="-mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-white/10 hover:text-ink lg:hidden" onClick={onClose} aria-label="Назад к защите" aria-keyshortcuts="K Escape">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        {!showResult && (
          <p className="flex items-center gap-2.5 py-6 text-[17px] text-ink-2" aria-live="polite"><span className="client-spin" aria-hidden />Проверяем получателя...</p>
        )}
        {showResult && stage === 'result' && (level === 'low'
          ? <Final icon={<Check size={22} strokeWidth={2.25} />} tone="neutral" title={c.screen.title || 'Перевод отправлен'}>
              <button ref={primary} className="client-cta" onClick={onClose}>{c.screen.buttons?.[0]?.label ?? 'Готово'}</button>
            </Final>
          : <Warning c={c} level={level} primary={primary} onPress={press} />)}
        {stage === 'after' && after && <After id={after} text={data?.after[after]} onRestart={restart} />}
      </motion.div>
      {falsePer10k != null && <p className="mt-3 text-center text-[15px] leading-snug text-ink-2 lg:hidden">Ложных предупреждений: около {Math.round(falsePer10k)} на 10 тыс. честных переводов</p>}
      <span className="mb-auto lg:hidden" aria-hidden />
    </div>
  )
}

function Warning({ c, level, primary, onPress }: { c: ClientCase; level: ClientLevel; primary: React.RefObject<HTMLButtonElement | null>; onPress: (b: ClientButton) => void }) {
  const buttons = c.screen.buttons?.length ? c.screen.buttons : DEFAULT_BUTTONS[level]
  const firstPrimary = buttons.findIndex((b) => b.primary)
  const main = buttons.filter((b) => !b.quiet)
  const quiet = buttons.filter((b) => b.quiet)
  const risk = Math.round(Math.min(1, Math.max(0, c.risk.score)) * 100)
  return (
    <div className="client-swap" role="group" aria-labelledby="client-title">
      <div className="mt-3 flex items-center gap-3">
        <span className="alert-chip shrink-0" aria-hidden>{level === 'blocked' ? <Lock size={20} strokeWidth={2} /> : <ShieldAlert size={20} strokeWidth={2} />}</span>
        <h2 id="client-title" className="text-[22px] font-normal leading-tight tracking-[-0.02em] lg:text-[24px] tight:lg:text-[22px]">{c.screen.title}</h2>
      </div>
      <div className="num-prop mt-4 text-[40px] font-light leading-none tracking-[-0.03em] lg:text-[48px] tight:lg:text-[40px]">{plainKzt(c.transfer.amount)}</div>
      {c.reasons.length > 0 && (
        <ul className="mt-4 space-y-2">
          {c.reasons.slice(0, 3).map((r, i) => {
            const I = ICON[r.key] ?? ShieldAlert
            return (
              <li key={r.key + i} className="client-reason flex gap-2.5" style={{ animationDelay: `${80 + i * 60}ms` }}>
                <I size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-gold-ink" aria-hidden />
                <span className="text-[16px] leading-snug text-ink-2">{r.text}</span>
              </li>
            )
          })}
        </ul>
      )}
      {risk > 0 && (
        <div className="mt-5" role="img" aria-label={`Риск перевода ${risk} из 100`}>
          <div className="flex items-baseline justify-between text-[15px]"><span className="text-ink-2">Риск</span><span className="text-[18px] font-medium text-leak">{risk}%</span></div>
          <div className="risk-track mt-2"><span className="risk-dot" style={{ left: `${Math.max(3, Math.min(97, risk))}%` }} /></div>
        </div>
      )}
      <div className="mt-5 rounded-[20px] bg-white/[0.035] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-2 px-1 text-[15px] text-ink-2"><Sparkles size={16} strokeWidth={1.75} className="text-stop" aria-hidden />Рекомендации ИИ</div>
        <div className="client-row mt-2.5 flex gap-2 max-sm:flex-col">
          {main.map((b) => (
            <button key={b.id} ref={buttons.indexOf(b) === firstPrimary ? primary : undefined} className={b.primary ? 'client-cta' : 'client-sec'} onClick={() => onPress(b)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
      {quiet.map((b) => <button key={b.id} className="client-link mx-auto mt-2 block" onClick={() => onPress(b)}>{b.label}</button>)}
    </div>
  )
}

function After({ id, text, onRestart }: { id: string; text?: string; onRestart: () => void }) {
  const full = text || (id === 'cancel' ? 'Перевод отменён.' : 'Перевод отправлен.')
  const cut = full.indexOf('. ')
  const title = cut > 0 ? full.slice(0, cut) : full.replace(/\.$/, '')
  const icon = id === 'cancel' ? <Check size={22} strokeWidth={2.25} /> : id === 'call' ? <PhoneCall size={21} strokeWidth={2} /> : <Send size={20} strokeWidth={2} />
  return (
    <Final icon={icon} tone={id === 'cancel' ? 'stop' : 'neutral'} title={title}>
      {cut > 0 && <p className="text-[16px] leading-snug text-ink-2">{full.slice(cut + 2)}</p>}
      <button className="client-link" onClick={onRestart}>Показать ещё раз</button>
    </Final>
  )
}

function Final({ icon, tone, title, children }: { icon: React.ReactNode; tone: 'stop' | 'neutral'; title: string; children: React.ReactNode }) {
  return (
    <div className="client-swap" role="status">
      <div className={`mt-3 flex items-center gap-2.5 ${tone === 'stop' ? 'text-stop' : 'text-ink-3'}`}>
        <span className="shrink-0" aria-hidden>{icon}</span>
        <h2 className="text-[22px] font-normal leading-tight tracking-[-0.02em] text-ink">{title}</h2>
      </div>
      <div className="mt-5 flex flex-col items-stretch gap-2 [&>.client-cta]:flex-none [&>.client-link]:self-center">{children}</div>
    </div>
  )
}
