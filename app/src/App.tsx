import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { Select } from '@base-ui/react/select'
import { Popover } from '@base-ui/react/popover'
import { ArrowRight, Check, ChevronDown, Info, Landmark, Menu, Play } from 'lucide-react'
import { DEMO_CTX, editable, hasApi, honestPrices, loadBank, loadClientCheck, loadReadyHole, isLowerBound, profilePct, type ClientCheck, runRedteam, RuleError, rulesDiff, sameRules, warmApi, type RedteamResult, type RuleErr, type RuleSet, loadScenario, runKey, type Bank, type Calib, type Ctx, type Freeze, type Redteam, type RunKey, type Scenario, type TxEvent } from './data'
import Calibration from './Calibration'
import { FeedDialog } from './Feed'
import How from './How'
import ClientScreen, { ClientFacts, ClientOutcomes, type PhoneState } from './ClientCard'
import { TOUR, TourCaption, type TourId } from './Intro'
import { EntryPlate, EntryTiles, useEntryFacts } from './Entry'
import { LANGS, useLang, type Lang } from './i18n'
import { Dec, Money, STEP_TONE, StepTile } from './ui'
import Report from './Report'
import Scene, { LINE_MIN, SPEED } from './Scene'
import { CaseTask, caughtNote, SceneWords, type Shown } from './Panel'
import { AiVsModel, HonestField, MeasureRow, MeasuresHead, useDesk } from './Defense'
import { intl, kzt } from './format'
import { insteadText, RulesEditor, type ApiState } from './RulesEditor'
import { TradeoffMap, type ModelMark } from './Tradeoff'
import { Rounds, type Round } from './Rounds'
import { Changes, MapTabs, Pct, runningPct, SearchMap, type MapState, type MapTab } from './Gap'

