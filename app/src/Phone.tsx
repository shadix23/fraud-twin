import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Lock, MessageSquare, PhoneCall, Send, ShieldAlert, CalendarDays, Smartphone, Users, ArrowRightLeft, Link2, UserPlus, type LucideIcon } from 'lucide-react'
import type { ClientButton, ClientCase, ClientCheck } from './data'
import { LANGS, useLang, type Lang } from './i18n'
import { num, plainKzt } from './format'

// F8 и «вау 2» (wow-v21): адрес #client на телефоне жюри. 20 секунд в роли жертвы, без 3D и без сервера:
// сообщение «службы безопасности» (помечено как пример) -> перевод -> предупреждение банка -> итог и связь с двойником.
// Данные те же, что на шаге «Клиент»: scenarios/<lang>/client_check.json. Оба языка грузим сразу, дальше работает офлайн.
// Рамки телефона нет: экран и есть телефон. Одно заметное движение: лист предупреждения поднимается поверх перевода.

type Stage = 'message' | 'transfer' | 'checking' | 'warning' | 'final'
type Victims = { victims: number; warned: number }

const ICON: Record<string, LucideIcon> = {
  young: CalendarDays, phone: Smartphone, strangers: Users, transit: ArrowRightLeft,
  chain: Link2, new_recipient: UserPlus, blocked: Lock,
}
const OTHER = ['high', 'fresh_card', 'honest']
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const load = (l: Lang): Promise<ClientCheck | null> =>
  fetch(`${import.meta.env.BASE_URL}scenarios/${l}/client_check.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function Phone() {
  const { t, lang } = useLang()
  const [all, setAll] = useState<Partial<Record<Lang, ClientCheck | null>>>({})
  const [stage, setStage] = useState<Stage>('message')
  const [pick, setPick] = useState<string | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // оба языка сразу: переключение RU/EN после загрузки работает без сети
  useEffect(() => {
    let alive = true
    const order = [lang, ...(Object.keys(LANGS) as Lang[]).filter((l) => l !== lang)]
    order.forEach((l) => load(l).then((d) => { if (alive) setAll((a) => ({ ...a, [l]: d })) }))
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // заголовок вкладки: после LangProvider, он ставит свой
  useEffect(() => { const id = requestAnimationFrame(() => { document.title = t.phone.title }); return () => cancelAnimationFrame(id) }, [t])

  const data = all[lang]
  const key = pick && data?.cases[pick] ? pick : data?.demo && data.cases[data.demo] ? data.demo : 'high'
  const c = data?.cases[key] ?? null

  // фокус на заголовок нового экрана: читалка объявляет смену, клавиатура начинает сверху
  useEffect(() => {
    const id = requestAnimationFrame(() => [...(root.current?.querySelectorAll<HTMLElement>('[data-focus]') ?? [])].pop()?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [stage, key])

  const send = useCallback(() => {
    if (!c) return
    setStage('checking')
    setTimeout(() => {
      if (c.risk.level === 'low') { setChoice('send'); setStage('final') } else setStage('warning')
    }, reduced() ? 500 : 1100)
  }, [c])
  const press = (b: ClientButton) => { setChoice(b.id); setStage('final') }
  const restart = () => { setPick(null); setChoice(null); setStage('message') }
  const other = (k: string) => { setPick(k); setChoice(null); setStage('transfer') }

  return (
    <div ref={root} className="phone" data-phone data-stage={stage}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-2">
        <a href={`${import.meta.env.BASE_URL}?lang=${lang}`} className="text-[17px] font-semibold tracking-[-0.03em] text-ink">Fraud <span className="text-brand">Twin</span></a>
        <LangPill />
      </header>

      {data === undefined ? (
        <p className="m-auto flex items-center gap-2.5 text-[16px] text-ink-2" role="status"><span className="client-spin" aria-hidden />{t.phone.loading}</p>
      ) : data === null || !c ? (
        <p className="m-auto max-w-[300px] text-center text-[16px] leading-snug text-ink-2" role="alert">{t.phone.failed}</p>
      ) : stage === 'message' ? (
        <Message c={c} onGo={() => setStage('transfer')} />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {stage === 'final'
            ? <Final key={key + choice} data={data} c={c} caseKey={key} choice={choice ?? 'send'} onOther={other} onRestart={restart} />
            : <Transfer key={key} c={c} caseKey={key} checking={stage === 'checking'} dim={stage === 'warning'} onSend={send} />}
          {stage === 'warning' && <Warning c={c} onPress={press} />}
        </div>
      )}
    </div>
  )
}

function LangPill() {
  const { lang, setLang, t } = useLang()
  return (
    <div className="seg seg-sm" role="group" aria-label={t.header.lang}>
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button key={l} type="button" className="seg-item !h-8 !px-3" aria-pressed={lang === l} lang={l} title={LANGS[l].langName} onClick={() => setLang(l)}>
          {lang === l && <span className="seg-on" aria-hidden />}<span className="relative">{l.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}

const digitsOf = (c: ClientCase) => c.transfer.recipient.card_mask.match(/(\d{4})\s*$/)?.[1] ?? ''

/** 0-5 с: сообщение мошенника на экране блокировки. Явно помечено как пример */
function Message({ c, onGo }: { c: ClientCase; onGo: () => void }) {
  const { t } = useLang()
  return (
    <section className="phone-screen flex min-h-0 flex-1 flex-col px-2" aria-labelledby="ph-msg">
      <p className="scam-tag mt-2 self-center">{t.phone.example}</p>
      <div className="mt-3 text-center text-[84px] font-medium leading-none tracking-[-0.05em] text-ink tight:text-[72px] tiny:text-[60px]" aria-hidden>{c.transfer.time}</div>
      <article className="plate msg mt-6 px-4 pb-4 pt-3.5 tiny:mt-4">
        <div className="flex items-center gap-3">
          <span className="msg-app" aria-hidden><MessageSquare size={18} strokeWidth={2} /></span>
          <div className="min-w-0 flex-1 leading-tight">
            <h1 id="ph-msg" tabIndex={-1} data-focus className="text-[16px] font-semibold text-ink outline-none">{t.phone.sender}</h1>
            <span className="text-[13px] text-ink-3">{t.phone.unknown}</span>
          </div>
          <span className="self-start text-[13px] text-ink-3">{t.phone.now}</span>
        </div>
        <p className="mt-2.5 text-[17px] leading-[1.4] text-ink">{t.phone.message(digitsOf(c))}</p>
      </article>
      <div className="mt-auto pt-6">
        <p className="mb-3 text-center text-[15px] leading-snug text-ink-2">{t.phone.hint}</p>
        <button type="button" className="ctl ctl-main w-full !justify-between !px-6" onClick={onGo}>
          {t.phone.toSafe}<ArrowRight size={18} strokeWidth={2} className="next" aria-hidden />
        </button>
      </div>
    </section>
  )
}

/** 5-10 с: экран перевода, карта и сумма уже подставлены. Подписан как макет */
function Transfer({ c, caseKey, checking, dim, onSend }: { c: ClientCase; caseKey: string; checking: boolean; dim: boolean; onSend: () => void }) {
  const { t, lang } = useLang()
  const r = c.transfer.recipient
  const amt = plainKzt(c.transfer.amount, lang)
  return (
    <section className={`plate phone-screen phone-plate flex min-h-0 flex-1 flex-col px-5 pb-5 pt-5 ${dim ? 'is-dim' : ''}`} aria-labelledby="ph-tr" inert={dim}>
      <p className="t-caps text-ink-3">{t.client.mock}</p>
      <h1 id="ph-tr" tabIndex={-1} data-focus className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.03em] outline-none">{t.phone.transfer}</h1>
      <div className="mt-6 flex items-center gap-3.5 tight:mt-4">
        <span className="avatar" aria-hidden>{r.name.trim().charAt(0)}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[18px] font-semibold text-ink">{r.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="whitespace-nowrap text-[15px] text-ink-3 tabular-nums">{t.phone.card(digitsOf(c))}</span>
            {c.transfer.new_recipient && <span className="pill-outline">{t.phone.newRecipient}</span>}
          </div>
        </div>
      </div>
      {t.phone.note[caseKey] && <p className="mt-4 text-[15px] leading-snug text-ink-2">{t.phone.note[caseKey]}</p>}
      <p className="t-caps mt-8 text-ink-3 tight:mt-6">{t.phone.amount}</p>
      <div className="mt-2 text-[44px] font-semibold leading-none tracking-[-0.04em] tabular-nums tight:text-[40px]">{amt}</div>
      <div className="mt-auto pt-6">
        <button type="button" className="ctl ctl-main w-full !justify-center" onClick={onSend} disabled={checking} aria-busy={checking}>
          {checking ? <><span className="client-spin client-spin-w" aria-hidden />{t.phone.checking}</> : t.phone.send(amt)}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{checking ? t.phone.checking : ''}</p>
    </section>
  )
}

/** 10-15 с: предупреждение банка листом снизу, причины словами из симулятора, «Отменить перевод» главной кнопкой */
function Warning({ c, onPress }: { c: ClientCase; onPress: (b: ClientButton) => void }) {
  const { t, lang } = useLang()
  const level = c.risk.level
  const buttons: ClientButton[] = c.screen.buttons?.length ? c.screen.buttons : [
    { id: 'cancel', label: t.client.cancel, primary: true }, { id: 'call', label: t.client.call }, { id: 'send_anyway', label: t.client.anyway, quiet: true },
  ]
  const main = buttons.filter((b) => !b.quiet)
  const quiet = buttons.filter((b) => b.quiet)
  return (
    <section className="sheet-warn" role="alertdialog" aria-modal="true" aria-labelledby="ph-warn" aria-describedby="ph-warn-why">
      <div className="flex items-center gap-3">
        <span className="alert-chip shrink-0" aria-hidden>{level === 'blocked' ? <Lock size={20} strokeWidth={2} /> : <ShieldAlert size={20} strokeWidth={2} />}</span>
        <div className="min-w-0">
          <p className="t-caps text-ink-3">{t.phone.sheet}</p>
          <h1 id="ph-warn" tabIndex={-1} data-focus className="mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] outline-none tight:text-[20px]">{c.screen.title}</h1>
        </div>
      </div>
      <p className="mt-3 text-[15px] font-medium tabular-nums text-ink tight:mt-2">{t.phone.to(plainKzt(c.transfer.amount, lang), digitsOf(c))}</p>
      {c.screen.subtitle && <p className="mt-1 text-[15px] leading-snug text-ink-2">{c.screen.subtitle}</p>}
      <ul id="ph-warn-why" className="mt-3 space-y-2.5 tight:mt-2 tight:space-y-1.5">
        {c.reasons.slice(0, 3).map((r, i) => {
          const I = ICON[r.key] ?? ShieldAlert
          return (
            <li key={r.key + i} className="client-reason flex gap-2.5" style={{ animationDelay: `${260 + i * 70}ms` }}>
              <I size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-leak" aria-hidden />
              <span className="text-[15px] leading-snug text-ink">{r.text}</span>
            </li>
          )
        })}
      </ul>
      {c.screen.question && <p className="mt-3 text-[15px] font-medium leading-snug text-ink tight:mt-2">{c.screen.question}</p>}
      <div className="client-col mt-auto flex flex-col gap-2 pt-4 tight:pt-3">
        {main.map((b) => (
          <button key={b.id} type="button" className={`${b.primary ? 'client-cta' : 'client-sec'} h-12 w-full`} onClick={() => onPress(b)}>{b.label}</button>
        ))}
        {quiet.map((b) => <button key={b.id} type="button" className="client-link mx-auto" onClick={() => onPress(b)}>{b.label}</button>)}
      </div>
    </section>
  )
}

/** 15-20 с: итог, что было бы без предупреждения, связь с двойником и честная строка про новую карту */
function Final({ data, c, caseKey, choice, onOther, onRestart }: {
  data: ClientCheck; c: ClientCase; caseKey: string; choice: string; onOther: (k: string) => void; onRestart: () => void
}) {
  const { t, lang } = useLang()
  const amt = plainKzt(c.transfer.amount, lang)
  const facts = (c as ClientCase & { recipient_facts?: { dwell_min?: number } }).recipient_facts
  const min = Math.max(1, Math.round(facts?.dwell_min ?? 5))
  const victims = (data.stats as { victims?: Victims }).victims
  const firstPct = data.robust?.victims.first_on_card_silent_pct
  const honestRate = (data.robust?.honest as { warned_per_10k?: number } | undefined)?.warned_per_10k ?? (data.stats.honest as { warned_per_10k?: number }).warned_per_10k
  const warned = c.risk.level !== 'low'
  const lost = warned && choice === 'send_anyway'

  let title: string, body: string | null, tone: 'stop' | 'leak' | 'calm', icon
  if (warned) {
    const full = data.after[choice] || (choice === 'cancel' ? `${t.client.cancelled}.` : `${t.client.sent}.`)
    const cut = full.indexOf('. ')
    title = cut > 0 ? full.slice(0, cut) : full.replace(/\.$/, '')
    body = cut > 0 ? full.slice(cut + 2) : null
    tone = lost ? 'leak' : 'stop'
    icon = choice === 'call' ? <PhoneCall size={22} strokeWidth={2} /> : lost ? <Send size={21} strokeWidth={2} /> : <Check size={24} strokeWidth={2.25} />
  } else if (caseKey === 'fresh_card') {
    title = t.phone.freshTitle; body = t.phone.freshText; tone = 'leak'; icon = <Send size={21} strokeWidth={2} />
  } else {
    title = t.phone.honestTitle; body = t.phone.honestText; tone = 'calm'; icon = <Check size={24} strokeWidth={2.25} />
  }
  const others = OTHER.filter((k) => k !== caseKey && data.cases[k])
  const base = import.meta.env.BASE_URL

  return (
    <section className="plate phone-screen phone-plate final-in flex min-h-0 flex-1 flex-col px-5 pb-4 pt-5" aria-labelledby="ph-fin" data-final={caseKey + ':' + choice}>
      <div className={`flex items-start gap-3 ${tone === 'stop' ? 'text-stop' : tone === 'leak' ? 'text-leak' : 'text-ink-3'}`}>
        <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span>
        <h1 id="ph-fin" tabIndex={-1} data-focus className="text-[24px] font-semibold leading-tight tracking-[-0.025em] text-ink outline-none tight:text-[22px]">{title}</h1>
      </div>
      {body && <p className="mt-2 text-[16px] leading-snug text-ink-2">{body}</p>}
      {warned && <p className="mt-2 text-[16px] leading-snug text-ink">{lost ? t.phone.lost(amt, min) : t.phone.would(amt, min)}</p>}

      <div className="mt-5 tight:mt-4">
        {warned && victims ? (
          <>
            <div className="text-[48px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-ink tight:text-[42px]" data-twin>{t.phone.twinOf(victims.warned, victims.victims)}</div>
            <p className="mt-1.5 text-[16px] leading-snug text-ink">{t.phone.twinText}</p>
            {firstPct != null && <p className="mt-3 text-[15px] leading-snug text-ink-2 tight:mt-2">{t.phone.firstSilent(num(firstPct, lang))}</p>}
          </>
        ) : caseKey === 'fresh_card' && firstPct != null ? (
          <>
            <div className="text-[48px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-leak tight:text-[42px]">{num(firstPct, lang)}%</div>
            <p className="mt-1.5 text-[16px] leading-snug text-ink">{t.client.firstSilent}</p>
          </>
        ) : honestRate != null ? (
          <>
            <div className="text-[48px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-ink tight:text-[42px]">{num(honestRate, lang)}</div>
            <p className="mt-1.5 text-[16px] leading-snug text-ink">{t.phone.honestCap}</p>
          </>
        ) : null}
      </div>

      <div className="mt-auto pt-5 tight:pt-4">
        {others.length > 0 && (
          <>
            <p className="t-caps text-ink-3">{t.phone.others}</p>
            <div className="mt-2 flex gap-2">
              {others.map((k) => (
                <button key={k} type="button" className="client-sec h-11 flex-1 !text-[15px]" onClick={() => onOther(k)} data-other={k}>{t.client.cases[k] ?? k}</button>
              ))}
            </div>
          </>
        )}
        <a className="ctl ctl-main mt-3 w-full !justify-between !px-6" href={`${base}?lang=${lang}#how`}>
          {t.phone.how}<ArrowRight size={18} strokeWidth={2} className="next" aria-hidden />
        </a>
        <button type="button" className="client-link mx-auto mt-1 block" onClick={onRestart}>{t.phone.again}</button>
      </div>
    </section>
  )
}
