import { ViewTransition, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { animate, motion, MotionConfig, useMotionValue } from 'motion/react'
import NumberFlow from '@number-flow/react'
import { ease, flow, numberTiming, prefersReduced, spring } from './motion'
import { Popover } from '@base-ui/react/popover'
import { ArrowRight, Check, Info, Landmark, Menu, Play } from 'lucide-react'
import { DEMO_CTX, editable, hasApi, honestPrices, loadBank, loadClientCheck, loadReadyHole, isLowerBound, profilePct, type ClientCheck, runRedteam, RuleError, rulesDiff, sameRules, warmApi, type RedteamResult, type RuleErr, type RuleSet, loadScenario, runKey, type Bank, type Calib, type Ctx, type Freeze, type Redteam, type RunKey, type Scenario, type TxEvent } from './data'
import Calibration from './Calibration'
import { FeedDialog } from './Feed'
import How from './How'
import ClientScreen, { ClientSide, ClientTabs, type PhoneState } from './ClientCard'
import { TOUR, TourCaption, type TourId } from './Intro'
import { EntryPlate, EntryTiles, useEntryFacts } from './Entry'
import { LANGS, useLang, type Lang } from './i18n'
import { Dec, STEP_TONE, StepTile } from './ui'
import { Sat, StepHead } from './StepMotion'
import Report, { prefetchReport, reportReady } from './Report'
import Scene, { LINE_MIN, SPEED } from './Scene'
import { SceneWordsPill, type Shown } from './Panel'
import { AiPlate, HonestPlate, MeasureRow, MeasuresHead } from './Defense'
import { intl, kzt, kztShort } from './format'
import { insteadText, RulesEditor, type ApiState } from './RulesEditor'
import { TradeoffMap, type ModelMark } from './Tradeoff'
import { type Round } from './Rounds'
import { Changes, MapTabs, runningPct, SearchMap, type MapState, type MapTab } from './Gap'

const STOP = new Set(['blocked', 'suspended', 'cancelled', 'frozen_src', 'frozen_dst'])
const SEARCH_MS = 9000 // анимация 200 попыток
const SEARCH_MS_AGAIN = 4500 // следующие раунды: зритель уже видел поиск, ждать 9 с каждый раз долго
type Phase = 'idle' | 'playing' | 'paused' | 'done'
type Step = 0 | 1 | 2 | 3 | 4 // 4 - «Клиент», отчёт открывается отдельной страницей
// автопоказ: сколько держим кадр после того, как стадия закончилась
// v17: паузы под длину подписей (с задачей кейса 17-30 слов): на стадию не меньше 2,5 слова в секунду плюс 1,5 с, весь показ около минуты
const TOUR_DWELL: Record<TourId, number> = { attack: 3400, hole: 2600, holeRun: 2800, defense: 4800, client: 4800, report: 0 }
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// моушн-бриф, раздел 9: при «Уменьшить движение» Motion сам снимает переезды и сдвиги, остаётся opacity.
// Обёртка здесь, а не в main.tsx: телефон по QR (#client) не тянет Motion в первый бандл
export default function App() {
  return <MotionConfig reducedMotion="user"><Twin /></MotionConfig>
}

function Twin() {
  const { t: tr, lang } = useLang()
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
  const lastPct = useRef(0) // процент на плитке «Дыры», пока ответ поиска ещё не пришёл
  // «Перелив» (моушн-бриф, раздел 4): ключ смены шага для плитки; шаг 0 и 1 стоят в одной раскладке
  const flowKey = Math.max(1, step)
  // кегль числа у шагов разный (176 / 168 / 188 / 136 px): размер меняется сразу, а глазу его плавно ведёт scale (FLIP по кеглю, только transform)
  const numEl = useRef<HTMLDivElement>(null)
  const numScale = useMotionValue(1)
  const numSize = useRef(0)
  useLayoutEffect(() => {
    const el = numEl.current
    if (!el) { numSize.current = 0; return }
    const px = parseFloat(getComputedStyle(el).fontSize)
    const was = numSize.current
    numSize.current = px
    if (!was || Math.abs(was - px) < 1 || reduced()) return
    numScale.set(was / px)
    const a = animate(numScale, 1, spring.tile)
    return () => a.stop()
  }, [flowKey, numScale])
  // первые 0,9 с после входа в двойник действует порядок входа «Атаки» (раздел 6.1), дальше - порядок «Перелива»
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (intro) { setEntered(false); return }
    const id = window.setTimeout(() => setEntered(true), 900)
    return () => window.clearTimeout(id)
  }, [intro])
  // автопоказ «за минуту»: номер стадии из TOUR или null
  const [tour, setTour] = useState<number | null>(null)
  const [armed, setArmed] = useState(false)
  // шаг «Клиент»: проверка перевода, undefined - ещё не загружена
  const [client, setClient] = useState<{ data: ClientCheck | null; robust: ClientCheck['robust'] | null } | undefined>(undefined)
  const [phone, setPhone] = useState<PhoneState>({ level: null, after: null })
  const [clientPick, setClientPick] = useState<string | null>(null)
  // F5: цена мер для честных при своих правилах (POST /whatif), ключ - ответ поиска, для которого посчитана
  const [prices, setPrices] = useState<{ of: Redteam; v: Partial<Record<RunKey, number>> | null } | null>(null)
  const clientOpen = step === 4
  const timeRef = useRef(0)
  const raf = useRef<number | null>(null)
  // F7: язык, на котором пришли данные. При смене языка повторяем те же запросы: числа совпадают, меняются тексты
  const langRef = useRef(lang)
  langRef.current = lang
  const got = useRef({ bank: lang, lib: lang, hole: lang, client: lang })
  // правила, с которыми считана текущая дыра: перевод дыры на другой язык повторяет тот же запрос
  const holeReq = useRef<RuleSet>({})
  // сцена после перевода та же: id сценария переносится на переведённый объект, проигрывание не сбрасывается
  const scIds = useRef(new WeakMap<object, number>())
  const scNext = useRef(0)
  const idOf = (o: object) => { let v = scIds.current.get(o); if (v == null) { v = ++scNext.current; scIds.current.set(o, v) } return v }
  // F3: свои правила. profile - пороги профиля банка, draft - редактор, lastRules - с чем считан текущий раунд
  // смена языка приносит тот же профиль с другими подписями: при том же ctx и тех же порогах объект профиля остаётся прежним,
  // раунды и черновик живут. Новый банк (калибровка) всегда приходит с новым ctx и сбрасывает раунды.
  // v20-fix D1: раньше держалось на флаге, который сбрасывал эффект соседнего рендера, и раунды иногда обнулялись при смене языка
  const profileRef = useRef<{ ctx: Ctx; p: RuleSet } | null>(null)
  const profile = useMemo<RuleSet>(() => {
    const p = bank ? editable(bank.rule_meta, bank.rules) : {}
    const prev = profileRef.current
    if (prev && bank && prev.ctx === ctx && Object.keys(prev.p).length && sameRules(p, prev.p)) return prev.p
    profileRef.current = { ctx, p }
    return p
  }, [bank, ctx])
  const [draft, setDraft] = useState<RuleSet>({})
  const [lastRules, setLastRules] = useState<RuleSet | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  // вау 1: нижняя плита «Дыры» - карта поиска или карта компромисса
  const [mapTab, setMapTab] = useState<MapTab>('search')
  // моушн-бриф 6.2: при входе на шаг плита карты въезжает справа, при смене вкладки карты сменяются кроссфейдом со сдвигом 12 px к вкладке
  const [mapEnter, setMapEnter] = useState('in-r')
  const pickMapTab = (v: MapTab) => { setMapEnter(v === 'tradeoff' ? 'tab-in-r' : 'tab-in-l'); setMapTab(v) }
  useEffect(() => { if (step !== 2) setMapEnter('in-r') }, [step])
  // v21: эпоха ленты растёт при каждом сбросе раундов, поздний ответ для строки «Правила профиля» в новую ленту не попадает
  const roundsEpoch = useRef(0)
  const roundsRef = useRef<Round[]>([])
  roundsRef.current = rounds
  const [ruleErr, setRuleErr] = useState<RuleErr | null>(null)
  // вау 1: точка модели на карте компромисса (модель против уже найденной атаки), живёт в той же эпохе, что и лента раундов
  const [modelMark, setModelMark] = useState<(ModelMark & { ep: number }) | null>(null)
  const [api, setApi] = useState<ApiState>(hasApi ? 'checking' : 'static')
  useEffect(() => { setDraft(profile); setLastRules(null); setRounds([]); roundsEpoch.current++; setRuleErr(null) }, [profile])
  // прогрев /health при загрузке: холодный старт функции не съедает первые секунды проверки
  useEffect(() => { if (hasApi) warmApi().then((ok) => setApi((a) => (a === 'ok' ? a : ok ? 'ok' : 'down'))) }, [])

  useEffect(() => {
    const l = langRef.current
    loadBank(DEMO_CTX, l).then((r) => { got.current.bank = l; setBank(r.data); setSource(r.source) }).catch((e) => setError(String(e.message ?? e)))
  }, [])

  const applyCalib = useCallback(async (c: Calib) => {
    const p = bank?.calib_presets.find((x) => bank.calib_fields.every((f) => x.values[f.key] === c[f.key]))
    const next: Ctx = { calib: c, preset: p?.id ?? null }
    const l = langRef.current
    const r = await loadBank(next, l)
    got.current.bank = l
    setBank(r.data); setSource(r.source); setCtx(next)
    setModel(false); setHold(false); setCalibOpen(false)
  }, [bank])

  // смена языка: профиль банка (названия правил, схем, профилей) приходит заново, числа те же
  useEffect(() => {
    if (!bank || got.current.bank === lang) return
    let alive = true
    loadBank(ctx, lang).then((r) => {
      if (!alive) return
      got.current.bank = lang
      setBank(r.data)
    }).catch(() => { /* не перевели: остаются прежние подписи, числа верные */ })
    return () => { alive = false }
  }, [lang, bank, ctx])

  useEffect(() => {
    let alive = true
    const l = langRef.current
    loadScenario(scKey, ctx, l)
      .then((r) => { if (alive) { got.current.lib = l; setLibSc(r.data); setSource(r.source); setError(null) } })
      .catch((e) => alive && setError(String(e.message ?? e)))
    setHole(null); setView('library'); setSearching(false); setRanLib(false); setStep(0); setRounds([]); roundsEpoch.current++; setLastRules(null)
    setModel(false); setHold(false); setHeld({ w: 0, s: 0, att: 0 })
    setClient(undefined); setClientPick(null)
    return () => { alive = false }
  }, [scKey, ctx])

  // смена языка: сценарий библиотеки и найденная дыра приходят переведёнными, шаг и проигрывание остаются
  useEffect(() => {
    if (!libSc || got.current.lib === lang) return
    let alive = true
    const old = libSc
    loadScenario(scKey, ctx, lang).then((r) => {
      if (!alive || r.data.scheme.key !== old.scheme.key) return
      got.current.lib = lang
      scIds.current.set(r.data, idOf(old))
      setLibSc(r.data)
    }).catch(() => { /* остаются прежние подписи */ })
    return () => { alive = false }
  }, [lang, libSc, scKey, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hole || searching || got.current.hole === lang) return
    let alive = true
    const old = hole
    // живой поиск детерминирован: тот же запрос даёт те же числа. Готовый прогон берём готовым на другом языке
    const next = old.source === 'live'
      ? runRedteam(scKey, ctx, lang, holeReq.current).then((r) => (r.source === 'live' ? r.data : null))
      : loadReadyHole(scKey, ctx, lang)
    next.then((d) => {
      if (!alive) return
      got.current.hole = lang
      if (!d || d.best.metrics.withdrawn_kzt !== old.best.metrics.withdrawn_kzt) return // числа разошлись: оставляем прежний ответ
      scIds.current.set(d.scenario, idOf(old.scenario))
      setPrices((p) => (p?.of === old ? { of: d, v: p.v } : p))
      setHole(d)
    }).catch(() => { got.current.hole = lang })
    return () => { alive = false }
  }, [lang, hole, searching, scKey, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!client || got.current.client === lang) return
    let alive = true
    loadClientCheck(scKey, ctx, lang).then((r) => { if (alive) { got.current.client = lang; setClient(r) } })
    return () => { alive = false }
  }, [lang, client, scKey, ctx])

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
  const scId = sc ? idOf(sc) : 0
  useEffect(() => { stopRaf(); setPhase('idle'); setTime(span.start) }, [span.start, span.end, rk, scId, setTime])

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
    const l = langRef.current
    loadClientCheck(scKey, ctx, l).then((r) => { if (alive) { got.current.client = l; setClient(r) } })
    return () => { alive = false }
  }, [step, client, scKey, ctx])
  useEffect(() => { if (step !== 4 || page !== 'twin') setPhone({ level: null, after: null }) }, [step, page])
  const onPhone = useCallback((p: PhoneState) => setPhone(p), [])
  // цепочка этого перевода на сцене: тот же получатель (карта по маске) и та же сумма
  const clientChain = useMemo(() => {
    const c = client?.data?.cases[clientPick && client.data.cases[clientPick] ? clientPick : client.data.demo]
    const digits = c?.transfer.recipient.card_mask.match(/(\d{4})\s*$/)?.[1]
    if (!c || !digits) return null
    const e = log.find((x) => x.kind === 'victim' && x.amount === c.transfer.amount && String(1000 + (x.dst % 9000)) === digits)
    return e ? e.chain : null
  }, [client, clientPick, log])

  const final = run?.metrics
  const live = useMemo(() => liveMetrics(log, run?.freezes ?? [], t), [log, run, t])
  useEffect(() => {
    if (phase === 'done' && final) {
      setHeld({ w: final.withdrawn_kzt, s: final.intercepted_kzt, att: final.attempted_kzt })
      if (view === 'library') setRanLib(true)
    }
  }, [phase, final, view])

  // Раунд: что считали, чем кончилось. Запасной готовый прогон честно записан как раунд с правилами профиля
  const recordRound = useCallback((r: RedteamResult, wanted: RuleSet, vsModel = false) => {
    const d = r.data
    const live = r.source === 'live'
    // готовый прогон посчитан для правил профиля: свои пороги остаются непроверенными, кнопка снова «Проверить мои правила»
    if (!live) setLastRules(profile)
    const round = { asked: live ? d.rules_changed ?? [] : [], wanted: live ? {} : wanted, source: r.source, fallback: r.fallback, pct: d.best.pct,
      withdrawn: d.best.metrics.withdrawn_kzt, honest: live ? d.honest?.delayed_per_10k ?? null : bank?.honest_cost.base.delayed_per_10k ?? null,
      atLeast: isLowerBound(d), profilePct: live ? profilePct(d) : null }
    setRounds((rs) => [...rs, { n: rs.length + 1, ...round, vsModel: vsModel && live }])
    if (live) setApi('ok')
    // v21 (wow-v21, п. 1): банк поменял пороги до первого захода на «Дыру» - в ленту первой строкой ставим «Правила профиля»,
    // поиск по правилам профиля (живой или готовый прогон, числа те же). Не пришёл - лента остаётся как есть
    if (!roundsRef.current.length && live && (round.asked.length > 0 || vsModel)) {
      const ep = roundsEpoch.current
      runRedteam(scKey, ctx, lang, null).then((p) => {
        if (ep !== roundsEpoch.current) return
        const pd = p.data
        const row: Round = { n: 1, asked: [], wanted: {}, source: p.source, fallback: null, pct: pd.best.pct, withdrawn: pd.best.metrics.withdrawn_kzt,
          honest: bank?.honest_cost.base.delayed_per_10k ?? null, base: true, atLeast: isLowerBound(pd) }
        setRounds((rs) => (rs.some((x) => x.base) || rs[0]?.asked.length === 0 ? rs : [row, ...rs].map((x, i) => ({ ...x, n: i + 1 }))))
      }).catch(() => { /* без строки профиля: остальная лента верна */ })
    }
  }, [bank, profile, scKey, ctx, lang])

  // ИИ-мошенник ищет дыру в правилах из редактора: 200 попыток проигрываются за 9 с (следующие раунды 4,5 с).
  // 422 возвращает на шаг правил и подсвечивает строку с границами; таймаут и отказ дают готовый прогон с подписью
  // vsModel: раунд «ИИ против модели» - тот же поиск, но к правилам из редактора добавлена включённая модель (F5)
  const runSearch = useCallback((vsModel: boolean) => {
    if (phase === 'playing') skip()
    const back = (step < 2 ? step : 1) as Step
    const prev = { hole, rules: lastRules }
    setHeld((h) => (view === 'hole' ? { w: 0, s: 0, att: 0 } : h))
    setStep(2); setSearching(true); setSearchN(0); setHole(null); setHoleErr(null); setView('library')
    setModel(false); setHold(false); setRuleErr(null); setLastRules(draft)
    const wanted = vsModel ? { ...rulesDiff(draft, profile), model_on: true } : rulesDiff(draft, profile)
    const l = lang
    runRedteam(scKey, ctx, l, wanted)
      .then((r) => { got.current.hole = l; holeReq.current = wanted; setHole(r.data); setSource(r.source === 'live' ? 'api' : 'json'); recordRound(r, wanted, vsModel) })
      .catch((e) => {
        if (e instanceof RuleError) {
          setRuleErr(e.detail); setSearching(false); setHole(prev.hole); setLastRules(prev.rules)
          setView('library'); setStep(back)
        } else setHoleErr(String(e.message ?? e))
      })
  }, [scKey, ctx, lang, phase, skip, step, hole, lastRules, view, draft, profile, recordRound])
  const findHole = useCallback(() => runSearch(false), [runSearch])

  useEffect(() => {
    if (!searching || !hole) return
    const total = hole.history.length
    if (reduced()) { setSearchN(total); return }
    // таймер, а не rAF: поиск доигрывается и в фоновой вкладке
    const t0 = performance.now()
    const ms = rounds.filter((x) => !x.base).length > 1 ? SEARCH_MS_AGAIN : SEARCH_MS
    const id = setInterval(() => {
      const k = Math.min(total, Math.ceil(((performance.now() - t0) / ms) * total))
      setSearchN(k)
      if (k >= total) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [searching, hole])

  const searchFinished = !!hole && searching && searchN >= hole.history.length
  // поиск идёт - видна карта поиска; после второго хода банка или раунда «ИИ против модели» плита сама переходит на карту компромисса.
  // Срабатывает только на новый раунд: если жюри вернулось к карте поиска, выбор остаётся до следующего раунда
  const seenRounds = useRef(0)
  useEffect(() => { if (searching) setMapTab('search') }, [searching])
  useEffect(() => {
    if (searching) return
    const grew = rounds.length > seenRounds.current
    seenRounds.current = rounds.length
    if (!rounds.length) { setMapTab('search'); return }
    if (!grew) return
    const bankMoves = rounds.filter((r) => !r.vsModel && !r.base && r.asked.length > 0).length
    if (bankMoves < 2 && !rounds.some((r) => r.vsModel)) return
    const id = setTimeout(() => setMapTab('tradeoff'), reduced() ? 0 : 1400)
    return () => clearTimeout(id)
  }, [rounds, searching])
  useEffect(() => {
    if (!searchFinished || !hole) return
    const id = setTimeout(() => {
      const m = hole.best.metrics
      setHeld({ w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt })
      setSearching(false); setView('hole')
    }, 900)
    return () => clearTimeout(id)
  }, [searchFinished, hole])

  // цена мер при своих правилах: считаем сразу после живого ответа поиска, пока зритель смотрит на карту (3 запроса /whatif по 0,5 с)
  useEffect(() => {
    const ch = hole?.source === 'live' ? (hole.rules_changed ?? []).filter((c) => c.to != null) : []
    if (!hole || !ch.length || prices?.of === hole) return
    let alive = true
    honestPrices(scKey, ctx, lang, Object.fromEntries(ch.map((c) => [c.param, c.to as number | boolean])))
      .then((v) => { if (alive) setPrices({ of: hole, v }) })
    return () => { alive = false }
  }, [hole]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown: Shown = (() => {
    if (searching && hole) {
      const att = hole.scenario.runs.base.metrics.attempted_kzt
      if (searchFinished) return { w: hole.best.metrics.withdrawn_kzt, s: hole.best.metrics.intercepted_kzt, att }
      // лучшая на сейчас попытка по той же мере, что итоговая: число не прыгает в конце поиска
      return { w: (runningPct(hole, searchN) / 100) * att, s: held.s, att }
    }
    if (phase === 'idle' || !final) return held.att ? held : { ...held, att: final?.attempted_kzt ?? 0 }
    if (phase === 'done') return { w: final.withdrawn_kzt, s: final.intercepted_kzt, att: final.attempted_kzt }
    return { w: live.withdrawn, s: live.stopped, att: final.attempted_kzt }
  })()

  // вау 1: банк включил модель на найденной атаке - точка модели встаёт на карту компромисса
  const markModel = () => {
    if (!hole || view !== 'hole' || hole.rules?.model_on) return
    const m = hole.scenario.runs.model?.metrics
    if (!m) return
    setModelMark({ ep: roundsEpoch.current, x: priceOf('model'), y: m.attempted_kzt ? (m.withdrawn_kzt / m.attempted_kzt) * 100 : 0 })
  }
  const toggleMeasure = (which: 'model' | 'hold', v: boolean) => {
    if (which === 'model') setModel(v); else setHold(v)
    if (which === 'model' && v) markModel()
    setAutoPlay(true)
  }

  // моушн-бриф 6.5: переход на отчёт через ViewTransition. Отчёт берём заранее (до 450 мс), чтобы плита вердикта была в дереве и срослась с плиткой
  const goReport = () => {
    // в скрытой вкладке браузер отменяет View Transition с ошибкой: там страница меняется без перехода
    const go = () => document.visibilityState === 'visible' ? startTransition(() => setPage('report')) : setPage('report')
    if (reportReady(ctx, lang)) { go(); return }
    let done = false
    const once = () => { if (!done) { done = true; go() } }
    prefetchReport(ctx, lang).then(once, once)
    setTimeout(once, 450)
  }
  useEffect(() => { if (step === 4) prefetchReport(ctx, lang).catch(() => {}) }, [step, ctx, lang])

  const goStep = (s: number) => {
    if (s === 5) { goReport(); return }
    if (searching) return
    if (s === 1) { setView('library'); setModel(false); setHold(false); setStep(ranLib ? 1 : 0); if (ranLib) setHeld(libHeld()) }
    // v20-fix D1: из «Атаки» обратно к дыре число на плитке берём у дыры, а не у атаки профиля, оставшееся в held
    if (s >= 2 && hole && view !== 'hole') setHeld(holeHeld(hole))
    if (s === 2) { if (hole) { setView('hole'); setModel(false); setHold(false); setStep(2) } else findHole() }
    if (s === 3 && hole) { setView('hole'); setStep(3) }
    if (s === 4 && hole) { setView('hole'); if (!model) { setModel(true); setAutoEnd(true) } setStep(4) }
  }
  const holeHeld = (h: Redteam): Shown => {
    const m = h.best.metrics
    return { w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt }
  }
  const libHeld = (): Shown => {
    const m = libSc!.runs.base.metrics
    return { w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt }
  }

  const aiMain = step === 3 && model && api !== 'static' && !(view === 'hole' && !!hole?.rules?.model_on)
  const dirty = api !== 'static' && !sameRules(draft, lastRules ?? profile)
  const edited = api !== 'static' && !sameRules(draft, profile)
  const main = (() => {
    if ((step === 0 || step === 1) && dirty) return { label: tr.rules.check, on: findHole, disabled: false }
    if (step === 0) return { label: tr.main.start, on: () => { setStep(1); play(true) }, disabled: !run }
    if (step === 1) return { label: tr.main.findGap, on: findHole, disabled: false }
    if (step === 2) return { label: searching ? tr.main.searching : tr.main.runFound, on: () => { setStep(3); play(true) }, disabled: searching || !hole }
    // v21 (wow-v21, п. 2): модель включена - главная кнопка ведёт на честную развязку, раунд «ИИ против модели»
    if (step === 3 && aiMain) return { label: tr.defense.aiModel, on: () => runSearch(true), disabled: !hole }
    if (step === 3) return { label: tr.main.customer, on: () => goStep(4), disabled: !hole }
    return { label: tr.main.report, on: goReport, disabled: false }
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
      setLastRules(draft)
      const wanted = rulesDiff(draft, profile)
      const l = lang
      runRedteam(scKey, ctx, l, wanted).then((r) => {
        const m = r.data.best.metrics
        got.current.hole = l; holeReq.current = wanted
        recordRound(r, wanted)
        setHole(r.data); setSource(r.source === 'live' ? 'api' : 'json'); setHeld({ w: m.withdrawn_kzt, s: m.intercepted_kzt, att: m.attempted_kzt })
        setView('hole'); setHold(false); setModel(s === 4); if (s === 4) setAutoEnd(true); setStep(s as Step)
      }).catch((e) => { setLastRules(null); if (e instanceof RuleError) { setRuleErr(e.detail); setStep(1) } else setHoleErr(String(e.message ?? e)) })
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
    report: () => { setTour(null); goReport() },
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
  const vsModelRef = useRef(false)
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
    else if (step === 3 && (e.key === '1' || e.key === '2') && !(e.key === '1' && vsModelRef.current)) toggleMeasure(e.key === '1' ? 'model' : 'hold', e.key === '1' ? !model : !hold)
    else if (step === 4 && e.key === 'Escape') { e.preventDefault(); goStep(3) } // фокус мог уйти с карточки после отмены перевода
    else if ((step === 3 || step === 4) && (e.code === 'KeyK' || e.key === '3') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goStep(step === 3 ? 4 : 3) }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const facts = useEntryFacts(scKey, ctx)
  vsModelRef.current = view === 'hole' && !!hole?.rules?.model_on
  if (error) return <Fatal msg={error} />
  if (!bank || !sc || !run || !final) return <Splash />
  const mark = modelMark && modelMark.ep === roundsEpoch.current ? modelMark : null
  if (page === 'report') return <Report ctx={ctx} bank={bank} rounds={rounds} profile={profile} modelMark={mark} scheme={scKey} langSwitch={<LangSwitch />} onBack={() => { if (document.visibilityState === 'visible') startTransition(() => setPage('twin')); else setPage('twin'); history.replaceState(null, '', ' ') }} />

  // цена для честных: при своих правилах базу считает сервер вместе с поиском (honest), меры - /whatif (F5); иначе профиль банка
  const liveHole = (view === 'hole' || step === 2) && hole?.source === 'live' && hole.honest && hole.rules_changed?.length ? hole : null
  const livePrices = liveHole && prices?.of === liveHole ? prices.v : null
  const priceFailed = !!liveHole && prices?.of === liveHole && prices.v == null
  const priceOf = (k: RunKey): number => (liveHole && k === 'base' ? liveHole.honest!.delayed_per_10k : livePrices?.[k] ?? bank.honest_cost[k].delayed_per_10k)
  const per10k = priceOf(rk)
  // раунд «ИИ против модели»: модель уже в правилах поиска, её тумблер включён и закреплён
  const vsModel = view === 'hole' && !!hole?.rules?.model_on
  const priceDelta = (which: 'model' | 'hold') => which === 'model'
    ? priceOf(runKey(true, hold)) - priceOf(runKey(false, hold))
    : priceOf(runKey(model, true)) - priceOf(runKey(model, false))
  const cc = client?.data
  const robust = client?.robust ?? cc?.robust ?? null
  const warnPer10k = robust?.honest.high_per_10k ?? cc?.stats.honest.high_per_10k ?? null
  const clientKey = cc ? (clientPick && cc.cases[clientPick] ? clientPick : cc.demo) : null
  const cCase = clientKey ? cc?.cases[clientKey] : undefined
  const cLow = !!cCase && cCase.risk.level === 'low'
  const cT = tr.client.tile[cLow ? (clientKey === 'fresh_card' ? 'fresh_card' : 'honest') : 'high']
  const cTile = { cap: cT.cap, sub: cT.sub, num: cLow ? `${Math.round(cCase!.risk.score * 100)}%` : warnPer10k != null ? String(Math.round(warnPer10k)) : '-' }
  const unseenPct = bank.model?.summary?.withdrawn_pct_mean?.boosting ?? null
  const pctText = (v: number) => (Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : lang === 'en' ? v.toFixed(1) : v.toFixed(1).replace('.', ','))
  // запасной прогон вместо своих порогов: одна строка, какое значение показано
  const curRound = rounds.at(-1)
  const wanted = curRound?.wanted ?? {}
  const fallbackNote = hole && !searching && curRound?.source === 'ready' && curRound.fallback && Object.keys(wanted).length
    ? tr.rules.fallback(curRound.fallback, Object.entries(wanted).map(([k, v]) => insteadText(bank.rule_meta, k, profile[k], v, tr, lang)).filter(Boolean).join(', '))
    : null
  // v21: строку «мошенник дробит платёж» убрали - рост доли при строгом лимите был недобором поиска (wow-v21, п. 1).
  // Теперь сервер может пометить долю как нижнюю оценку: тогда «не меньше» над числом
  const atLeast = !!hole && !searching && isLowerBound(hole) && hole.best.pct < 99.95 // «не меньше 100%» не пишем
  const editor = (hits: Record<string, number> | null, note?: string) => (
    <RulesEditor meta={bank.rule_meta} profile={profile} draft={draft} onChange={setDraft} hits={hits} note={note}
      api={api} err={ruleErr} setErr={setRuleErr} profileName={bank.name}
      onReset={edited ? () => { setDraft(profile); setRuleErr(null) } : undefined} />
  )
  const thr = bank.model?.threshold ?? 0.3
  const fresh = step === 0
  // автопоказ рассказывает про демо-схему, поэтому из панели он доступен только на ней
  const tourReady = scKey === 'student_crypto' && ctx.preset === 'demo'
  const guided = intro || tour != null
  const mapState: MapState = { data: hole, n: searching ? searchN : hole?.history.length ?? 0, searching: searching && !searchFinished, error: holeErr }
  // плитка «Дыры»: доля ушедшего у лучшей попытки, во время поиска растёт вместе с картой
  const gapPct = hole ? (searching && !searchFinished ? runningPct(hole, searchN) : hole.best.pct) : lastPct.current
  lastPct.current = gapPct
  const holeRuns = hole?.scenario.runs

  // v22 (п. 1 CHANGES): заголовок шага в два тона вместо служебных подписей
  const limitParam = bank.rule_meta.find((m) => m.key === 'amount_limit')?.param
  // headId не зависит от языка: при смене языка заголовок меняет текст без выезда из-под маски
  const [head, headId]: [readonly string[], string] = (() => {
    const V = tr.v22
    if (step === 0) return [V.fresh, 'fresh']
    if (step === 1) return phase === 'done' ? [V.attackDone(final.chains_caught, final.chains_total, final.withdrawn_kzt > 0), `done${final.chains_caught}`] : [V.attackRun, 'run']
    if (step === 2) {
      if (searching) return hole?.rules?.model_on ? [V.gapSearchModel, 'sm'] : [V.gapSearch, 's']
      if (vsModel) return [V.gapModel, 'model']
      const asked = curRound?.asked ?? []
      if (asked.some((c) => c.param === limitParam)) return [V.gapLimit, 'limit']
      return asked.length ? [V.gapOwn, 'own'] : [V.gapProfile, 'profile']
    }
    if (step === 3) {
      if (vsModel) return [V.gapModel, 'model']
      if (!model && !hold) return [V.defenseOff, 'off']
      const d = priceOf(rk) - priceOf('base')
      return [V.defenseOn(model ? tr.defense.model : tr.defense.hold, final.withdrawn_kzt === 0, `${d >= 0 ? '+' : '-'}${pctText(Math.abs(d))}`), `on${model ? 'm' : ''}${hold ? 'h' : ''}${final.withdrawn_kzt === 0}`]
    }
    return [V.client, 'client']
  })()

  // v23: второе число «Дыры» и «Защиты» (макеты 02, 03): цена для честных с базой профиля, на «Защите» с моделью - доля на невиданных схемах
  const basePer10k = curRound && !curRound.base ? rounds.find((r) => r.base)?.honest ?? bank.honest_cost.base.delayed_per_10k : bank.honest_cost.base.delayed_per_10k
  const askedNow = curRound?.asked ?? []
  const second: { num: React.ReactNode; sub: readonly string[] } = step === 3 && (model || vsModel) && unseenPct != null
    ? { num: `${pctText(unseenPct)}%`, sub: tr.v22.unseen2 }
    : step === 2 && !vsModel && askedNow.length && per10k > basePer10k + 0.05
      ? { num: <Dec v={per10k} />, sub: askedNow.some((c) => c.param === limitParam) ? tr.v22.honestLimit(pctText(basePer10k)) : tr.v22.honestOwn(pctText(basePer10k)) }
      : { num: <Dec v={per10k} />, sub: tr.v22.honestOut }
  // тёмная плита «ИИ против модели»: живое число текущего раунда или последнего такого раунда; до поиска - приглашение
  const lastAi = [...rounds].reverse().find((r) => r.vsModel)
  const aiResult = vsModel && hole && !searching
    ? { pct: hole.best.pct, withdrawn: kzt(hole.best.metrics.withdrawn_kzt, lang), atLeast }
    : lastAi ? { pct: lastAi.pct, withdrawn: kzt(lastAi.withdrawn, lang), atLeast: true } : null

  const pickEntry = (s: number) => {
    if (s === 1) { leaveIntro(); setStep(1); play(true) }
    else if (s === 5) { setIntro(false); goReport() }
    else jump(s)
  }
  const n = Math.max(1, step)
  const stepName = [tr.steps.attack, tr.steps.gap, tr.steps.defense, tr.steps.customer, tr.steps.report][n - 1]
  // v23: итоги шагов в шапке живыми числами
  const modelRun = hole?.scenario.runs.model?.metrics
  const navVals: (string | null)[] = [
    ranLib && libSc ? kztShort(libSc.runs.base.metrics.withdrawn_kzt, lang) : null,
    hole && !searching ? `${atLeast ? `${tr.gap.atLeast} ` : ''}${pctText(hole.best.pct)}%` : null,
    modelRun ? kztShort(modelRun.withdrawn_kzt, lang) : null,
    warnPer10k != null ? tr.client.approx(Math.round(warnPer10k)) : null,
    null,
  ]
  // v23: «Дыра» и «Защита» по макетам 02-hole и 03-defense: сцены нет, справа большие плиты, плитка числа заходит на них
  const wide = !intro && (step === 2 || step === 3)
  // число плитки на шагах 1-4: одно значение, суффикс и единица по шагу («млн ₸», «%», «₸», пусто)
  const num: { v: number | null; frac: number; pre?: string; suffix?: string; unit?: string; cls: string; text: string } = (() => {
    const en = lang === 'en'
    if (step === 2) { const r = Math.round(gapPct * 10) / 10; const whole = r === 100 || r === 0; return { v: r, frac: whole ? 0 : 1, suffix: '%', cls: 'tile-num-gap', text: `${pctText(r)}%` } }
    if (step === 4) {
      const v = cLow ? Math.round(cCase!.risk.score * 100) : warnPer10k != null ? Math.round(warnPer10k) : null
      return { v, frac: 0, suffix: cLow ? '%' : undefined, cls: 'tile-num-c', text: cTile.num }
    }
    const m = Math.round(shown.w / 1e5) / 10, zero = m === 0
    const text = zero ? (en ? '₸0' : '0 ₸') : en ? `₸${m.toFixed(1)}M` : `${m.toFixed(1).replace('.', ',')} млн ₸`
    return { v: m, frac: zero ? 0 : 1, pre: en ? '₸' : undefined, suffix: en && !zero ? 'M' : undefined, unit: en ? undefined : zero ? '₸' : 'млн ₸',
      cls: step === 3 ? `tile-num-def ${zero ? 'num-zero' : ''}` : '', text }
  })()
  const tileCap: React.ReactNode = step === 2 ? (atLeast ? tr.gap.atLeast : tr.v22.capBest) : step === 4 ? cTile.cap : null
  const tileSub: React.ReactNode = step === 4 ? <>{cTile.sub[0]}<br />{cTile.sub[1]}</>
    : step === 3 ? (shown.att > 0 ? (() => { const L = vsModel ? tr.v22.withdrawnModel(kzt(shown.att, lang)) : tr.v22.withdrawnFound(kzt(shown.att, lang)); return <>{L[0]}<br />{L[1]}</> })() : null)
      : step === 2 ? (vsModel ? tr.gap.leakModel(kzt(shown.w, lang)) : tr.gap.leak(kzt(shown.w, lang)))
        : shown.att > 0 ? tr.v22.withdrawnOf(kzt(shown.att, lang)) : ''
  // спутники плитки проявляются после переезда (520 мс, шаг 60 мс); при входе в двойник - на 520 / 580 / 640 мс
  const satDelay = (i: number) => ({ '--d': `${Math.round((flow.sat + i * flow.satStep) * 1000)}ms` }) as React.CSSProperties
  // «посадка числа»: конец атаки, конец поиска, «0 ₸» после включения меры
  const land = step === 1 && phase === 'done' && run ? { key: `atk-${final.withdrawn_kzt}` }
    : step === 2 && hole && !searching ? { key: `gap-${hole.best.pct}-${rounds.length}` }
      : step === 3 && phase === 'done' && Math.round(shown.w / 1e5) === 0 ? { key: 'zero', calm: true } : null
  // главная кнопка шага: на телефоне закреплена снизу, на «Атаке» стоит рядом со вторым числом
  const mainBar = (
    <div className={`fixed inset-x-0 bottom-0 z-30 flex flex-col gap-3 bg-linear-to-t from-bg from-60% to-bg/0 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-4 lg:static lg:z-10 lg:bg-none lg:px-0 lg:pb-0 ${(step <= 1 || wide) && !intro ? 'lg:pt-0' : 'lg:pt-5'} ${wide && step === 3 ? 'lg:flex-row lg:gap-5' : ''}`}>
      {step === 3 && aiMain && (
        <button type="button" className="ctl ctl-glass ctl-light w-full !justify-between !px-[26px] max-lg:hidden lg:!w-[200px] lg:shrink-0" onClick={() => goStep(4)} data-to-client>
          {tr.defense.toClient}
        </button>
      )}
      <button ref={mainBtn} className={`ctl ctl-main main-in min-w-0 w-full !justify-between whitespace-nowrap !pl-[26px] !pr-[24px] ${wide && step === 3 ? (aiMain ? 'lg:!w-[350px]' : 'lg:!w-[260px]') : ''}`} onClick={main.on} disabled={main.disabled} aria-keyshortcuts="ArrowRight">
        <span key={main.label} className="lbl-in">{main.label}</span>
        <ArrowRight size={20} strokeWidth={1.75} className="next" aria-hidden />
      </button>
    </div>
  )
  // v23: экран «Атака» собран по макету 01-attack: сцена большой плитой справа, плита правил поверх её низа
  const atk = !intro && step <= 1

  return (
    <ViewTransition enter="page-in" exit="page-out">
    <div className={`app-h tone-${intro ? 'report' : STEP_TONE[step]} flex flex-col overflow-x-clip bg-bg text-ink lg:h-screen lg:overflow-hidden ${intro ? '' : 'max-lg:pb-(--bar-h)'}`}>
      <Backdrop tone={intro ? null : STEP_TONE[step]} />
      <button className="ctl ctl-main sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50" onClick={() => document.getElementById('main')?.focus()}>{tr.skip}</button>
      {!intro && <h1 className="sr-only">Fraud Twin: {stepName}</h1>}
      {/* v23 (макет Penpot): шапка 96, знак-квадрат, шаги текстом с итогом шага под названием, справа «Как устроено» и круг языка */}
      <header className="hdr-in z-30 flex flex-wrap items-center gap-x-3 px-5 pt-[18px] lg:h-24 lg:shrink-0 lg:flex-nowrap lg:items-start lg:px-8 lg:pt-0 xl:px-14">
        <div className="flex min-w-0 items-center gap-2.5 lg:mt-8 lg:w-[232px] lg:shrink-0 max-[1279px]:lg:w-[200px]">
          <button className="-m-1 shrink-0 rounded-[11px] p-1" onClick={goHome} aria-label={tr.home} title={tr.home}><BrandMark /></button>
          <p className="logo-name max-lg:text-[17px]">Fraud Twin</p>
        </div>
        <div className="scroll-x max-lg:order-last max-lg:-mx-5 max-lg:mt-4 max-lg:w-[calc(100%+40px)] max-lg:overflow-x-auto max-lg:px-5 lg:mt-[22px] lg:min-w-0 lg:flex-1">
          <StepNav step={step} vals={navVals} hasHole={!!hole && !searching} busy={searching} locked={guided} onPick={goStep} />
        </div>
        <div className="ml-auto flex items-center gap-4 lg:mt-[30px] lg:gap-5">
          <button className="how-link max-lg:hidden" onClick={openHow} inert={tour != null} aria-label={tr.header.howAria}>{tr.header.how}</button>
          <span className="max-lg:hidden"><LangSwitch /></span>
          <span inert={tour != null}><BankMenu bank={bank} preset={ctx.preset} disabled={searching || guided} onPick={pickBank} onHow={openHow} /></span>
        </div>
      </header>
      <Calibration open={calibOpen} bank={bank} live={source === 'api'} onApply={applyCalib} onClose={() => setCalibOpen(false)} />
      <How open={howOpen} bank={bank} facts={facts} onClose={() => { setHowOpen(false); if (location.hash === '#how') history.replaceState(null, '', ' ') }} onStep={jump} />
      <FeedDialog open={feed.open} tab={feed.tab} setTab={(tab) => setFeed({ open: true, tab })} onClose={() => setFeed((f) => ({ ...f, open: false }))}
        sc={sc} log={log} honest={bank.honest_feed?.[rk]} thr={thr} measure={tr.feed.measures[rk]} />

      {/* v22 (макет Penpot): слева смысл шага (заголовок, плитка, панель, кнопка), справа сцена главной плитой.
          Вход остаётся на 12 колонках. Сцена всегда в одном месте дерева, 3D не пересоздаётся */}
      <main id="main" tabIndex={-1} className={`grid flex-1 outline-none grid-cols-1 gap-3 p-3 ${intro
        ? 'lg:min-h-0 lg:grid-cols-12 lg:gap-3 lg:pt-0 lg:grid-rows-[minmax(0,1fr)_auto]'
        : atk
          ? 'max-lg:gap-0 max-lg:px-5 max-lg:pt-5 lg:min-h-0 lg:grid-cols-[minmax(0,554fr)_minmax(0,830fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-0 lg:pb-9 lg:pl-8 lg:pr-0 lg:pt-5 xl:pl-14 short:pb-5'
          : wide
            ? 'max-lg:gap-0 max-lg:px-5 max-lg:pt-5 lg:min-h-0 lg:grid-cols-[minmax(0,584fr)_minmax(0,800fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-0 lg:pb-[50px] lg:pl-8 lg:pr-0 lg:pt-5 xl:pl-14 short:pb-5'
            : clientOpen
              ? 'max-lg:gap-0 max-lg:px-5 max-lg:pt-5 lg:min-h-0 lg:grid-cols-[minmax(380px,460fr)_minmax(0,868fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-0 lg:pb-9 lg:pl-8 lg:pr-8 lg:pt-5 xl:pl-14 xl:pr-14 short:pb-5'
              : 'max-lg:px-5 lg:min-h-0 lg:grid-cols-[minmax(400px,520fr)_minmax(0,852fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-x-10 lg:gap-y-0 lg:px-8 lg:pb-10 lg:pt-4 xl:px-14 xl:pb-[44px] short:pb-5'}`}>
        {intro ? <EntryPlate clients={bank.summary.clients} onStart={() => { leaveIntro(); setStep(1); play(true) }} onTour={startTour} /> : null}
        <div className={`flex min-h-0 flex-col gap-3 lg:gap-5 short:gap-3 ${intro ? 'lg:col-span-5' : `max-lg:contents lg:col-start-2 lg:row-start-1 ${clientOpen ? 'lg:flex-row lg:items-stretch lg:justify-between lg:gap-6 lg:pl-[clamp(16px,5vw,74px)]' : ''}`}`}>
          {clientOpen && <ClientScreen data={client?.data ?? (client === undefined ? undefined : null)} pick={clientPick} onPick={setClientPick}
            auto={tourId === 'client'} onState={onPhone} onClose={() => { stopTour(); goStep(3) }} />}
          {clientOpen && <ClientSide check={client} fresh={clientKey === 'fresh_card'}
            footer={tour != null ? <div className="tour-in-plate relative mt-4"><TourCaption i={tour} onStop={stopTour} /></div> : null} />}
          <Scene sc={sc} log={log} freezes={run.freezes} t={t} done={phase === 'done'} span={span} playing={phase === 'playing'}
            presets={bank.presets} scKey={scKey} onScheme={setScKey} busy={searching} isHole={view === 'hole'}
            covered={searching} split={(step === 2 || step === 3) && !intro} narrow={clientOpen}
            onPlay={togglePlay} onSkip={skip} phase={phase}
            mark={clientOpen && phone.level && phone.level !== 'low' && !phone.after ? clientChain : null}
            gone={phone.after === 'cancel' ? clientChain : null} aside={intro} intro={intro} hideMobile={clientOpen} off={clientOpen || wide}
            words={step <= 1 ? <SceneWordsPill /> : null} atk={atk}
            overlay={tour != null ? <TourCaption i={tour} onStop={stopTour} /> : null} />
          {step === 2 && !intro && <>
            {mapTab === 'tradeoff' && !searching
              ? <TradeoffMap rounds={rounds} model={mark} meta={bank.rule_meta} unseen={unseenPct} scheme={scKey} ctx={ctx} enter={mapEnter} head={<MapTabs tab={mapTab} onTab={pickMapTab} />} />
              : <SearchMap s={mapState} meta={bank.rule_meta} onRetry={findHole} enter={mapEnter} head={<MapTabs tab={searching ? 'search' : mapTab} onTab={(v) => { if (!searching) pickMapTab(v) }} />} />}
            {/* под картой без плиты: что поменял мошенник слева, главная кнопка справа (макет 02-hole) */}
            <div className="relative z-10 flex shrink-0 items-end gap-5 max-lg:order-6 max-lg:mt-6 max-lg:px-1 lg:mt-[clamp(0px,0.9vh,8px)] lg:pl-10 lg:pr-[26px]" inert={tour != null}>
              <div className="min-w-0 flex-1">
                {fallbackNote && <p role="status" className="mb-2 text-[14px] font-medium leading-snug text-warn" data-fallback>{fallbackNote}</p>}
                <Changes data={hole} searching={searching} />
              </div>
              <div className="lg:w-[330px] lg:shrink-0">{mainBar}</div>
            </div>
          </>}
          {step === 3 && !intro && holeRuns && <>
            <section className="plate plate-xl in-r shrink-0 px-5 pb-2 pt-5 max-lg:order-5 max-lg:mt-6 lg:pb-[34px] lg:pl-9 lg:pr-[80px] lg:pt-[34px] short:pb-2 short:pt-5" aria-label={tr.v22.measures} data-measures inert={tour != null}>
              <MeasuresHead big />
              <div className="divide-y divide-ink/[0.07]">
                <MeasureRow big on={model || vsModel} locked={vsModel} delay={420} set={(v) => toggleMeasure('model', v)} hotkey="1" name={tr.defense.model}
                  hint={vsModel ? tr.defense.modelLocked : tr.defense.modelHint} price={vsModel ? null : priceDelta('model')} />
                <MeasureRow big delay={490} on={hold} set={(v) => toggleMeasure('hold', v)} hotkey="2" name={tr.defense.hold} hint={tr.defense.holdNote} price={priceDelta('hold')} />
              </div>
              {priceFailed && <p className="pb-2 text-[14px] leading-snug text-ink-2" data-price-note>{tr.defense.priceProfile}</p>}
            </section>
            <div className="def-row relative flex min-h-0 flex-1 flex-col gap-5 max-lg:order-6 max-lg:mt-5 lg:mt-[clamp(0px,1.1vh,10px)] lg:block">
              <HonestPlate per10k={per10k} onFeed={() => setFeed({ open: true, tab: 'honest' })}
                className="fade-d [--d:400ms] [--dur:300ms] px-5 pb-4 pt-5 lg:h-[calc(100%-clamp(16px,8.2vh,74px))] lg:w-[58.75%] lg:px-8 lg:pb-5 lg:pt-[34px] short:pt-5" />
              {api !== 'static' && <AiPlate result={aiResult} busy={searching} onRun={() => { markModel(); runSearch(true) }}
                className="min-h-[260px] px-7 pb-7 pt-7 lg:absolute lg:bottom-0 lg:right-[-90px] lg:top-6 lg:z-10 lg:min-h-0 lg:w-[470px] lg:px-9 lg:pb-[30px] lg:pt-[34px] short:pt-6" />}
            </div>
          </>}
          {atk && (
            <motion.section initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...spring.ui, delay: entered ? flow.right : 0.42 }}
              className="plate-float relative z-20 shrink-0 px-5 py-2.5 max-lg:order-4 max-lg:mt-4 lg:-mt-[58px] lg:ml-[80px] lg:mr-[50px] lg:px-8 lg:pb-6 lg:pt-[24px] short:pb-4 short:pt-4" aria-label={tr.rules.title} inert={tour != null}>
              {editor(phase === 'done' && step === 1 ? final.rule_hits : step === 1 ? liveHits(log, run.freezes, t) : null)}
            </motion.section>
          )}
        </div>

        {!intro ? (
          <aside className={`flex min-h-0 flex-col max-lg:contents lg:col-start-1 lg:row-start-1 ${atk || wide || step === 4 ? 'relative z-20' : 'aside-c'}`} aria-label={stepName} inert={tour != null}>
            <h2 className={`step-head relative max-lg:order-1 ${atk ? 'lg:pt-4' : wide ? 'lg:pt-5' : step === 4 ? 'step-head-c lg:pt-3' : 'pt-2 lg:pt-5 short:pt-2'}`} data-step-head aria-live="polite">
              {/* моушн-бриф: старый заголовок гаснет 140 мс, новый выезжает из-под маски по строкам (вход 60 мс, смена шага 280 мс), серая строка только проявляется */}
              <StepHead id={`${flowKey}-${headId}`} text={head[0]} mute={head[1] ?? ''} entered={entered} />
            </h2>
            {step === 4 && <ClientTabs data={client?.data} pick={clientPick} onPick={setClientPick} className="relative z-10 max-lg:order-2 max-lg:mt-5 lg:mt-[clamp(14px,2.7vh,24px)]" />}
            <ViewTransition name="hero-tile">
            <StepTile tone={STEP_TONE[step]} flowKey={flowKey} land={land} className={`shrink-0 max-lg:mt-[18px] max-lg:min-h-[200px] ${atk
              ? 'relative z-10 max-lg:order-2 lg:mt-[clamp(28px,7.8vh,70px)] lg:h-[clamp(220px,32.2vh,290px)] lg:w-[calc(100%+46px)]'
              : wide
                ? `relative z-10 max-lg:order-2 lg:mt-[clamp(28px,7.6vh,68px)] ${step === 2
                  ? 'lg:h-[clamp(220px,32.2vh,290px)] lg:w-[calc(100%+36px)]'
                  : 'lg:h-[clamp(226px,33.3vh,300px)] lg:w-[calc(100%+16px)]'}`
                : step === 4
                  ? 'relative z-10 max-lg:order-3 lg:mt-[clamp(16px,3.1vh,28px)] lg:h-[clamp(200px,27.8vh,250px)] lg:w-full'
                : 'max-lg:order-3 lg:mt-6 lg:min-h-[180px] short:mt-4 short:min-h-[150px]'}`}
              innerClassName={`flex flex-col max-lg:px-[26px] max-lg:pb-5 max-lg:pt-4 ${atk
                ? 'lg:px-10 lg:pb-[36px] lg:pt-[40px]'
                : wide
                  ? `tile-white lg:px-11 ${step === 2 ? 'lg:pb-[32px] lg:pt-[32px]' : 'lg:pb-[30px] lg:pt-[30px]'}`
                  : step === 4
                    ? 'lg:px-10 lg:pb-[26px] lg:pt-[28px]'
                    : 'lg:px-8 lg:pb-6 lg:pt-5 short:pb-4 short:pt-3'}`}>
              {fresh ? (
                <div className="lg:pt-4">
                  <p className="tile-cap">{tr.nums.calm}</p>
                  <p className="mt-3 text-[26px] font-medium leading-tight tracking-[-0.025em] lg:text-[30px]">{tr.nums.calmText(intl(bank.summary.clients, lang))}</p>
                  {tourReady && (
                    <button className="ctl mt-5 !h-11 bg-white !px-5 text-ink hover:bg-white/90 short:mt-3" onClick={startTour}>
                      <Play size={14} strokeWidth={2.25} aria-hidden />{tr.nums.tour}
                    </button>
                  )}
                </div>
              ) : (
                // моушн-бриф, раздел 4: одно число на шагах 1-4. Узел NumberFlow не пересоздаётся, поэтому число пересчитывается на месте;
                // блок едет вместе с плиткой, но не растягивается (layout="position"). Спутники (надпись, пояснение, второе число) проявляются после переезда
                <motion.div layout="position" layoutDependency={flowKey} transition={spring.tile} id="number" className="flex flex-1 flex-col" aria-live="polite"
                  data-client-tile={step === 4 ? clientKey ?? '' : undefined}>
                  <Sat k={flowKey} i={0} className="tile-cap" data-at-least={step === 2 && atLeast ? '' : undefined}>{tileCap || null}</Sat>
                  <motion.div ref={numEl} style={{ scale: numScale, originX: 0, originY: 0.5 }} className={`tile-num ${num.cls} ${step === 4 ? 'mt-1' : ''}`}
                    data-gap-pct={step === 2 ? '' : undefined} data-value={num.text}>
                    {num.pre && <span className="u u-pre !ml-0 mr-[0.06em]">{num.pre}</span>}
                    <span className={num.v == null ? 'invisible' : undefined}>
                      <NumberFlow value={num.v ?? 0} locales={lang === 'en' ? 'en-US' : 'ru-RU'} {...numberTiming} suffix={num.suffix}
                        format={{ minimumFractionDigits: num.frac, maximumFractionDigits: num.frac }} />
                    </span>
                    {num.v == null && <span className="absolute">-</span>}
                    {num.unit && <span key={num.unit} className="u unit-in">{num.unit}</span>}
                  </motion.div>
                  <Sat k={flowKey} i={1} className={`tile-sub mt-auto pt-2 ${step === 3 ? 'tile-sub-def' : step === 4 ? 'tile-sub-c' : 'truncate max-lg:mt-1'}`}>{tileSub || null}</Sat>
                  {/* телефон: второе число внутри плитки одной строкой, как в 06-attack-375 */}
                  <Sat k={flowKey} i={2} className="mt-2 flex items-baseline gap-3 lg:hidden">{step !== 4 && <><span className="text-[28px] font-medium leading-none tracking-[-0.04em]">{wide ? second.num : <Dec v={per10k} />}</span><span className="text-[13px] opacity-90">{wide ? second.sub.join(' ') : tr.v22.honestOne}</span></>}</Sat>
                </motion.div>
              )}
            </StepTile>
            </ViewTransition>
            {/* второе число под плиткой: 56 px чёрным, подпись в две строки; на «Атаке» рядом главная кнопка */}
            {step === 4 && robust && (
              <div className="sat-in flex items-center gap-x-7 max-lg:order-5 max-lg:mt-6 max-lg:px-1 lg:mt-[clamp(16px,2.9vh,26px)]" style={satDelay(2)} data-second>
                <span className="fig2">{pctText(robust.victims.repeat_on_card_covered_pct)}%</span>
                <span className="fig2-sub">{tr.client.covered2[0]}<br />{tr.client.covered2[1]}</span>
              </div>
            )}
            {(atk || (step !== 4 && !fresh)) && (
              <div className={`flex items-center gap-x-8 max-lg:contents ${atk ? 'lg:mt-[clamp(20px,3.8vh,34px)]' : wide ? (step === 3 ? 'lg:mt-[clamp(18px,5.5vh,50px)]' : 'lg:mt-[clamp(22px,6.6vh,60px)]') : 'lg:mt-5 short:mt-3'}`}>
                {!fresh && step !== 4 && (
                  <Sat k={flowKey} i={2} className={`flex items-center max-lg:hidden ${wide ? 'gap-x-7' : 'gap-x-[34px]'}`} data-second="">
                    <span className="fig2">{wide ? second.num : <Dec v={per10k} />}</span>
                    <span className="fig2-sub">{(wide ? second.sub : tr.v22.honestOut)[0]}<br />{(wide ? second.sub : tr.v22.honestOut)[1]}</span>
                  </Sat>
                )}
                {atk && <div className="ml-auto lg:-mr-[10px] lg:w-[230px] lg:shrink-0">{mainBar}</div>}
              </div>
            )}
            {atk ? (
              <p className="foot-note sat-in mt-auto pt-4 max-lg:order-5 max-lg:mt-4 max-lg:px-1" style={satDelay(3)} data-twin-foot>{tr.v22.twinFoot(intl(bank.summary.clients, lang))}</p>
            ) : step === 3 ? (
              <div className="lg:mt-[clamp(18px,6vh,54px)]">{mainBar}</div>
            ) : step === 4 ? (
              <div className="lg:mt-[clamp(12px,2vh,18px)] lg:w-[270px]">{mainBar}</div>
            ) : null}
            {step === 3 && aiMain && (
              <button type="button" className="ctl ctl-glass w-full !justify-between !px-[22px] max-lg:order-7 max-lg:mt-4 lg:hidden" onClick={() => goStep(4)} data-to-client-m>
                {tr.defense.toClient}<ArrowRight size={20} strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </aside>
        ) : null}

        {intro ? <EntryTiles facts={facts} withdrawn={libSc?.runs.base.metrics.withdrawn_kzt ?? 0} schemes={bank.presets.length} onPick={pickEntry} /> : null}
      </main>
      <p className="sr-only" aria-live="polite">{phase === 'done' ? tr.liveDone(kzt(final.withdrawn_kzt, lang)) : ''}</p>
    </div>
    </ViewTransition>
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

// Профиль банка в шапке: тот же движок под другой банк одним выбором. Названия профилей приходят из симулятора
function bankItems(bank: Bank, t: ReturnType<typeof useLang>['t']) {
  return [...bank.calib_presets.map((p) => ({ value: p.id, label: p.name, note: p.note })), { value: 'custom', label: t.header.custom, note: t.header.customNote }]
}

// v23: профиль банка и «Как устроено» (на телефоне ещё язык) в одном меню у круга справа
function BankMenu({ bank, preset, disabled, onPick, onHow }: { bank: Bank; preset: string | null; disabled: boolean; onPick: (id: string) => void; onHow: () => void }) {
  const { t, lang, setLang } = useLang()
  const [open, setOpen] = useState(false)
  const cur = preset ?? 'custom'
  const other: Lang = lang === 'ru' ? 'en' : 'ru'
  const row = 'flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-medium hover:bg-surface-2'
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="circle-btn !w-[42px] !px-0 max-lg:!h-9 max-lg:!w-10 max-lg:bg-white/80 max-lg:shadow-none" aria-label={`${t.header.menu}: ${t.v22.bankMenu}`} title={t.v22.bankMenu}>
        <Landmark size={16} strokeWidth={1.75} className="max-lg:hidden" aria-hidden /><Menu size={18} strokeWidth={1.75} className="lg:hidden" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-40">
          <Popover.Popup className="w-[min(340px,calc(100vw-16px))] rounded-[22px] bg-surface p-1.5 text-ink shadow-[0_1px_2px_rgba(14,14,17,0.06),0_18px_40px_-16px_rgba(14,14,17,0.3)] outline-none
            origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
            <div className="lg:hidden">
              <button className={row} onClick={() => { setOpen(false); onHow() }}>
                <Info size={17} strokeWidth={1.75} className="text-ink-3" aria-hidden />{t.header.how}
              </button>
              <button className={row} lang={other} onClick={() => setLang(other)} aria-label={t.v22.langTo(LANGS[other].langName)}>
                <span className="grid w-[17px] place-items-center text-[12px] font-semibold text-ink-3">{other.toUpperCase()}</span>{LANGS[other].langName}
              </button>
            </div>
            <p className="t-caps px-3 pb-1 pt-3 text-ink-3 lg:pt-2">{t.header.bankAria}</p>
            {bankItems(bank, t).map((p) => (
              <button key={p.value} disabled={disabled} aria-pressed={cur === p.value} onClick={() => { setOpen(false); onPick(p.value) }}
                className="flex min-h-12 w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-45">
                <span className="mt-0.5 w-4 shrink-0">{cur === p.value && <Check size={16} strokeWidth={2} aria-hidden />}</span>
                <span className="min-w-0"><span className="block text-[15px] font-medium">{p.label}</span><span className="t-caption block text-ink-3">{p.note}</span></span>
              </button>
            ))}
            <p className="px-3 pb-2 pt-2 text-[13px] leading-snug text-ink-3">{t.header.bankFoot}</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// v23: круг языка 42x36: показывает текущий язык, нажатие переключает на другой; меняет <html lang> и заголовок вкладки
function LangSwitch() {
  const { lang, setLang, t } = useLang()
  const other: Lang = lang === 'ru' ? 'en' : 'ru'
  return (
    <button type="button" className="circle-btn" lang={lang} onClick={() => setLang(other)} aria-label={t.v22.langTo(LANGS[other].langName)} title={LANGS[other].langName} data-lang-switch>
      {lang.toUpperCase()}
    </button>
  )
}

const NAV_TONE = ['attack', 'gap', 'defense', 'customer', 'report'] as const
// v23 шаги текстом: номер мелко, название, под ним итог шага; у активного полоска в цвете шага (скользит 220 мс), закрытые бледнее
function StepNav({ step, vals, hasHole, busy, locked, onPick }: { step: Step; vals: (string | null)[]; hasHole: boolean; busy: boolean; locked: boolean; onPick: (s: number) => void }) {
  const { t } = useLang()
  const items = [t.steps.attack, t.steps.gap, t.steps.defense, t.steps.customer, t.steps.report]
  const cur = Math.max(1, step)
  // линия шага едет через layoutId и при этом меняет цвет: слой прежнего тона гаснет, слой нового проявляется (320 мс)
  const prevCur = useRef(cur)
  const fromTone = prevCur.current
  useEffect(() => { prevCur.current = cur }, [cur])
  // моушн-бриф 8: на телефоне активный шаг сам доезжает до начала ленты (прокручивается только лента, страница стоит)
  const navEl = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navEl.current, sc = nav?.parentElement
    if (!nav || !sc || !window.matchMedia('(max-width: 1023px)').matches) return
    const btn = nav.querySelector<HTMLElement>('[aria-current="step"]')
    if (!btn) return
    const pad = parseFloat(getComputedStyle(sc).paddingLeft) || 0
    const left = sc.scrollLeft + btn.getBoundingClientRect().left - sc.getBoundingClientRect().left - pad
    sc.scrollTo({ left: Math.max(0, left), behavior: prefersReduced() ? 'auto' : 'smooth' })
  }, [cur])
  return (
    <nav ref={navEl} aria-label={t.stepsAria} inert={locked}>
      <ol className="stepnav">
        {items.map((name, i) => {
          const s = i + 1
          const lockedStep = (s === 3 || s === 4) && !hasHole
          const v = s <= cur ? vals[i] : null
          return (
            <li key={s} className="contents">
              <button type="button" className={`stepnav-item tone-${NAV_TONE[i]}`} disabled={busy || lockedStep} aria-current={cur === s ? 'step' : undefined}
                title={lockedStep ? t.stepLockedHint : undefined} aria-label={lockedStep ? t.stepLocked(name) : `${t.stepAria(s, 5, name)}${v ? `, ${v}` : ''}`}
                onClick={() => cur !== s && onPick(s)}>
                <span className="stepnav-n" aria-hidden>{String(s).padStart(2, '0')}</span>
                <span className="stepnav-t">{name}</span>
                {/* итог пройденного шага появляется на 240 мс «Перелива» */}
                <span key={v ? 'v' : 'e'} className={`stepnav-v ${v ? 'nav-v-in' : ''}`} aria-hidden>{v ?? ''}</span>
                {cur === s && (
                  <motion.span layoutId="stepbar" className="stepnav-bar" aria-hidden transition={spring.ui}>
                    {NAV_TONE.map((k, j) => (
                      <motion.span key={k} className={`stepnav-bar-tone tone-${k}`} initial={{ opacity: j + 1 === fromTone ? 1 : 0 }}
                        animate={{ opacity: j + 1 === s ? 1 : 0 }} transition={{ duration: 0.32, ease: ease.out }} />
                    ))}
                  </motion.span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// v23 (макет): знак - квадрат 32 с градиентом бренда и буквой F
function BrandMark() {
  return <span className="logo-mark max-lg:!size-7 max-lg:!rounded-lg max-lg:!text-[17px]" aria-hidden>F</span>
}

// v23: фон шага - непрозрачный слой пятен своего тона поверх пятен «Атаки», кроссфейд 700 мс (только opacity)
function Backdrop({ tone }: { tone: string | null }) {
  return <>{(['gap', 'defense', 'customer'] as const).map((k) => <div key={k} aria-hidden className={`backdrop backdrop-${k}`} data-on={tone === k ? '' : undefined} />)}</>
}

function Splash() {
  const { t } = useLang()
  // та же разметка, что в index.html до загрузки кода: экран не мигает и не стоит пустым
  return <div className="boot" role="status"><div><b>Fraud <i>Twin</i></b><p>{t.boot}</p></div></div>
}

function Fatal({ msg }: { msg: string }) {
  const { t } = useLang()
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="plate max-w-[480px] p-8">
        <div className="t-title text-leak">{t.fatal}</div>
        <p className="mt-2 text-[16px] text-ink-2">{msg}</p>
        <button className="ctl ctl-main mt-5" onClick={() => location.reload()}>{t.reload}</button>
      </div>
    </div>
  )
}
