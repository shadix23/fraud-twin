import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRightLeft, CalendarDays, Check, Link2, Lock, PhoneCall, Send, ShieldAlert, Smartphone, UserPlus, Users, type LucideIcon } from 'lucide-react'
import type { ClientButton, ClientCase, ClientCheck, ClientLevel } from './data'
import { useLang, type Dict } from './i18n'
import { plainKzt } from './format'
import { QrCode, clientUrl, PUBLIC_URL } from './QrCode'

// Шаг «Клиент» (бриф v20, F5): экран клиента как простая белая плита 390 px, без рамки телефона, выреза и рук.
// Подписан как макет. Три получателя сегментом: карта дропа (предупреждение), новая карта (уходит молча, граница метода), знакомый.
// Тексты экрана, причины и суммы приходят из симулятора как есть; подписи интерфейса из словаря.

type Stage = 'checking' | 'result' | 'after'
export interface PhoneState { level: ClientLevel | null; after: string | null }

const ICON: Record<string, LucideIcon> = {
  young: CalendarDays, phone: Smartphone, strangers: Users, transit: ArrowRightLeft,
  chain: Link2, new_recipient: UserPlus, blocked: Lock,
}
const ORDER = ['high', 'fresh_card', 'honest']
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function defaults(level: ClientLevel, t: Dict): ClientButton[] {
  const c = t.client
  if (level === 'high') return [{ id: 'cancel', label: c.cancel, primary: true }, { id: 'call', label: c.call }, { id: 'send_anyway', label: c.anyway, quiet: true }]
  if (level === 'medium') return [{ id: 'send', label: c.proceed, primary: true }, { id: 'cancel', label: c.cancel }]
  if (level === 'blocked') return [{ id: 'call', label: c.call, primary: true }, { id: 'done', label: c.close }]
  return [{ id: 'done', label: c.done, primary: true }]
}

/** Какие получатели есть в ответе, в постоянном порядке */
export const clientCases = (data: ClientCheck | null | undefined) =>
  data ? [...ORDER.filter((k) => data.cases[k]), ...Object.keys(data.cases).filter((k) => !ORDER.includes(k) && data.cases[k])] : []

