import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { Select } from '@base-ui/react/select'
import { ArrowRight, Check, ChevronDown, Info, Landmark } from 'lucide-react'
import { DEMO_CTX, loadBank, loadClientCheck, type ClientCheck, loadRedteam, loadScenario, runKey, type Bank, type Calib, type Ctx, type Freeze, type Redteam, type Scenario, type TxEvent } from './data'
import Calibration from './Calibration'
import { FeedDialog, FeedPanel } from './Feed'
import How from './How'
import ClientCard, { type PhoneState } from './ClientCard'
import { Landing, TOUR, TourCaption, type TourId } from './Intro'
import Report from './Report'
import Scene, { LINE_MIN, SPEED, type SearchState } from './Scene'
import { CaseTask, ClientPrice, HoleDiff, caughtNote, Invite, Measure, NumberBlock, NumberStrip, Rules, SceneWords, Unseen, type Shown } from './Panel'
import { kzt } from './format'

const STOP = new Set(['blocked', 'suspended', 'cancelled', 'frozen_src', 'frozen_dst'])
const SEARCH_MS = 9000 // анимация 200 попыток
type Phase = 'idle' | 'playing' | 'paused' | 'done'
type Step = 0 | 1 | 2 | 3 | 4 // 4 - «Клиент», отчёт открывается отдельной страницей
// автопоказ: сколько держим кадр после того, как стадия закончилась
// v17: паузы под длину подписей (с задачей кейса 17-30 слов): на стадию не меньше 2,5 слова в секунду плюс 1,5 с, весь показ около минуты
const TOUR_DWELL: Record<TourId, number> = { attack: 3400, hole: 2600, holeRun: 2800, defense: 4800, client: 4800, report: 0 }
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [bank, setBank] = useState<Bank | null>(null)
  const [ctx, setCtx] = useState<Ctx>(DEMO_CTX)
  // #report и #calib открывают отчёт и калибровку сразу (план Б на защите)
  const [page, setPage] = useState<'twin' | 'report'>(location.hash === '#report' ? 'report' : 'twin')
  const [calibOpen, setCalibOpen] = useState(location.hash === '#calib')
  // «Как устроено» и полный список переводов: листы поверх двойника; #how открывает первый сразу
  const [howOpen, setHowOpen] = useState(location.hash === '#how')
  const [feed, setFeed] = useState<{ open: boolean; tab: 'attack' | 'honest' }>({ open: false, tab: 'attack' })
  useEffect(() => {
    const on = () => { if (location.hash === '#report') setPage('report'); else if (location.hash === '#calib') { setPage('twin'); setCalibOpen(true) } else if (location.hash === '#how') { setPage('twin'); setHowOpen(true) } else setPage('twin') }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const [scKey, setScKey] = useState('student_crypto')
  const [libSc, setLibSc] = useState<Scenario | null>(null)
  const [hole, setHole] = useState<Redteam | null>(null)
  const [holeErr, setHoleErr] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchN, setSearchN] = useState(0)
  const [view, setView] = useState<'library' | 'hole'>('library')
  const [source, setSource] = useState<'api' | 'json'>('json')
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState(false)
  const [hold, setHold] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [t, setT] = useState(0)
  const [step, setStep] = useState<Step>(0)
  const [ranLib, setRanLib] = useState(false)
  const [held, setHeld] = useState<Shown>({ w: 0, s: 0, att: 0 })
  const [autoPlay, setAutoPlay] = useState(false)
  const [autoEnd, setAutoEnd] = useState(false)
  // вход поверх сцены: только при обычной загрузке; #twin, #report и #calib открывают продукт сразу
  const [intro, setIntro] = useState(location.hash === '' || location.hash === '#how')
  const mainBtn = useRef<HTMLButtonElement>(null)
  // автопоказ «за минуту»: номер стадии из TOUR или null
  const [tour, setTour] = useState<number | null>(null)
  const [armed, setArmed] = useState(false)
  // шаг «Клиент»: проверка перевода, undefined - ещё не загружена
  const [client, setClient] = useState<{ data: ClientCheck | null; robust: ClientCheck['robust'] | null } | undefined>(undefined)
  const [phone, setPhone] = useState<PhoneState>({ level: null, after: null })
  const clientOpen = step === 4
  const timeRef = useRef(0)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    loadBank(DEMO_CTX).then((r) => { setBank(r.data); setSource(r.source) }).catch((e) => setError(String(e.message ?? e)))
  }, [])

  const applyCalib = useCallback(async (c: Calib) => {
    const p = bank?.calib_presets.find((x) => bank.calib_fields.every((f) => x.values[f.key] === c[f.key]))
    const next: Ctx = { calib: c, preset: p?.id ?? null }
    const r = await loadBank(next)
    setBank(r.data); setSource(r.source); setCtx(next)
    setModel(false); setHold(false); setCalibOpen(false)
  }, [bank])

  useEffect(() => {
    let alive = true
    loadScenario(scKey, ctx)
      .then((r) => { if (alive) { setLibSc(r.data); setSource(r.source); setError(null) } })
      .catch((e) => alive && setError(String(e.message ?? e)))
    setHole(null); setView('library'); setSearching(false); setRanLib(false); setStep(0)
    setModel(false); setHold(false); setHeld({ w: 0, s: 0, att: 0 })
    setClient(undefined)
    return () => { alive = false }
  }, [scKey, ctx])

  const sc = view === 'hole' && hole ? hole.scenario : libSc
  const rk = runKey(model, hold)
  const run = sc?.runs[rk]
  const log = run?.log ?? []

  const span = useMemo(() => {
    if (!sc || !run) return { start: 0, end: 0 }
    const start = Math.max(0, sc.scheme.start_min - 15)
    const last = Math.max(...run.log.map((e) => e.t), ...run.freezes.map((f) => f.t), start + 60)
    return { start, end: Math.min(sc.horizon_min, last + LINE_MIN + 4) }
  }, [sc, run])

  const setTime = useCallback((v: number) => { timeRef.current = v; setT(v) }, [])
  const stopRaf = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null }

  // сброс при смене сценария или меры
  useEffect(() => { stopRaf(); setPhase('idle'); setTime(span.start) }, [span.start, span.end, rk, sc, setTime])

  const skip = useCallback(() => { stopRaf(); setTime(span.end); setPhase('done') }, [span.end, setTime])

  const play = useCallback((fromStart = false) => {
    if (!run) return
    if (reduced()) { skip(); return }
    let from = fromStart || phase === 'done' || phase === 'idle' ? span.start : timeRef.current
    setTime(from)
    setPhase('playing')
    let prev = performance.now()
    const tick = (now: number) => {
      const next = Math.min(span.end, from + ((now - prev) / 1000) * SPEED)
      prev = now; from = next
      setTime(next)
      if (next >= span.end) { setPhase('done'); raf.current = null; return }
      raf.current = requestAnimationFrame(tick)
    }
    stopRaf()
    raf.current = requestAnimationFrame(tick)
  }, [run, phase, span, setTime, skip])

  const pause = () => { stopRaf(); setPhase('paused') }
  const togglePlay = () => (phase === 'playing' ? pause() : play())

  useEffect(() => () => stopRaf(), [])
  useEffect(() => { if (autoPlay && run && phase === 'idle') { setAutoPlay(false); play(true) } }, [autoPlay, run, phase, play])
  // шаг «Клиент» включает модель сам: сцена сразу показывает итог с моделью, без повторного проигрывания
  useEffect(() => { if (autoEnd && run && phase === 'idle') { setAutoEnd(false); skip() } }, [autoEnd, run, phase, skip])

  // проверка перевода: грузим заранее на шаге «Защита», чтобы шаг «Клиент» открылся без ожидания
  useEffect(() => {
    if (step < 3 || client !== undefined) return
    let alive = true
    loadClientCheck(scKey, ctx).then((r) => alive && setClient(r))
    return () => { alive = false }
  }, [step, client, scKey, ctx])
  useEffect(() => { if (step !== 4 || page !== 'twin') setPhone({ level: null, after: null }) }, [step, page])
  const onPhone = useCallback((p: PhoneState) => setPhone(p), [])
  // цепочка этого перевода на сцене: тот же получатель (карта по маске) и та же сумма
  const clientChain = useMemo(() => {
    const c = client?.data?.cases[client.data.demo]
    const digits = c?.transfer.recipient.card_mask.match(/(\d{4})\s*$/)?.[1]
    if (!c || !digits) return null
    const e = log.find((x) => x.kind === 'victim' && x.amount === c.transfer.amount && String(1000 + (x.dst % 9000)) === digits)
    return e ? e.chain : null
  }, [client, log])

  const final = run?.metrics
  const live = useMemo(() => liveMetrics(log, run?.freezes ?? [], t), [log, run, t])
  useEffect(() => {
    if (phase === 'done' && final) {
      setHeld({ w: final.withdrawn_kzt, s: final.intercepted_kzt, att: final.attempted_kzt })
      if (view === 'library') setRanLib(true)
    }
  }, [phase, final, view])

  // ИИ-мошенник: 200 попыток проигрываются за 9 с, число тикает вместе с линией лучшего
  const findHole = useCallback(() => {
    if (phase === 'playing') skip()
    setStep(2); setSearching(true); setSearchN(0); setHole(null); setHoleErr(null); setView('library')
    setModel(false); setHold(false)
    loadRedteam(scKey, ctx)
      .then((r) => { setHole(r.data); setSource(r.source) })
      .catch((e) => setHoleErr(String(e.message ?? e)))
  }, [scKey, ctx, phase, skip])

  useEffect(() => {
    if (!searching || !hole) return
    const total = hole.history.length
    if (reduced()) { setSearchN(total); return }
    // таймер, а не rAF: поиск доигрывается и в фоновой вкладке
    const t0 = performance.now()
    const id = setInterval(() => {
      const k = Math.min(total, Math.ceil(((performance.now() - t0) / SEARCH_MS) * total))
      setSearchN(k)
      if (k >= total) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [searching, hole])

  const searchFinished = !!hole && searching && searchN >= hole.history.length
  useEffect(() => {
    if (!searchFinished || !hole) return
    const id = setTimeout(() => {
      const m = hole.best.metrics
      setHeld({ w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt })
      setSearching(false); setView('hole')
    }, 900)
    return () => clearTimeout(id)
  }, [searchFinished, hole])

  const shown: Shown = (() => {
    if (searching && hole) {
      const att = hole.scenario.runs.base.metrics.attempted_kzt
      if (searchFinished) return { w: hole.best.metrics.withdrawn_kzt, s: hole.best.metrics.intercepted_kzt, att }
      let best = 0
      for (const h of hole.history.slice(0, searchN)) best = Math.max(best, h.pct)
      return { w: Math.max(held.w, (best / 100) * att), s: held.s, att }
    }
    if (phase === 'idle' || !final) return held.att ? held : { ...held, att: final?.attempted_kzt ?? 0 }
    if (phase === 'done') return { w: final.withdrawn_kzt, s: final.intercepted_kzt, att: final.attempted_kzt }
    return { w: live.withdrawn, s: live.stopped, att: final.attempted_kzt }
  })()

  const toggleMeasure = (which: 'model' | 'hold', v: boolean) => {
    if (which === 'model') setModel(v); else setHold(v)
    setAutoPlay(true)
  }

  const goStep = (s: number) => {
    if (s === 5) { setPage('report'); return }
    if (searching) return
    if (s === 1) { setView('library'); setModel(false); setHold(false); setStep(ranLib ? 1 : 0); if (ranLib) setHeld(libHeld()) }
    if (s === 2) { if (hole) { setView('hole'); setModel(false); setHold(false); setStep(2) } else findHole() }
    if (s === 3 && hole) { setView('hole'); setStep(3) }
    if (s === 4 && hole) { setView('hole'); if (!model) { setModel(true); setAutoEnd(true) } setStep(4) }
  }
  const libHeld = (): Shown => {
    const m = libSc!.runs.base.metrics
    return { w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt }
  }

  const main = (() => {
    if (step === 0) return { label: 'Запустить атаку', on: () => { setStep(1); play(true) }, disabled: !run }
    if (step === 1) return { label: 'Найти дыру', on: findHole, disabled: false }
    if (step === 2) return { label: searching ? 'Ищем дыру...' : 'Запустить найденную атаку', on: () => { setStep(3); play(true) }, disabled: searching || !hole }
    if (step === 3) return { label: 'Что видит клиент', on: () => goStep(4), disabled: !hole }
    return { label: 'Отчёт краш-теста', on: () => setPage('report'), disabled: false }
  })()

  // Автопоказ ведёт те же обработчики, что клавиши и кнопки. Стадия: действие -> ждём её конца -> пауза -> следующая
  const startTour = () => { setIntro(false); setTour(0) }
  // закрыли вход кнопкой: фокус на главную кнопку шага, клавиатура продолжает с неё
  const leaveIntro = () => { setIntro(false); setTimeout(() => mainBtn.current?.focus({ preventScroll: true }), 40) }
  // знак в шапке возвращает на вход без перезагрузки: двойник как при первом открытии, найденная дыра остаётся в памяти
  const goHome = () => {
    setTour(null); stopRaf(); setFeed((f) => ({ ...f, open: false })); setHowOpen(false); setSearching(false)
    setView('library'); setModel(false); setHold(false); setStep(0); setRanLib(false); setHeld({ w: 0, s: 0, att: 0 })
    setPhase('idle'); setTime(span.start); setIntro(true); history.replaceState(null, '', ' ')
  }
  // «Как устроено»: задача кейса ведёт на свой шаг из любого состояния, дыра при необходимости подгружается без анимации поиска
  const jump = (s: number) => {
    setHowOpen(false); setIntro(false); setTour(null); history.replaceState(null, '', ' ')
    if (searching) return
    if (s === 1) {
      if (view === 'library' && !model && !hold) { setStep(1); play(true) }
      else { setView('library'); setModel(false); setHold(false); setStep(1); setAutoPlay(true) }
    } else if (s === 2 || hole) goStep(s)
    else {
      loadRedteam(scKey, ctx).then((r) => {
        const m = r.data.best.metrics
        setHole(r.data); setSource(r.source); setHeld({ w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt })
        setView('hole'); setHold(false); setModel(s === 4); if (s === 4) setAutoEnd(true); setStep(s as Step)
      }).catch((e) => setHoleErr(String(e.message ?? e)))
    }
  }
  const pickBank = (id: string) => {
    if (id === 'custom') { setCalibOpen(true); return }
    const p = bank?.calib_presets.find((x) => x.id === id)
    if (p && id !== ctx.preset) applyCalib(p.values).catch((e) => setError(String(e.message ?? e)))
  }
  const stopTour = () => setTour(null)
  // «Как устроено» получает свой адрес: ссылку на лист можно отправить жюри
  const openHow = () => { setHowOpen(true); history.replaceState(null, '', '#how') }
  const acts = useRef<Record<TourId, () => void>>(null!)
  acts.current = {
    attack: () => { setStep(1); play(true) },
    hole: findHole,
    holeRun: () => { setStep(3); play(true) },
    defense: () => toggleMeasure('model', true),
    client: () => goStep(4),
    report: () => { setTour(null); setPage('report') },
  }
  const tourId = tour == null ? null : TOUR[tour].id
  useEffect(() => {
    if (tourId == null) return
    setArmed(false)
    acts.current[tourId]()
    const id = setTimeout(() => setArmed(true), 700)
    return () => clearTimeout(id)
  }, [tourId])
  const tourOver = tourId === 'hole' ? step === 2 && !searching && view === 'hole'
    : tourId === 'client' ? phone.after != null
      : tourId === 'attack' || tourId === 'holeRun' || tourId === 'defense' ? phase === 'done' : false
  useEffect(() => {
    if (tourId == null || !armed || !tourOver) return
    // без движения стадия заканчивается сразу: держим подпись дольше, чтобы её успели прочитать
    const id = setTimeout(() => setTour((k) => (k == null ? k : k + 1)), reduced() ? Math.max(TOUR_DWELL[tourId], 5200) : TOUR_DWELL[tourId])
    return () => clearTimeout(id)
  }, [tourId, armed, tourOver])
  // найденную атаку целиком не ждём: 6,4 с хватает, чтобы увидеть короткий путь денег и дочитать подпись
  const skipRef = useRef(skip)
  skipRef.current = skip
  useEffect(() => {
    if (tourId !== 'holeRun' || !armed || phase !== 'playing') return
    const id = setTimeout(() => skipRef.current(), 6400)
    return () => clearTimeout(id)
  }, [tourId, armed, phase])

  // клавиши для показа: стрелка вправо = главная кнопка, пробел = пауза, End = в конец, 1 и 2 = меры
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (page !== 'twin' || calibOpen || howOpen || feed.open) return
    const el = (e.target instanceof HTMLElement ? e.target : document.body)
    if (el.closest('input, textarea, [role="listbox"], [role="dialog"]')) return
    // вход: первая стрелка или Esc открывают двойник, атака не запускается
    if (intro) { if (e.key === 'ArrowRight' || e.key === 'Escape') { e.preventDefault(); leaveIntro() } return }
    // автопоказ: Esc отдаёт управление, остальные клавиши ждут
    if (tour != null) { if (e.key === 'Escape') { e.preventDefault(); stopTour() } return }
    if (e.key === 'ArrowRight' && !main.disabled) { e.preventDefault(); main.on() }
    else if (e.key === ' ' && !searching && el.tagName !== 'BUTTON' && el.tagName !== 'SUMMARY') { e.preventDefault(); togglePlay() }
    else if (e.key === 'End' && !searching) { e.preventDefault(); skip() }
    else if (step === 3 && (e.key === '1' || e.key === '2')) toggleMeasure(e.key === '1' ? 'model' : 'hold', e.key === '1' ? !model : !hold)
    else if (step === 4 && e.key === 'Escape') { e.preventDefault(); goStep(3) } // фокус мог уйти с карточки после отмены перевода
    else if ((step === 3 || step === 4) && (e.code === 'KeyK' || e.key === '3') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goStep(step === 3 ? 4 : 3) }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (error) return <Fatal msg={error} />
  if (!bank || !sc || !run || !final) return <Splash />
  if (page === 'report') return <Report ctx={ctx} onBack={() => { setPage('twin'); history.replaceState(null, '', ' ') }} />

  const per10k = bank.honest_cost[rk].delayed_per_10k
  const thr = bank.model?.threshold ?? 0.3
  const fresh = step === 0
  // автопоказ рассказывает про демо-схему, поэтому из панели он доступен только на ней
  const tourReady = scKey === 'student_crypto' && ctx.preset === 'demo'
  const guided = intro || tour != null
  const search: SearchState | null = searching ? { data: hole, n: searchN, error: holeErr, finished: searchFinished } : null
  const holeRuns = hole?.scenario.runs

  return (
    <div className={`app-glow app-h relative isolate flex flex-col bg-scene text-ink lg:h-screen lg:overflow-hidden lg:pb-0 ${intro ? '' : 'pb-(--bar-h)'}`}>
      <header className="chrome z-30 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/[0.06] px-4 py-2 text-ivory lg:h-16 lg:flex-nowrap lg:px-6 lg:py-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <button className="-m-1 shrink-0 rounded-xl p-1" onClick={goHome} aria-label="Fraud Twin: на вход" title="На вход"><BrandMark /></button>
          <h1 className="whitespace-nowrap text-[21px] font-semibold leading-none tracking-[-0.02em]">Fraud <span className="text-gold-ink">Twin</span></h1>
        </div>
        <Segments step={step} hasHole={!!hole && !searching} busy={searching} locked={guided} onPick={goStep} />
        <div className="flex items-center gap-x-2 max-lg:ml-auto">
          <button className="ctl ctl-scene !px-4 !text-[16px] !font-medium max-xl:w-12 max-xl:!px-0" onClick={openHow} inert={tour != null} aria-label="Как устроено: четыре задачи кейса, словарь, ограничения">
            <Info size={18} strokeWidth={1.5} aria-hidden /><span className="max-xl:hidden">Как устроено</span>
          </button>
          <span inert={guided}><BankSelect bank={bank} preset={ctx.preset} disabled={searching} onPick={pickBank} /></span>
        </div>
      </header>
      <Calibration open={calibOpen} bank={bank} live={source === 'api'} onApply={applyCalib} onClose={() => setCalibOpen(false)} />
      <How open={howOpen} bank={bank} onClose={() => { setHowOpen(false); if (location.hash === '#how') history.replaceState(null, '', ' ') }} onStep={jump} />
      <FeedDialog open={feed.open} tab={feed.tab} setTab={(tab) => setFeed({ open: true, tab })} onClose={() => setFeed((f) => ({ ...f, open: false }))}
        sc={sc} log={log} honest={bank.honest_feed?.[rk]} thr={thr} measure={MEASURE_RU[rk]} />

      <main className={`flex flex-1 flex-col lg:grid lg:min-h-0 ${intro ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_max(400px,32vw)] short:grid-cols-[minmax(0,1fr)_max(440px,35vw)]'}`}>
        <div className={`order-2 flex min-h-0 flex-col lg:order-none ${intro ? 'flex-1' : ''} ${clientOpen ? 'max-lg:relative max-lg:z-40' : ''}`}>
          <Scene sc={sc} log={log} freezes={run.freezes} t={t} done={phase === 'done'} span={span} playing={phase === 'playing'}
            presets={bank.presets} scKey={scKey} onScheme={setScKey} busy={searching} isHole={view === 'hole'}
            search={search} onRetrySearch={findHole}
            onPlay={togglePlay} onSkip={skip} phase={phase}
            mark={clientOpen && phone.level && phone.level !== 'low' && !phone.after ? clientChain : null}
            gone={phone.after === 'cancel' ? clientChain : null} aside={clientOpen || intro} intro={intro}
            overlay={<>
              <AnimatePresence>{clientOpen && <ClientCard key="client" data={client?.data ?? (client === undefined ? undefined : null)}
                auto={tourId === 'client'} falsePer10k={client?.robust?.honest.high_per_10k ?? client?.data?.stats.honest.high_per_10k}
                onState={onPhone} onClose={() => { stopTour(); goStep(3) }} />}</AnimatePresence>
              <AnimatePresence>{intro && <Landing key="intro" clients={bank.summary.clients} onStart={() => { leaveIntro(); setStep(1); play(true) }} onTour={startTour} onHow={openHow} />}</AnimatePresence>
              {tour != null && <TourCaption i={tour} onStop={stopTour} />}
              {/* табличка сцены: какую задачу кейса закрывает шаг. В автопоказе её говорит подпись, на поиске дыры место занято графиком */}
              {!intro && tour == null && !searching && !clientOpen && <CaseTask step={step} onHow={openHow} />}
              {!intro && tour == null && clientOpen && <span className="max-lg:hidden"><CaseTask step={step} onHow={openHow} narrow /></span>}
            </>} />
        </div>

        {!fresh && <NumberStrip shown={shown} per10k={per10k} />}
        <aside className={`order-3 min-h-0 flex-col lg:order-none lg:border-l lg:border-white/[0.06] ${intro ? 'hidden' : 'flex'}`} aria-label="Итог" inert={tour != null}>
          <div className="hidden lg:block">
            {fresh ? <Invite clients={bank.summary.clients} onTour={tourReady ? startTour : undefined} /> : <NumberBlock shown={shown} per10k={per10k} />}
          </div>
          <div key={step} className="step-in min-h-0 flex-1 space-y-4 px-4 pb-4 pt-2 lg:overflow-y-auto lg:px-8 short:space-y-2.5 short:px-6 short:pb-3 short:pt-2.5">
            {step === 0 && <><Rules bank={bank} hits={null} /><SceneWords /></>}
            {step === 1 && <><Rules bank={bank} hits={phase === 'done' ? final.rule_hits : liveHits(log, run.freezes, t)} note={phase === 'done' ? caughtNote(final) : undefined} /><SceneWords /></>}
            {step === 2 && <HoleDiff data={hole} searching={searching} />}
            {step === 3 && holeRuns && <>
              <div className="space-y-2">
                <Measure on={model} set={(v) => toggleMeasure('model', v)} hotkey="1" title="Модель на графе переводов" hint="смотрит на связи карты, а не на один перевод" />
                <Measure on={hold} set={(v) => toggleMeasure('hold', v)} hotkey="2" title="Задержка первого перевода" note="сценарий, в РК для переводов не действует" />
              </div>
              <FeedPanel sc={sc} log={log} honest={bank.honest_feed?.[rk]} t={t} all={phase === 'done' || phase === 'idle'} thr={thr}
                onOpen={(tab) => setFeed({ open: true, tab })} />
              <Unseen model={bank.model} />
            </>}
            {step === 4 && <ClientPrice check={client} />}
          </div>
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-scene/85 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-lg lg:static lg:z-10 lg:border-0 lg:bg-transparent lg:px-8 lg:py-5 lg:backdrop-blur-none short:px-6 short:py-3">
            <button ref={mainBtn} className="ctl ctl-main w-full !justify-between whitespace-nowrap !px-6 !text-[18px] max-sm:!px-5 max-sm:!text-[16px]" onClick={main.on} disabled={main.disabled} aria-keyshortcuts="ArrowRight">
              {main.label}
              <ArrowRight size={20} strokeWidth={1.75} className="next" aria-hidden />
            </button>
          </div>
        </aside>
      </main>
      <p className="sr-only" aria-live="polite">{phase === 'done' ? `Атака закончена: выведено ${kzt(final.withdrawn_kzt)}` : ''}</p>
    </div>
  )
}

function liveMetrics(log: TxEvent[], freezes: Freeze[], t: number) {
  let withdrawn = 0, stopped = 0
  for (const e of log) {
    if (e.t > t) break
    // на стыке отрезок краснеет и число прибавляет сумму
    if (e.kind === 'cashout' && e.status === 'ok' && e.t + LINE_MIN <= t) withdrawn += e.amount
    if (e.kind === 'victim' && STOP.has(e.status)) stopped += e.amount
  }
  const chains = new Set<number>()
  for (const f of freezes) if (f.t <= t) { stopped += f.balance; chains.add(f.chain) }
  return { withdrawn, stopped, chains: chains.size }
}

function liveHits(log: TxEvent[], freezes: Freeze[], t: number) {
  const h: Record<string, number> = {}
  for (const f of freezes) if (f.t <= t && f.rule) h[f.rule] = (h[f.rule] ?? 0) + 1
  for (const e of log) if (e.t <= t && e.rule && STOP.has(e.status) && e.status !== 'frozen_dst') h[e.rule] = (h[e.rule] ?? 0) + 1
  return h
}

const MEASURE_RU: Record<string, string> = {
  base: 'Найденная атака против текущих правил банка', model: 'Найденная атака, включена модель на графе переводов',
  hold: 'Найденная атака, включена задержка первого перевода (сценарий)', model_hold: 'Найденная атака, включены модель и задержка первого перевода (сценарий)',
}

// Профиль банка в шапке: тот же движок под другой банк одним выбором (v19: без пометки над названием)
function BankSelect({ bank, preset, disabled, onPick }: { bank: Bank; preset: string | null; disabled: boolean; onPick: (id: string) => void }) {
  const items = [...bank.calib_presets.map((p) => ({ value: p.id, label: p.name, note: p.note })), { value: 'custom', label: 'Свой профиль', note: 'свои агрегаты ползунками' }]
  return (
    <Select.Root items={items} value={preset ?? 'custom'} onValueChange={(v) => v && onPick(v as string)} disabled={disabled}>
      <Select.Trigger aria-label="Профиль банка" className="ctl ctl-scene !justify-between !gap-2.5 !px-4 text-left data-[disabled]:opacity-45 max-sm:w-12 max-sm:!justify-center max-sm:!px-0">
        <Landmark size={18} strokeWidth={1.5} className="shrink-0 text-mist" aria-hidden />
        <Select.Value className="block whitespace-nowrap text-[16px] font-medium max-sm:hidden" />
        <Select.Icon className="shrink-0 max-sm:hidden"><ChevronDown size={18} strokeWidth={1.5} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} align="end" alignItemWithTrigger={false} className="z-40">
          <Select.Popup className="w-[min(340px,calc(100vw-24px))] rounded-2xl border border-scene-line bg-scene-2 p-1.5 text-ivory shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] outline-none
            origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
            {items.map((p) => (
              <Select.Item key={p.value} value={p.value}
                className={`flex cursor-default items-start gap-3 rounded-xl px-3 py-2.5 outline-none select-none data-[highlighted]:bg-scene-3 ${p.value === 'custom' ? 'mt-1 border-t border-white/[0.07] !rounded-t-none pt-3' : ''}`}>
                <span className="mt-1 w-4 shrink-0"><Select.ItemIndicator><Check size={16} strokeWidth={1.5} /></Select.ItemIndicator></span>
                <span className="min-w-0">
                  <Select.ItemText className="block text-[16px] font-medium">{p.label}</Select.ItemText>
                  <span className="block text-[14px] leading-snug text-mist">{p.note}</span>
                </span>
              </Select.Item>
            ))}
            <p className="px-3 pb-2 pt-2 text-[14px] leading-snug text-scene-ink-3">Тот же движок, другие агрегаты. Данные клиентов не нужны.</p>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

// Сегменты шагов на Base UI ToggleGroup: одна строка, активная плашка скользит
function Segments({ step, hasHole, busy, locked, onPick }: { step: Step; hasHole: boolean; busy: boolean; locked: boolean; onPick: (s: number) => void }) {
  const items = [{ s: 1, t: 'Атака' }, { s: 2, t: 'Дыра' }, { s: 3, t: 'Защита' }, { s: 4, t: 'Клиент' }, { s: 5, t: 'Отчёт' }]
  const cur = Math.max(1, step)
  return (
    <ToggleGroup value={[String(cur)]} onValueChange={(v) => v[0] && onPick(Number(v[0]))} aria-label="Шаги краш-теста" inert={locked}
      className="flex rounded-full border border-white/10 bg-white/[0.035] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md max-lg:order-last max-lg:w-full lg:mx-auto">
      {items.map((it) => (
        <Toggle key={it.s} value={String(it.s)} disabled={busy || ((it.s === 3 || it.s === 4) && !hasHole)} aria-current={cur === it.s ? 'step' : undefined}
          title={(it.s === 3 || it.s === 4) && !hasHole ? 'Откроется после шага «Дыра»' : undefined}
          aria-label={(it.s === 3 || it.s === 4) && !hasHole ? `${it.t}: откроется после шага «Дыра»` : `Шаг ${it.s} из 5: ${it.t}`}
          className="relative h-11 lg:h-10 flex-1 whitespace-nowrap rounded-full px-4 text-[17px] font-medium max-sm:px-1 max-sm:text-[15px] xl:px-5 text-mist transition-colors duration-[120ms] hover:text-ivory data-[pressed]:text-ivory disabled:opacity-40 lg:flex-none">
          {cur === it.s && <motion.span layoutId="seg" className="seg-gold absolute inset-0 rounded-full" transition={{ duration: reduced() ? 0 : 0.22, ease: [0.2, 0, 0, 1] }} />}
          <span className="relative">{it.t}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

// знак Fraud Twin (v19): буква F и её близнец, повёрнутый на 180°. Зазор между перекладинами - дыра. Тот же знак в public/logo-mark.svg и favicon.svg
function BrandMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id="ft-g" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="20" y2="28">
          <stop offset="0" stopColor="#4f7bff" /><stop offset="0.5" stopColor="#6d3cf5" /><stop offset="1" stopColor="#9000f8" />
        </linearGradient>
      </defs>
      <g fill="url(#ft-g)"><rect x="4" y="4" width="5" height="24" rx="1.3" /><rect x="4" y="4" width="16" height="5" rx="1.3" /><rect x="4" y="13.5" width="10" height="5" rx="1.3" /></g>
      <g fill="#c39bff"><rect x="23" y="4" width="5" height="24" rx="1.3" /><rect x="12" y="23" width="16" height="5" rx="1.3" /><rect x="18" y="13.5" width="10" height="5" rx="1.3" /></g>
    </svg>
  )
}

function Splash() {
  // та же разметка, что в index.html до загрузки кода: экран не мигает и не стоит пустым
  return <div className="boot" role="status"><div><b>Fraud <i>Twin</i></b><p>Строим двойник банка...</p><span aria-hidden /></div></div>
}

function Fatal({ msg }: { msg: string }) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-[480px]">
        <div className="text-[22px] font-semibold text-leak">Не удалось загрузить данные двойника</div>
        <p className="mt-2 text-[16px] text-ink-2">{msg}</p>
        <button className="ctl ctl-quiet mt-5" onClick={() => location.reload()}>Обновить страницу</button>
      </div>
    </div>
  )
}
