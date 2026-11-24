// Типы и загрузка данных. Сначала API (если задан VITE_API_URL), при сбое -
// готовые прогоны из public/scenarios. Метка «синтетический банк» есть в обоих.

export type RunKey = 'base' | 'model' | 'hold' | 'model_hold'

export interface RuleMeta { key: string; title: string; action: string; param: string; unit: string }

export interface HonestCost {
  honest_watched_tx: number; blocked: number; held: number; suspended: number
  alerts: number; frozen_clients: number; delayed_per_10k: number; frozen_clients_pct: number
}

export interface PresetInfo {
  key: string; title: string; source: string; drops: number
  params: Record<string, unknown>
}

export type Calib = Record<string, number>
export interface CalibField { key: string; target: 'profile' | 'rules'; min: number; max: number; step: number; title: string; unit: string }
export interface CalibPreset { id: string; name: string; note: string; values: Calib }
// Текущий профиль банка: значения ползунков и id готового профиля (если совпал)
export interface Ctx { calib: Calib | null; preset: string | null }
export const DEMO_CTX: Ctx = { calib: null, preset: 'demo' }

export interface Bank {
  synthetic: true
  name: string
  calib: Calib
  calib_preset: string | null
  calib_fields: CalibField[]
  calib_presets: CalibPreset[]
  summary: { clients: number; honest_tx: number; segments: Record<string, number>; honest_by_channel: Record<string, number> }
  segments_ru: Record<string, string>
  cloud: string
  rules: Record<string, number | boolean>
  rule_meta: RuleMeta[]
  whatif_meta: RuleMeta[]
  presets: PresetInfo[]
  honest_cost: Record<RunKey, HonestCost>
  honest_feed?: Record<RunKey, HonestFeed>
  model?: ModelInfo
}

export interface BenchRow {
  key: string; title: string
  pr_auc: { rules: number; heuristic: number; boosting: number }
  rules_pct: number; heuristic_pct: number; boosting_pct: number; honest_per_10k: number
}

export interface ModelInfo {
  name: string; trained: boolean; algo?: string; worlds?: number; rows?: number
  summary?: { pr_auc_mean: Record<string, number>; withdrawn_pct_mean: Record<string, number> }
  benchmark: BenchRow[]; notes?: string[]; threshold?: number
}

export interface RedteamTry { i: number; gen: number; fit: number; pct: number; caught: string; rule: string }

export interface Redteam {
  synthetic: true
  scheme: string
  evals: number
  seconds: number
  base: { fit: number; pct: number; metrics: Metrics }
  best: {
    fit: number; pct: number; metrics: Metrics; params: Record<string, unknown>
    diff: { param: string; title: string; from: string | number; to: string | number }[]
    silent_rules: string[]; recheck_withdrawn_kzt: number[]; hints: string[]
  }
  history: RedteamTry[]
  scenario: Scenario
}

export interface TxEvent {
  t: number; src: number; dst: number; amount: number
  kind: 'victim' | 'drop' | 'cashout'; chain: number; hop: number
  status: 'ok' | 'blocked' | 'suspended' | 'held' | 'cancelled' | 'frozen_src' | 'frozen_dst'
  rule: string; channel: string
  // лента переводов: риск модели 0..1 и причина словами (sim/fraudtwin/feed.py); в старых прогонах полей нет
  risk?: number | null; why?: string; side?: string
}

// честный перевод, который задела мера: строка из прогона всего честного трафика
export interface HonestRow {
  t: number; src: number; dst: number; amount: number; kind: 'honest'
  status: 'blocked' | 'suspended' | 'held'; rule: string; channel: string; risk: number | null; why: string
}
export interface HonestFeed { rows: HonestRow[]; total: { blocked: number; suspended: number; held: number }; watched: number }

export interface Freeze { t: number; id: number; rule: string; chain: number; balance: number }

export interface Metrics {
  scheme: string; attempted_kzt: number; withdrawn_kzt: number; intercepted_kzt: number
  frozen_kzt: number; prevented_kzt: number; stuck_kzt: number
  withdrawn_by_channel: Record<string, number>
  chains_total: number; chains_caught: number; drops_total: number; drops_frozen: number
  minutes_to_first_freeze: number | null; rule_hits: Record<string, number>; scheme_cost_kzt: number
}

export interface GNode {
  id: number; role: 'drop' | 'victim' | 'honest' | 'trader' | 'sink' | 'atm' | 'ext'
  seg?: string; age?: number; phone_share?: number; chain?: number; layer?: number; label?: string
  x?: number; y?: number
}

export interface GLink { source: number | GNode; target: number | GNode; kind: 'honest' | 'attack' }

export interface Scenario {
  synthetic: true
  scheme: { key: string; title: string; source: string; start_min: number } & Record<string, unknown>
  drops: number
  chains: { id: number; victims: number[]; layers: number[][] }[]
  nodes: GNode[]
  links: GLink[]
  runs: Record<RunKey, { metrics: Metrics; log: TxEvent[]; freezes: Freeze[] }>
  horizon_min: number
}

const API = import.meta.env.VITE_API_URL as string | undefined
// ссылка на репозиторий появится в «Как устроено», когда её зададут при сборке
export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || ''
export const hasApi = !!API

// Свой профиль без сервера посчитать нельзя: это сообщение показываем как есть
export class OfflineError extends Error {
  constructor() {
    super('Сервер симулятора не отвечает, а свой профиль считается только на нём. Готовые профили работают без сервера.')
  }
}

const dirOf = (ctx: Ctx) =>
  ctx.preset === 'demo' ? '/scenarios' : ctx.preset ? `/scenarios/p_${ctx.preset}` : null