const STOP = new Set(['blocked', 'suspended', 'cancelled', 'frozen_src', 'frozen_dst'])
const SEARCH_MS = 9000 // анимация 200 попыток
const SEARCH_MS_AGAIN = 4500 // следующие раунды: зритель уже видел поиск, ждать 9 с каждый раз долго
type Phase = 'idle' | 'playing' | 'paused' | 'done'
type Step = 0 | 1 | 2 | 3 | 4 // 4 - «Клиент», отчёт открывается отдельной страницей
// автопоказ: сколько держим кадр после того, как стадия закончилась
// v17: паузы под длину подписей (с задачей кейса 17-30 слов): на стадию не меньше 2,5 слова в секунду плюс 1,5 с, весь показ около минуты
const TOUR_DWELL: Record<TourId, number> = { attack: 3400, hole: 2600, holeRun: 2800, defense: 4800, client: 4800, report: 0 }
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
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

  const goStep = (s: number) => {
    if (s === 5) { setPage('report'); return }
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
    return { label: tr.main.report, on: () => setPage('report'), disabled: false }
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

  // v20-fix D5: у плиты шага есть что-то ниже края - низ плиты гаснет градиентом, это подсказка прокрутки
  const [moreEl, setMoreEl] = useState<HTMLDivElement | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = moreEl
    if (!el) { setMore(false); return }
    const upd = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd); ro.observe(el)
    const mo = new MutationObserver(upd); mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => { el.removeEventListener('scroll', upd); ro.disconnect(); mo.disconnect() }
  }, [moreEl])

  const facts = useEntryFacts(scKey, ctx)
  const desk = useDesk()
  vsModelRef.current = view === 'hole' && !!hole?.rules?.model_on
  if (error) return <Fatal msg={error} />
  if (!bank || !sc || !run || !final) return <Splash />
  const mark = modelMark && modelMark.ep === roundsEpoch.current ? modelMark : null
  if (page === 'report') return <Report ctx={ctx} bank={bank} rounds={rounds} profile={profile} modelMark={mark} scheme={scKey} langSwitch={<LangSwitch />} onBack={() => { setPage('twin'); history.replaceState(null, '', ' ') }} />

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
      api={api} err={ruleErr} setErr={setRuleErr} profileName={bank.name} />
  )
  const thr = bank.model?.threshold ?? 0.3
  const fresh = step === 0
  // v21 (wow-v21, п. 7): на телефоне в шагах правил и «Атаки» правила банка выше сцены - свои пороги видны сразу
  const rulesFirst = step <= 1
  // автопоказ рассказывает про демо-схему, поэтому из панели он доступен только на ней
  const tourReady = scKey === 'student_crypto' && ctx.preset === 'demo'
  const guided = intro || tour != null
  const mapState: MapState = { data: hole, n: searching ? searchN : hole?.history.length ?? 0, searching: searching && !searchFinished, error: holeErr }
  // плитка «Дыры»: доля ушедшего у лучшей попытки, во время поиска растёт вместе с картой
  const gapPct = hole ? (searching && !searchFinished ? runningPct(hole, searchN) : hole.best.pct) : lastPct.current
  lastPct.current = gapPct
  const holeRuns = hole?.scenario.runs

  const pickEntry = (s: number) => {
    if (s === 1) { leaveIntro(); setStep(1); play(true) }
    else if (s === 5) { setIntro(false); setPage('report') }
    else jump(s)
  }
  const n = Math.max(1, step)
  const field = <HonestField per10k={per10k} onFeed={() => setFeed({ open: true, tab: 'honest' })} />
  const stepName = [tr.steps.attack, tr.steps.gap, tr.steps.defense, tr.steps.customer, tr.steps.report][n - 1]

  return (
    <div className={`app-h flex flex-col bg-bg text-ink lg:h-screen lg:overflow-hidden ${intro ? '' : 'max-lg:pb-(--bar-h)'}`}>
      <button className="ctl ctl-main sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50" onClick={() => document.getElementById('main')?.focus()}>{tr.skip}</button>
      {!intro && <h1 className="sr-only">Fraud Twin: {stepName}</h1>}
      <header className="z-30 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2 lg:grid lg:h-16 lg:shrink-0 lg:grid-cols-[1fr_auto_1fr] lg:px-4 lg:pt-0">
        <div className="flex min-w-0 items-center gap-2">
          <button className="-m-1 shrink-0 rounded-xl p-1" onClick={goHome} aria-label={tr.home} title={tr.home}><BrandMark /></button>
          <p className="whitespace-nowrap text-[20px] font-semibold leading-none tracking-[-0.03em]">Fraud <span className="text-brand">Twin</span></p>
        </div>
        <div className="max-lg:order-last max-lg:-mx-3 max-lg:w-[calc(100%+24px)] max-lg:overflow-x-auto max-lg:px-3 max-lg:pb-1">
          <Segments step={step} hasHole={!!hole && !searching} busy={searching} locked={guided} onPick={goStep} />
        </div>
        <div className="ml-auto flex items-center gap-2 lg:justify-self-end">
          <LangSwitch />
          <button className="ctl ctl-quiet !h-11 whitespace-nowrap !px-4 !font-medium max-lg:hidden max-[1399px]:!w-11 max-[1399px]:!px-0" onClick={openHow} inert={tour != null} aria-label={tr.header.howAria}>
            <Info size={17} strokeWidth={1.75} aria-hidden /><span className="max-[1399px]:hidden">{tr.header.how}</span>
          </button>
          <span className="max-lg:hidden" inert={guided}><BankSelect bank={bank} preset={ctx.preset} disabled={searching} onPick={pickBank} /></span>
          <span className="lg:hidden" inert={tour != null}><MobileMenu bank={bank} preset={ctx.preset} disabled={searching || guided} onPick={pickBank} onHow={openHow} /></span>
        </div>
      </header>
      <Calibration open={calibOpen} bank={bank} live={source === 'api'} onApply={applyCalib} onClose={() => setCalibOpen(false)} />
      <How open={howOpen} bank={bank} facts={facts} onClose={() => { setHowOpen(false); if (location.hash === '#how') history.replaceState(null, '', ' ') }} onStep={jump} />
      <FeedDialog open={feed.open} tab={feed.tab} setTab={(tab) => setFeed({ open: true, tab })} onClose={() => setFeed((f) => ({ ...f, open: false }))}
        sc={sc} log={log} honest={bank.honest_feed?.[rk]} thr={thr} measure={tr.feed.measures[rk]} />

      {/* каркас 12 колонок: вход 7+5 и ряд плиток, рабочий экран 8+4. Сцена всегда в одном месте дерева, 3D не пересоздаётся */}
      <main id="main" tabIndex={-1} className={`grid flex-1 outline-none grid-cols-1 gap-2 p-2 lg:min-h-0 lg:grid-cols-12 lg:gap-3 lg:p-3 lg:pt-0 ${intro ? 'lg:grid-rows-[minmax(0,1fr)_auto]' : 'lg:grid-rows-[minmax(0,1fr)]'}`}>
        {intro ? <EntryPlate clients={bank.summary.clients} onStart={() => { leaveIntro(); setStep(1); play(true) }} onTour={startTour} /> : null}
        <div className={`flex min-h-0 flex-col gap-2 lg:gap-3 ${intro ? 'lg:col-span-5' : `lg:col-span-8 ${rulesFirst ? 'max-lg:order-3' : 'max-lg:order-2'}`} ${clientOpen ? 'lg:flex-row' : ''}`}>
          {clientOpen && <ClientScreen data={client?.data ?? (client === undefined ? undefined : null)} pick={clientPick} onPick={setClientPick}
            auto={tourId === 'client'} onState={onPhone} onClose={() => { stopTour(); goStep(3) }} />}
          {clientOpen && <ClientOutcomes data={client?.data} pick={clientPick} onPick={setClientPick} after={phone.after}
            footer={tour != null ? <div className="tour-in-plate"><TourCaption i={tour} onStop={stopTour} /></div> : !intro ? <CaseTask step={step} onHow={openHow} /> : null} />}
          <Scene sc={sc} log={log} freezes={run.freezes} t={t} done={phase === 'done'} span={span} playing={phase === 'playing'}
            presets={bank.presets} scKey={scKey} onScheme={setScKey} busy={searching} isHole={view === 'hole'}
            covered={searching} split={(step === 2 || step === 3) && !intro} narrow={clientOpen}
            onPlay={togglePlay} onSkip={skip} phase={phase}
            mark={clientOpen && phone.level && phone.level !== 'low' && !phone.after ? clientChain : null}
            gone={phone.after === 'cancel' ? clientChain : null} aside={intro} intro={intro} hideMobile={clientOpen} off={clientOpen}
            overlay={<>
              {tour != null && <TourCaption i={tour} onStop={stopTour} />}
              {!intro && tour == null && !searching && !clientOpen && <CaseTask step={step} onHow={openHow} />}
            </>} />
          {step === 2 && !intro && (mapTab === 'tradeoff' && !searching
            ? <TradeoffMap rounds={rounds} model={mark} meta={bank.rule_meta} unseen={unseenPct} scheme={scKey} ctx={ctx} head={<MapTabs tab={mapTab} onTab={setMapTab} />} />
            : <SearchMap s={mapState} meta={bank.rule_meta} onRetry={findHole} head={<MapTabs tab={searching ? 'search' : mapTab} onTab={(v) => { if (!searching) setMapTab(v) }} />} />)}
          {step === 3 && !intro && desk && holeRuns && <div className="plate shrink-0 px-6 pb-4 pt-3.5 short:pb-3 short:pt-2.5">{field}</div>}
        </div>

        {!intro ? (
          <aside className="flex min-h-0 flex-col gap-3 lg:col-span-4 max-lg:contents" aria-label={stepName} inert={tour != null}>
            <StepTile tone={STEP_TONE[step]} className="flex shrink-0 flex-col p-6 pb-9 short:p-5 short:pb-7 max-lg:order-1 max-lg:p-5 max-lg:pb-7">
              <div className="flex items-center justify-between gap-3">
                <span className="t-caps">{stepName}</span>
                <span className="t-caps opacity-80">{n} / 5</span>
              </div>
              {step === 2 ? (
                <div id="number" className="mt-5 grid gap-5 short:mt-3 short:gap-3" aria-live="polite">
                  <div className="min-w-0">
                    {atLeast && <div className="t-caption -mt-1 mb-1 opacity-90" data-at-least>{tr.gap.atLeast}</div>}
                    <div className="t-num1" data-gap-pct><Pct v={gapPct} /></div>
                    <div className="t-caption mt-2 opacity-90">{vsModel ? tr.gap.leakModel(kzt(shown.w, lang)) : tr.gap.leak(kzt(shown.w, lang))}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="t-num2"><Dec v={per10k} /></div>
                    <div className="t-caption mt-2 opacity-90">{tr.nums.honest} {tr.nums.per10k}</div>
                  </div>
                </div>
              ) : step === 4 ? (
                <div id="number" className="mt-5 grid gap-5 short:mt-3 short:gap-3" aria-live="polite" data-client-tile>
                  {robust ? (
                    <div className="min-w-0">
                      <div className="t-num1">{pctText(robust.victims.repeat_on_card_covered_pct)}%</div>
                      <div className="t-caption mt-2 opacity-90">{tr.client.covered}</div>
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <div className={robust ? 't-num2' : 't-num1'}>{warnPer10k != null ? tr.client.approx(Math.round(warnPer10k)) : '-'}</div>
                    <div className="t-caption mt-2 opacity-90">{tr.client.warnings}</div>
                  </div>
                </div>
              ) : fresh ? (
                <div className="mt-5 short:mt-3">
                  <p className="t-title">{tr.nums.calm}</p>
                  <p className="mt-1 text-[16px] opacity-90">{tr.nums.calmText(intl(bank.summary.clients, lang))}</p>
                  {tourReady && (
                    <button className="ctl mt-4 !h-10 bg-white !px-4 text-ink hover:bg-white/90 short:mt-3" onClick={startTour}>
                      <Play size={14} strokeWidth={2.25} aria-hidden />{tr.nums.tour}
                    </button>
                  )}
                </div>
              ) : (
                <div id="number" className="mt-5 grid gap-5 short:mt-3 short:gap-3" aria-live="polite">
                  <div className="min-w-0">
                    <div className="t-num1"><Money v={shown.w} /></div>
                    <div className="t-caption mt-2 opacity-90">{tr.nums.withdrawn} {shown.att > 0 ? tr.nums.of(kzt(shown.att, lang)) : ''}</div>
                    {/* v21: «0 ₸» с моделью верно только против уже найденной атаки, так и подписано */}
                    {step === 3 && model && !vsModel && <div className="t-caption mt-1 opacity-90" data-found-only>{tr.defense.foundOnly}</div>}
                    {/* v21 (wow-v21, п. 2): рядом с «0 ₸» честная цифра модели на схемах, которых она не видела */}
                    {step === 3 && model && !vsModel && unseenPct != null && (
                      <div className="t-caption mt-1 opacity-90" title={tr.defense.unseenTitle} data-unseen-tile>{tr.defense.unseen(pctText(unseenPct))}</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="t-num2"><Dec v={per10k} /></div>
                    <div className="t-caption mt-2 opacity-90">{tr.nums.honest} {tr.nums.per10k}</div>
                  </div>
                </div>
              )}
            </StepTile>
            <section className={`plate flex min-h-0 flex-1 flex-col ${rulesFirst ? 'max-lg:order-2' : 'max-lg:order-3'}`} aria-label={stepName}>
              <div key={step} ref={setMoreEl} className={`step-in min-h-0 flex-1 space-y-4 px-5 pb-4 pt-5 lg:overflow-y-auto ${step === 2 ? 'lg:space-y-3 lg:pt-4' : ''} lg:px-6 short:space-y-2.5 short:pb-2 short:pt-3.5 ${more ? 'scroll-more' : ''}`}>
                {step === 0 && <>{editor(null)}<SceneWords /></>}
                {step === 1 && <>{editor(phase === 'done' ? final.rule_hits : liveHits(log, run.freezes, t), phase === 'done' ? caughtNote(final, tr, lang) : undefined)}<SceneWords /></>}
                {step === 2 && <>
                  {fallbackNote && <p role="status" className="text-[15px] font-medium leading-snug text-warn" data-fallback>{fallbackNote}</p>}
                  <Changes data={hole} searching={searching} />
                  <Rounds rounds={searching && hole ? rounds.slice(0, -1) : rounds} meta={bank.rule_meta} />
                </>}
                {step === 3 && holeRuns && <>
                  <div data-measures>
                    <MeasuresHead />
                    <MeasureRow on={model || vsModel} locked={vsModel} set={(v) => toggleMeasure('model', v)} hotkey="1" name={tr.defense.model}
                      hint={vsModel ? undefined : tr.defense.modelHint} note={vsModel ? tr.defense.modelLocked : undefined} price={vsModel ? null : priceDelta('model')} />
                    <MeasureRow on={hold} set={(v) => toggleMeasure('hold', v)} hotkey="2" name={tr.defense.hold} note={tr.defense.holdNote} price={priceDelta('hold')} />
                    {priceFailed && <p className="mt-1 text-[15px] leading-snug text-ink-2" data-price-note>{tr.defense.priceProfile}</p>}
                  </div>
                  {!desk && field}
                  {aiMain
                    ? <button type="button" className="ctl ctl-quiet !h-11 !px-4 !font-medium" onClick={() => goStep(4)} data-to-client>{tr.defense.toClient}</button>
                    : api !== 'static' && !vsModel && <AiVsModel onAi={() => { markModel(); runSearch(true) }} />}
                </>}
                {step === 4 && <ClientFacts check={client} />}
              </div>
              <div className="fixed inset-x-0 bottom-0 z-30 bg-linear-to-t from-bg from-60% to-bg/0 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-4 lg:static lg:z-10 lg:bg-none lg:px-6 lg:pb-6 lg:pt-3 short:pb-5">
                <div className="flex gap-2">
                  <button ref={mainBtn} className="ctl ctl-main min-w-0 flex-1 !justify-between whitespace-nowrap !px-6" onClick={main.on} disabled={main.disabled} aria-keyshortcuts="ArrowRight">
                    {main.label}
                    <ArrowRight size={18} strokeWidth={2} className="next" aria-hidden />
                  </button>
                  {edited && (step === 0 || step === 1) && (
                    <button type="button" className="ctl ctl-quiet shrink-0 !px-5" onClick={() => { setDraft(profile); setRuleErr(null) }} aria-label={tr.rules.resetAria} title={tr.rules.resetAria}>{tr.rules.reset}</button>
                  )}
                </div>
              </div>
            </section>
          </aside>
        ) : null}

        {intro ? <EntryTiles facts={facts} withdrawn={libSc?.runs.base.metrics.withdrawn_kzt ?? 0} schemes={bank.presets.length} onPick={pickEntry} /> : null}
      </main>
      <p className="sr-only" aria-live="polite">{phase === 'done' ? tr.liveDone(kzt(final.withdrawn_kzt, lang)) : ''}</p>
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

// Профиль банка в шапке: тот же движок под другой банк одним выбором. Названия профилей приходят из симулятора
function bankItems(bank: Bank, t: ReturnType<typeof useLang>['t']) {
  return [...bank.calib_presets.map((p) => ({ value: p.id, label: p.name, note: p.note })), { value: 'custom', label: t.header.custom, note: t.header.customNote }]
}

function BankSelect({ bank, preset, disabled, onPick }: { bank: Bank; preset: string | null; disabled: boolean; onPick: (id: string) => void }) {
  const { t } = useLang()
  const items = bankItems(bank, t)
  return (
    <Select.Root items={items} value={preset ?? 'custom'} onValueChange={(v) => v && onPick(v as string)} disabled={disabled}>
      <Select.Trigger aria-label={t.header.bankAria} className="ctl ctl-quiet !h-11 !justify-between !gap-2 !px-4 !font-medium text-left data-[disabled]:opacity-45">
        <Landmark size={17} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
        <Select.Value className="block whitespace-nowrap" />
        <Select.Icon className="shrink-0 text-ink-3"><ChevronDown size={16} strokeWidth={1.75} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} align="end" alignItemWithTrigger={false} className="z-40">
          <Select.Popup className="w-[min(340px,calc(100vw-24px))] rounded-[22px] bg-surface p-1.5 text-ink shadow-[0_1px_2px_rgba(14,14,17,0.06),0_18px_40px_-16px_rgba(14,14,17,0.3)] outline-none
            origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
            {items.map((p) => (
              <Select.Item key={p.value} value={p.value}
                className={`flex cursor-default items-start gap-3 rounded-2xl px-3 py-2.5 outline-none select-none data-[highlighted]:bg-surface-2 ${p.value === 'custom' ? 'mt-1' : ''}`}>
                <span className="mt-0.5 w-4 shrink-0"><Select.ItemIndicator><Check size={16} strokeWidth={2} /></Select.ItemIndicator></span>
                <span className="min-w-0">
                  <Select.ItemText className="block text-[15px] font-medium">{p.label}</Select.ItemText>
                  <span className="t-caption block text-ink-3">{p.note}</span>
                </span>
              </Select.Item>
            ))}
            <p className="px-3 pb-2 pt-2 text-[13px] leading-snug text-ink-3">{t.header.bankFoot}</p>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

// Телефон: «Как устроено» и профиль банка в одном меню
function MobileMenu({ bank, preset, disabled, onPick, onHow }: { bank: Bank; preset: string | null; disabled: boolean; onPick: (id: string) => void; onHow: () => void }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const cur = preset ?? 'custom'
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="ctl ctl-quiet !h-11 !w-11 !px-0" aria-label={t.header.menu}><Menu size={18} strokeWidth={1.75} aria-hidden /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-40">
          <Popover.Popup className="w-[min(320px,calc(100vw-16px))] rounded-[22px] bg-surface p-1.5 text-ink shadow-[0_1px_2px_rgba(14,14,17,0.06),0_18px_40px_-16px_rgba(14,14,17,0.3)] outline-none">
            <button className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-medium hover:bg-surface-2" onClick={() => { setOpen(false); onHow() }}>
              <Info size={17} strokeWidth={1.75} className="text-ink-3" aria-hidden />{t.header.how}
            </button>
            <p className="t-caps px-3 pb-1 pt-3 text-ink-3">{t.header.bankAria}</p>
            {bankItems(bank, t).map((p) => (
              <button key={p.value} disabled={disabled} aria-pressed={cur === p.value} onClick={() => { setOpen(false); onPick(p.value) }}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-medium hover:bg-surface-2 disabled:opacity-45">
                <span className="w-4 shrink-0">{cur === p.value && <Check size={16} strokeWidth={2} aria-hidden />}</span>{p.label}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// RU/EN пилюлей: aria-pressed, меняет <html lang> и заголовок вкладки (i18n/index.tsx)
function LangSwitch() {
  const { lang, setLang, t } = useLang()
  return (
    <div className="seg seg-sm" role="group" aria-label={t.header.lang}>
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button key={l} type="button" className="seg-item" aria-pressed={lang === l} lang={l} title={LANGS[l].langName} onClick={() => setLang(l)}>
          {lang === l && <span className="seg-on" aria-hidden />}<span className="relative">{l.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}

// Сегмент шагов: белая дорожка-пилюля на фоне, активный шаг чёрная пилюля (скользит 220 мс), недоступные ink-3 45%
function Segments({ step, hasHole, busy, locked, onPick }: { step: Step; hasHole: boolean; busy: boolean; locked: boolean; onPick: (s: number) => void }) {
  const { t } = useLang()
  const items = [{ s: 1, t: t.steps.attack }, { s: 2, t: t.steps.gap }, { s: 3, t: t.steps.defense }, { s: 4, t: t.steps.customer }, { s: 5, t: t.steps.report }]
  const cur = Math.max(1, step)
  return (
    <ToggleGroup value={[String(cur)]} onValueChange={(v) => v[0] && onPick(Number(v[0]))} aria-label={t.stepsAria} inert={locked}
      className="seg seg-steps w-max max-lg:min-w-full">
      {items.map((it) => {
        const lockedStep = (it.s === 3 || it.s === 4) && !hasHole
        return (
          <Toggle key={it.s} value={String(it.s)} disabled={busy || lockedStep} aria-current={cur === it.s ? 'step' : undefined}
            title={lockedStep ? t.stepLockedHint : undefined}
            aria-label={lockedStep ? t.stepLocked(it.t) : t.stepAria(it.s, 5, it.t)}
            className="seg-item">
            {cur === it.s && <motion.span layoutId="seg" className="seg-on" transition={{ duration: reduced() ? 0 : 0.22, ease: [0.2, 0, 0, 1] }} />}
            <span className="relative">{it.t}</span>
          </Toggle>
        )
      })}
    </ToggleGroup>
  )
}

// Знак Fraud Twin: буква F и её близнец, повёрнутый на 180°; зазор между перекладинами - дыра. v20: графит и brand вместо неона
function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" className="shrink-0" aria-hidden>
      <g fill="#0E0E11"><rect x="4" y="4" width="5" height="24" rx="1.3" /><rect x="4" y="4" width="16" height="5" rx="1.3" /><rect x="4" y="13.5" width="10" height="5" rx="1.3" /></g>
      <g fill="#5B4BD6"><rect x="23" y="4" width="5" height="24" rx="1.3" /><rect x="12" y="23" width="16" height="5" rx="1.3" /><rect x="18" y="13.5" width="10" height="5" rx="1.3" /></g>
    </svg>
  )
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
