import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ease, spring } from './motion'
import { Check, Lock, PhoneCall, Send } from 'lucide-react'
import type { ClientButton, ClientCase, ClientCheck, ClientLevel } from './data'
import { useLang, type Dict } from './i18n'
import { plainKzt } from './format'
import { QrCode, clientUrl, PUBLIC_URL } from './QrCode'

// Шаг «Клиент» (макет Penpot 04-client): экран банка в крупном телефоне с наклоном -4°, подписан как макет. Три получателя сегментом: карта дропа (предупреждение), новая карта (уходит молча, граница метода), знакомый.
// Тексты экрана, причины и суммы приходят из симулятора как есть; подписи интерфейса из словаря.

type Stage = 'checking' | 'result' | 'after'
export interface PhoneState { level: ClientLevel | null; after: string | null }

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
  // получателя меняют табы под заголовком: экран начинает проверку заново при любой смене
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
  // моушн-бриф 6.4: лист предупреждения поднимается пружиной, в момент посадки телефон один раз вздрагивает
  const warn = !!c && showResult && stage === 'result' && level !== 'low'
  const digits = c?.transfer.recipient.card_mask.match(/(\d{4})\s*$/)?.[1] ?? ''

  return (
    <section data-client role="group" aria-label={t.client.group} tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      className="cphone-wrap outline-none max-lg:order-4">
      <p className="sr-only">{t.client.mock}</p>
      {/* v24 (макет 04-client): крупный телефон с наклоном -4°, экран банка: перевод, затемнение и лист с решением */}
      <div className={`cphone ${warn && !reduced() ? 'buzz' : ''}`}>
        <div className="cphone-screen">
          <span className="cphone-notch" aria-hidden />
          <span className="cphone-time" aria-hidden>09:41</span>
          <div className="cphone-head">
            <p className="text-[20px] font-semibold leading-tight tracking-[-0.02em]">{t.client.transferTo}</p>
            {c && <p className="mt-1.5 truncate text-[15px] text-ink-3">{c.transfer.recipient.name} <span className="tracking-[0.12em]">••••</span> {digits}</p>}
            {c && <p className="mt-3 text-[36px] font-medium leading-none tracking-[-0.035em] tabular-nums">{plainKzt(c.transfer.amount, lang)}</p>}
          </div>
          <span className={`cphone-dim ${c && showResult && (level !== 'low' || stage === 'after') ? 'on' : ''}`} aria-hidden />
          {/* моушн-бриф 6.4: при смене получателя старый лист уходит вниз за 220 мс (ease.in), и только потом поднимается новый:
              два листа одновременно не видны. Слот держит получателя, лист внутри пересоздаётся по стадии, как раньше */}
          <AnimatePresence mode="wait" initial={false}>
          <motion.div key={key ?? 'none'} className="cphone-slot" exit={{ y: '115%', transition: { duration: 0.22, ease: ease.in } }}>
          <div className={`cphone-sheet ${warn ? 'sheet-rise' : ''}`} aria-live="polite" key={`${stage}-${after ?? ''}`}>
            <span className="cphone-grab" aria-hidden />
            {data === null || (data && !c) ? (
              <p className="text-[16px] leading-snug text-ink-2">{t.client.noData}</p>
            ) : !c || !showResult ? (
              <p className="flex items-center gap-2.5 py-2 text-[16px] text-ink-2"><span className="client-spin" aria-hidden />{t.client.checking}</p>
            ) : stage === 'after' && after ? (
              <After id={after} text={data?.after[after]} onRestart={restart} />
            ) : level === 'low' ? (
              <div className="flex flex-1 flex-col" role="status">
                <span className="cphone-ok" aria-hidden><Check size={24} strokeWidth={2.5} /></span>
                <h2 className="mt-4 text-[25px] font-semibold leading-[1.08] tracking-[-0.028em]">{c.screen.title || t.client.sent}</h2>
                {c.screen.subtitle && <p className="mt-2 text-[14px] leading-snug text-ink-3">{c.screen.subtitle}</p>}
                <button ref={primary} className="client-cta cphone-btn mt-auto" onClick={() => press({ id: 'done', label: '' })}>{c.screen.buttons?.[0]?.label ?? t.client.done}</button>
              </div>
            ) : (
              <Warning c={c} level={level} digits={digits} primary={primary} onPress={press} />
            )}
          </div>
          </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

/** Выбор получателя (макет 04: под заголовком, чёрный активный сегмент). Меняет экран телефона и числа плитки */
export function ClientTabs({ data, pick, onPick, className = '' }: { data: ClientCheck | null | undefined; pick: string | null; onPick: (k: string) => void; className?: string }) {
  const { t } = useLang()
  const cases = clientCases(data)
  const key = pick && data?.cases[pick] ? pick : data?.demo ?? null
  if (cases.length < 2) return null
  return (
    <div className={`seg seg-client ${className}`} role="group" aria-label={t.client.recipient} data-client-tabs>
      {cases.map((k) => (
        <button key={k} type="button" className="seg-item" aria-pressed={k === key} onClick={() => { if (k !== key) onPick(k) }} data-case={k}>
          {k === key && <motion.span layoutId="seg-client" transition={spring.ui} className="seg-on" aria-hidden />}<span className="relative">{t.client.cases[k] ?? k}</span>
        </button>
      ))}
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
    <div className="flex flex-1 flex-col" aria-labelledby="client-title">
      <span className="cphone-risk pop-in [--d:180ms]" role="img" aria-label={t.client.riskAria(risk)}>{level === 'blocked' ? <Lock size={20} strokeWidth={2.25} /> : '!'}</span>
      <h2 id="client-title" className="mt-4 text-[25px] font-semibold leading-[1.08] tracking-[-0.028em]">{c.screen.title}</h2>
      <p className="mt-3 text-[14px] leading-snug text-ink-3">{t.client.held(plainKzt(c.transfer.amount, lang), digits)}</p>
      {c.reasons.length > 0 && (
        <ul className="cphone-reasons mt-5 space-y-3">
          {c.reasons.slice(0, 3).map((r, i) => (
            <li key={r.key + i} className="flex gap-3" style={{ ['--d' as string]: `${320 + i * 110}ms` }} data-reason={r.key}>
              <span aria-hidden className="pop-in mt-[7px] size-2 shrink-0 rounded-full bg-leak" />
              <span className="fade-d text-[15px] font-medium leading-[1.35] text-ink">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="fade-d mt-auto flex flex-col gap-2.5 pt-5" style={{ ['--d' as string]: `${320 + Math.min(3, c.reasons.length) * 110 + 60}ms` }} role="group" aria-label={t.client.advice}>
        {main.map((b) => (
          <button key={b.id} ref={buttons.indexOf(b) === firstPrimary ? primary : undefined} className={`cphone-btn ${b.primary ? 'client-cta' : 'cphone-sec'}`} onClick={() => onPress(b)}>
            {b.label}
          </button>
        ))}
        {quiet.map((b) => <button key={b.id} className="cphone-quiet" onClick={() => onPress(b)}>{b.label}</button>)}
      </div>
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

/** v24 (макет 04-client): справа от телефона граница метода огромным числом и плита QR на публичный #client.
 *  Числа те же, что на слайде и в отчёте: robust по 6 мирам. На «Новой карте» число становится красным: это её случай */
export function ClientSide({ check, fresh, footer }: { check: { data: ClientCheck | null; robust: ClientCheck['robust'] | null } | undefined; fresh: boolean; footer?: ReactNode }) {
  const { t, lang } = useLang()
  const r = check?.robust
  const url = clientUrl(lang)
  const pct = (v: number) => (lang === 'en' ? v.toFixed(1) : v.toFixed(1).replace('.', ','))
  return (
    <section className="client-side flex min-w-0 flex-col max-lg:contents" aria-label={t.client.limitCaps} data-client-price>
      {r && (
        <div className="max-lg:order-6 max-lg:mt-8 max-lg:px-1">
          <div className={`client-limit fade-d [--d:300ms] [--dur:320ms] tabular-nums ${fresh ? 'text-leak' : ''}`} data-first-silent>{pct(r.victims.first_on_card_silent_pct)}%</div>
          <p className="mt-4 max-w-[340px] text-[16px] leading-[1.4] text-ink-3" data-first-victim>{t.v22.limitText}</p>
        </div>
      )}
      <div className="plate client-qr in-r [--d:360ms] [--x:40px] max-lg:hidden" data-qr-block>
        <div className="mx-auto w-max"><QrCode text={url} label={t.phone.qrAria(url)} className="client-qr-code" /></div>
        <h3 className="mt-7 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink short:mt-4">{t.phone.qrTitle}</h3>
        <p className="mt-2 text-[14px] leading-[1.45] text-ink-3">{t.phone.qrText}</p>
        <p className="mt-3 truncate text-[14px] font-medium text-brand">{PUBLIC_URL.replace(/^https?:\/\//, '')}</p>
      </div>
      <a href="#client" className="ctl ctl-quiet !h-12 w-full !font-medium max-lg:order-7 max-lg:mt-5 lg:hidden" data-open-phone>{t.phone.open}</a>
      <p className="foot-note mt-4 max-w-[344px] max-lg:order-8 max-lg:px-1" data-client-foot>{t.v22.clientFoot}</p>
      {footer}
    </section>
  )
}