async function getJson<T>(ctx: Ctx, apiPath: string, file: string, body?: object, timeout = 4000): Promise<{ data: T; source: 'api' | 'json' }> {
  if (API) {
    let r: Response | null = null
    try {
      r = await fetch(API + apiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, calib: ctx.calib }), signal: AbortSignal.timeout(timeout) })
    } catch { r = null /* сервер недоступен или не успел: готовые прогоны */ }
    if (r?.ok) return { data: (await r.json()) as T, source: 'api' }
    if (r?.status === 422) {
      const detail = await r.json().catch(() => null)
      throw new Error(typeof detail?.detail === 'string' ? detail.detail : 'Неверные параметры калибровки')
    }
  }
  const dir = dirOf(ctx)
  if (!dir) throw new OfflineError()
  const r = await fetch(`${dir}/${file}`)
  if (!r.ok) throw new Error(`Не удалось загрузить ${dir}/${file}`)
  return { data: (await r.json()) as T, source: 'json' }
}

export const loadBank = (ctx: Ctx) => getJson<Bank>(ctx, '/world', 'bank.json', {}, 6000)
export const loadScenario = (key: string, ctx: Ctx) => getJson<Scenario>(ctx, '/attack', `${key}.json`, { scheme: key })
// ИИ-мошенник: живой поиск занимает 1-3 с, даём API до 15 с, потом готовый прогон
export const loadRedteam = (key: string, ctx: Ctx) =>
  getJson<Redteam>(ctx, '/redteam', `redteam_${key}.json`, { scheme: key }, 15000)
// Отчёт: 5 схем, поиск дыр против правил и против модели, ~15 с без кэша
export const loadReport = (ctx: Ctx) => getJson<Report>(ctx, '/report', 'report.json', {}, 40000)

export const runKey = (model: boolean, hold: boolean): RunKey =>
  model && hold ? 'model_hold' : model ? 'model' : hold ? 'hold' : 'base'

export interface ShortMetrics {
  withdrawn: number; intercepted: number; attempted: number
  chains_caught: number; chains_total: number; rule_hits: Record<string, number>
}

export interface ReportScheme {
  key: string; title: string; source: string
  lib: Record<RunKey, ShortMetrics>; hole: Record<RunKey, ShortMetrics>
  rematch: { withdrawn: number; attempted: number; pct: number; diff: Redteam['best']['diff'] }
  diff: Redteam['best']['diff']; silent_rules: string[]; hints: string[]; evals: number
  recheck_withdrawn: number[]
}

export interface Report {
  synthetic: true
  bank: { name: string; calib: Calib; preset: string | null; clients: number; honest_tx: number; rules: Record<string, number> }
  summary: { schemes: number; holes_found: number; attempted: number; lib_withdrawn: number; hole_withdrawn: number
    lib_pct: number; hole_pct: number; rematch_withdrawn: number; rematch_pct: number }
  schemes: ReportScheme[]
  measures: { key: RunKey; title: string; lib_withdrawn: number; hole_withdrawn: number
    delayed_per_10k: number; frozen_clients: number; frozen_clients_pct: number }[]
  recommendations: { title: string; text: string; where?: string[]; kind: string }[]
  caveats: string[]
}

// Экран клиента: та же модель смотрит на карту получателя до перевода (hackathon/client-screen.md)
export type ClientLevel = 'high' | 'medium' | 'low' | 'blocked'
export interface ClientButton { id: string; label: string; primary?: boolean; quiet?: boolean }
export interface ClientCase {
  transfer: { amount: number; time: string; new_recipient: boolean; recipient: { name: string; phone_mask: string; card_mask: string } }
  risk: { score: number; level: ClientLevel; basis: 'flow' | 'no_history' | 'blocked' }
  reasons: { key: string; text: string }[]
  action?: string
  screen: { title: string; subtitle?: string; question?: string; buttons?: ClientButton[]; footnote?: string; button?: string }
}
export interface ClientCheck {
  synthetic: true; note: string
  scheme: { key: string; title: string; hole: boolean }
  demo: string
  cases: Record<string, ClientCase | undefined>
  after: Record<string, string>
  stats: { honest: { high_per_10k: number; honest_p2p_tx: number } } & Record<string, unknown>
  robust?: { honest_worlds: number; honest: { high_per_10k: number; honest_p2p_tx: number }; victims: { first_on_card_silent_pct: number; repeat_on_card_covered_pct: number } }
}

// Демо: GET /client-check (дыра student_crypto), до 1 с; иначе готовый файл. Нет и его - null, экран покажет обычный «отправлен»
export async function loadClientCheck(scheme: string, ctx: Ctx): Promise<{ data: ClientCheck | null; robust: ClientCheck['robust'] | null }> {
  const demo = scheme === 'student_crypto' && ctx.preset === 'demo'
  const file = demo ? fetch('/scenarios/client_check.json').then((r) => (r.ok ? (r.json() as Promise<ClientCheck>) : null)).catch(() => null) : Promise.resolve(null)
  let live: ClientCheck | null = null
  if (API) {
    try {
      const r = demo
        ? await fetch(`${API}/client-check`, { signal: AbortSignal.timeout(1000) })
        : await fetch(`${API}/client-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheme, calib: ctx.calib, hole: true }), signal: AbortSignal.timeout(2500) })
      if (r.ok) live = (await r.json()) as ClientCheck
    } catch { live = null /* сервер не ответил: готовый файл */ }
  }
  const f = await file
  return { data: live ?? f, robust: f?.robust ?? null }
}