export default function ClientScreen({ data, pick, onPick, auto, onState, onClose }: {
  data: ClientCheck | null | undefined // undefined - ещё грузим, null - для этой схемы нет
  pick: string | null                  // получатель; null - демо-случай из ответа
  onPick: (k: string) => void
  auto?: boolean                       // автопоказ: клиент сам отменяет перевод через несколько секунд
  onState: (s: PhoneState) => void
  onClose: () => void                  // назад к шагу «Защита»
}) {
  const { t, lang } = useLang()
  const [stage, setStage] = useState<Stage>(() => (reduced() ? 'result' : 'checking'))
  const [after, setAfter] = useState<string | null>(null)
  const [waited, setWaited] = useState(false)
  const key = pick && data?.cases[pick] ? pick : data?.demo ?? null
  const c: ClientCase | null = (data && key && data.cases[key]) || null
  const level: ClientLevel = c?.risk.level ?? 'low'
  const ready = data !== undefined || waited
  const primary = useRef<HTMLButtonElement>(null)
  const cases = clientCases(data)

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
  useEffect(() => { if (stage === 'result') primary.current?.focus({ preventScroll: true }) }, [stage])

  const restart = () => { setAfter(null); setWaited(false); setStage(reduced() ? 'result' : 'checking'); onState({ level: null, after: null }) }
  const press = (b: ClientButton) => {
    if (b.id === 'done') { restart(); return }
    setAfter(b.id); setStage('after'); onState({ level, after: b.id })
  }
  // получателя можно сменить и с плиты исходов рядом: экран начинает проверку заново при любой смене
  const choose = (k: string) => { if (k !== key) onPick(k) }
  const prevKey = useRef(key)
  useEffect(() => {
    if (prevKey.current === key) return
    const was = prevKey.current
    prevKey.current = key
    if (was != null) restart()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  // автопоказ: даём прочитать причины и нажимаем главную кнопку, как это сделал бы клиент
  const pressRef = useRef(press)
  pressRef.current = press
  useEffect(() => {
    if (!auto || stage !== 'result' || !ready || !c || level === 'low') return
    const list = c.screen.buttons?.length ? c.screen.buttons : defaults(level, t)
    const b = list.find((x) => x.id === 'cancel') ?? list.find((x) => x.primary)
    if (!b) return
    const id = setTimeout(() => pressRef.current(b), reduced() ? 1500 : 4200)
    return () => clearTimeout(id)
  }, [auto, stage, ready, level, c, t])

  const showResult = (stage === 'result' && ready) || stage === 'after'
  const digits = c?.transfer.recipient.card_mask.match(/(\d{4})\s*$/)?.[1] ?? ''

  return (
    <section data-client role="group" aria-label={t.client.group} tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      className="plate flex min-h-0 shrink-0 flex-col outline-none lg:w-[390px] lg:overflow-y-auto">
      <div className="px-5 pt-5 lg:px-6 short:pt-4">
        <p className="t-caps text-ink-3">{t.client.mock}</p>
        {cases.length > 1 && (
          <div className="mt-3 short:mt-2">
            <div className="seg seg-sm w-full !bg-surface-2 !shadow-none" role="group" aria-label={t.client.recipient}>
              {cases.map((k) => (
                <button key={k} type="button" className="seg-item flex-1 !px-2" aria-pressed={k === key} onClick={() => choose(k)}>
                  {k === key && <span className="seg-on" aria-hidden />}<span className="relative">{t.client.cases[k] ?? k}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 px-5 pb-5 pt-4 lg:px-6 short:pb-4 short:pt-3" aria-live="polite">
        {data === null || (data && !c) ? (
          <p className="text-[16px] leading-snug text-ink-2">{t.client.noData}</p>
        ) : !c || !showResult ? (
          <>
            {c && <Head c={c} digits={digits} amount />}
            <p className="flex items-center gap-2.5 py-6 text-[16px] text-ink-2"><span className="client-spin" aria-hidden />{t.client.checking}</p>
          </>
        ) : stage === 'after' && after ? (
          <After id={after} text={data?.after[after]} onRestart={restart} />
        ) : level === 'low' ? (
          <div className="client-swap" role="status">
            <Head c={c} digits={digits} />
            <div className="mt-4 flex items-center gap-2.5 text-ink-3">
              <Check size={22} strokeWidth={2.25} aria-hidden />
              <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{c.screen.title || t.client.sent}</h2>
            </div>
            <div className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{plainKzt(c.transfer.amount, lang)}</div>
            <button ref={primary} className="client-cta mt-6 w-full !flex-none" onClick={() => press({ id: 'done', label: '' })}>{c.screen.buttons?.[0]?.label ?? t.client.done}</button>
          </div>
        ) : (
          <Warning c={c} level={level} digits={digits} primary={primary} onPress={press} />
        )}
      </div>
    </section>
  )
}

function Head({ c, digits, amount }: { c: ClientCase; digits: string; amount?: boolean }) {
  const { t, lang } = useLang()
  return (
    <div className="flex items-center gap-3 text-[15px] text-ink-3">
      <span className="min-w-0 flex-1 truncate">{t.client.card(c.transfer.recipient.name, digits)}</span>
      {amount && <span className="shrink-0 font-semibold tabular-nums text-ink">{plainKzt(c.transfer.amount, lang)}</span>}
    </div>
  )
}

function Warning({ c, level, digits, primary, onPress }: { c: ClientCase; level: ClientLevel; digits: string; primary: React.RefObject<HTMLButtonElement | null>; onPress: (b: ClientButton) => void }) {
  const { t, lang } = useLang()
  const buttons = c.screen.buttons?.length ? c.screen.buttons : defaults(level, t)
  const firstPrimary = buttons.findIndex((b) => b.primary)
  const main = buttons.filter((b) => !b.quiet)
  const quiet = buttons.filter((b) => b.quiet)
  const risk = Math.round(Math.min(1, Math.max(0, c.risk.score)) * 100)
  return (
    <div className="client-swap" aria-labelledby="client-title">
      <Head c={c} digits={digits} />
      <div className="mt-3 flex items-center gap-3 short:mt-2">
        <span className="alert-chip shrink-0" aria-hidden>{level === 'blocked' ? <Lock size={20} strokeWidth={2} /> : <ShieldAlert size={20} strokeWidth={2} />}</span>
        <h2 id="client-title" className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{c.screen.title}</h2>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 short:mt-3">
        <span className="text-[40px] font-semibold leading-none tracking-[-0.035em] tabular-nums short:text-[34px]">{plainKzt(c.transfer.amount, lang)}</span>
        {risk > 0 && (
          <span className="shrink-0 text-right leading-tight" role="img" aria-label={t.client.riskAria(risk)}>
            <span className="t-caps block text-ink-3">{t.client.risk}</span>
            <span className="text-[20px] font-semibold tabular-nums text-leak">{risk}%</span>
          </span>
        )}
      </div>
      {c.reasons.length > 0 && (
        <ul className="mt-4 space-y-2 short:mt-3 short:space-y-1.5">
          {c.reasons.slice(0, 3).map((r, i) => {
            const I = ICON[r.key] ?? ShieldAlert
            return (
              <li key={r.key + i} className="client-reason flex gap-2.5" style={{ animationDelay: `${80 + i * 60}ms` }}>
                <I size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                <span className="text-[16px] leading-snug text-ink-2">{r.text}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="t-caps mt-5 text-ink-3 short:mt-4">{t.client.advice}</p>
      <div className="client-col mt-2 flex flex-col gap-2">
        {main.map((b) => (
          <button key={b.id} ref={buttons.indexOf(b) === firstPrimary ? primary : undefined} className={b.primary ? 'client-cta' : 'client-sec'} onClick={() => onPress(b)}>
            {b.label}
          </button>
        ))}
      </div>
      {quiet.map((b) => <button key={b.id} className="client-link mx-auto mt-2 block" onClick={() => onPress(b)}>{b.label}</button>)}
    </div>
  )
}

function After({ id, text, onRestart }: { id: string; text?: string; onRestart: () => void }) {
  const { t } = useLang()
  const full = text || (id === 'cancel' ? `${t.client.cancelled}.` : `${t.client.sent}.`)
  const cut = full.indexOf('. ')
  const title = cut > 0 ? full.slice(0, cut) : full.replace(/\.$/, '')
  const icon = id === 'cancel' ? <Check size={22} strokeWidth={2.25} /> : id === 'call' ? <PhoneCall size={21} strokeWidth={2} /> : <Send size={20} strokeWidth={2} />
  return (
    <div className="client-swap" role="status">
      <div className={`flex items-center gap-2.5 ${id === 'cancel' ? 'text-stop' : 'text-ink-3'}`}>
        <span className="shrink-0" aria-hidden>{icon}</span>
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h2>
      </div>
      {cut > 0 && <p className="mt-3 text-[16px] leading-snug text-ink-2">{full.slice(cut + 2)}</p>}
      <button className="client-link mt-4" onClick={onRestart}>{t.client.again}</button>
    </div>
  )
}

/** Рабочая плита шага «Клиент»: граница метода (первые жертвы на новой карте) и чем предупреждение отличается от задержки.
 *  Числа те же, что на слайде и в отчёте: robust по 6 мирам, иначе один прогон */
export function ClientFacts({ check }: { check: { data: ClientCheck | null; robust: ClientCheck['robust'] | null } | undefined }) {
  const { t, lang } = useLang()
  const r = check?.robust
  const fresh = !!check?.data?.cases.fresh_card
  const pct = (v: number) => (lang === 'en' ? v.toFixed(1) : v.toFixed(1).replace('.', ','))
  return (
    <section data-client-price className="space-y-3 short:space-y-2">
      <h2 className="t-caps text-ink-3">{t.client.limitCaps}</h2>
      {r && (
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-[44px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-leak short:text-[34px]" data-first-silent>{pct(r.victims.first_on_card_silent_pct)}%</span>
          </div>
          <p className="mt-2 text-[16px] font-medium leading-snug text-ink">{t.client.firstSilent}</p>
          <p className="mt-1 text-[16px] leading-snug text-ink-2" data-first-victim>{t.client.firstText}</p>
        </div>
      )}
      {fresh && <p className="text-[16px] leading-snug text-ink-2">{t.client.tryFresh}</p>}
      <p className="text-[16px] leading-snug text-ink-2" data-metric-note>{t.client.warnNote}</p>
      <a href="#client" className="ctl ctl-quiet !h-11 w-full !font-medium lg:hidden" data-open-phone>{t.phone.open}</a>
    </section>
  )
}

/** v20-fix: на широком экране вместо сцены рядом с экраном клиента одна спокойная плита: три получателя и их исходы.
 *  Строка выбирает получателя на экране клиента. Задача кейса - внизу плиты, как на сцене */
export function ClientOutcomes({ data, pick, onPick, after, footer }: {
  data: ClientCheck | null | undefined; pick: string | null; onPick: (k: string) => void; after: string | null; footer?: ReactNode
}) {
  const { t } = useLang()
  const cases = clientCases(data)
  const key = pick && data?.cases[pick] ? pick : data?.demo ?? null
  return (
    <section className="plate relative hidden min-h-0 flex-1 flex-col lg:flex" aria-label={t.client.outcomes.title} data-client-outcomes>
      <div className="min-h-0 flex-1 px-6 pb-24 pt-5 lg:overflow-y-auto short:pb-20 short:pt-4">
        <h2 className="t-caps text-ink-3">{t.client.outcomes.title}</h2>
        <ul className="mt-3 space-y-2 short:mt-2 short:space-y-1.5">
          {cases.map((k) => {
            const c = data!.cases[k]!
            const risk = Math.round(Math.min(1, Math.max(0, c.risk.score)) * 100)
            const on = k === key
            const high = c.risk.level === 'high' || c.risk.level === 'blocked'
            return (
              <li key={k}>
                <button type="button" aria-pressed={on} onClick={() => onPick(k)} data-outcome={k}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 rounded-2xl px-4 py-3.5 text-left transition-colors duration-150 short:py-3 ${on ? 'bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--color-ink)]' : 'hover:bg-surface-2/70'}`}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">{t.client.cases[k] ?? k}</span>
                      {on && <span className="t-caps text-ink-3">{after ? (after === 'cancel' ? t.client.cancelled : t.client.sent) : t.client.outcomes.now}</span>}
                    </span>
                    <span className="mt-1 block text-[15px] leading-snug text-ink-2">{t.client.outcomes.text[k] ?? c.screen.title}</span>
                  </span>
                  <span className="text-right leading-tight" role="img" aria-label={t.client.riskAria(risk)}>
                    <span className="t-caps block text-ink-3">{t.client.risk}</span>
                    <span className={`text-[20px] font-semibold tabular-nums ${high ? 'text-leak' : 'text-ink-2'}`}>{risk}%</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <QrBlock />
      </div>
      {footer}
    </section>
  )
}

/** F8: QR на публичный #client рядом с исходами. Телефон жюри открывает 20 секунд в роли клиента, сцену при этом не грузит */
function QrBlock() {
  const { t, lang } = useLang()
  const url = clientUrl(lang)
  return (
    <div className="mt-5 flex items-center gap-5 border-t border-line/70 pt-5 short:mt-3 short:gap-4 short:pt-3" data-qr-block>
      <QrCode text={url} label={t.phone.qrAria(url)} className="size-[212px] shrink-0 shadow-[inset_0_0_0_1px_var(--color-line)] short:size-[132px]" />
      <div className="min-w-0">
        <h3 className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink short:text-[18px]">{t.phone.qrTitle}</h3>
        <p className="mt-1.5 text-[15px] leading-snug text-ink-2">{t.phone.qrText}</p>
        <p className="mt-2 truncate text-[14px] font-medium text-ink-3">{PUBLIC_URL.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  )
}
