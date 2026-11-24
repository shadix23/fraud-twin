import { Component, Suspense, lazy, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Select } from '@base-ui/react/select'
import { Check, ChevronDown, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import type { Freeze, PresetInfo, Redteam, Scenario, TxEvent } from './data'
import { clock, dec } from './format'
import { C } from './sceneShared'

// Сцена «внутри банка» в трёх измерениях: слои цепочек вдоль глубины, граница банка плоскостью перед выводом.
// Сам 3D грузится отдельным куском: шапка, панель и транспорт появляются сразу.
export { SPEED, LINE_MIN, exitKey } from './sceneShared'
const Scene3D = lazy(() => import('./Scene3D'))

const hasWebGL = (() => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
})()

export interface SearchState { data: Redteam | null; n: number; error: string | null; finished: boolean }

export default function Scene(props: {
  sc: Scenario; log: TxEvent[]; freezes: Freeze[]; t: number; done: boolean
  span: { start: number; end: number }; playing: boolean
  presets: PresetInfo[]; scKey: string; onScheme: (k: string) => void; busy: boolean; isHole: boolean
  search: SearchState | null; onRetrySearch: () => void
  onPlay: () => void; onSkip: () => void; phase: string
  mark?: number | null; gone?: number | null; aside?: boolean; intro?: boolean; overlay?: ReactNode
}) {
  const { sc, log, freezes, t, done, search } = props
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ W: 900, H: 600 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const compact = size.W < 520

  return (
    <section className="scene relative isolate flex min-h-0 flex-1 flex-col text-ivory" aria-label="Двойник банка: путь денег">
      <div className={`flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5 lg:px-6 ${props.intro ? 'invisible' : ''}`}>
        <SchemeSelect presets={props.presets} value={props.scKey} onChange={props.onScheme} disabled={props.busy} />
        <Controls phase={props.phase} busy={props.busy} onPlay={props.onPlay} onSkip={props.onSkip} />
        <span className="font-mono text-[28px] font-medium leading-none tracking-tight" aria-label={`Время в двойнике ${clock(t)}`}>{clock(t)}</span>
      </div>

      <div ref={box} className="relative min-h-[320px] flex-1 overflow-hidden lg:min-h-0">
        {hasWebGL ? (
          <GLBoundary fallback={<NoGL />}>
            <Suspense fallback={<p className="absolute inset-0 grid place-items-center text-[18px] text-scene-ink-3">Строим сцену...</p>}>
              <Scene3D sc={sc} log={log} freezes={freezes} t={t} done={done} playing={props.playing} isHole={props.isHole}
                covered={!!search} compact={compact} mark={props.mark} gone={props.gone} aside={props.aside} />
            </Suspense>
          </GLBoundary>
        ) : <NoGL />}
        {search && (
          <svg width={size.W} height={size.H} className="absolute inset-0 block bg-[#080815]/90" role="img" aria-label="Поиск дыры: попытки ИИ-мошенника">
            <SearchField s={search} W={size.W} H={size.H} />
          </svg>
        )}
        {search?.error && (
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 px-6 text-center" role="alert">
            <p className="text-[18px] text-leak-scene">ИИ-мошенник не ответил: {search.error}</p>
            <button className="ctl ctl-scene" onClick={props.onRetrySearch}>Попробовать ещё раз</button>
          </div>
        )}
      </div>

      {props.overlay}
    </section>
  )
}

// Без WebGL сцены нет: говорим прямо, что делать; числа в панели считаются как обычно
function NoGL() {
  return (
    <div className="absolute inset-0 grid place-items-center px-6 text-center" role="alert">
      <div className="max-w-[440px]">
        <p className="text-[18px] font-medium">3D-сцена не запустилась</p>
        <p className="mt-2 text-[16px] text-scene-ink-3">Браузер не дал доступ к WebGL. Включите аппаратное ускорение в настройках или откройте страницу в Chrome. Числа в панели справа считаются как обычно.</p>
      </div>
    </div>
  )
}

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// Поле поиска: 200 попыток ИИ-мошенника, ступенчатая линия лучшего
function SearchField({ s, W, H }: { s: SearchState; W: number; H: number }) {
  const d = s.data
  const x0 = W < 520 ? 40 : 72, x1 = W - 40, y0 = W < 520 ? 52 : 70, y1 = H - 40
  const y = (pct: number) => y1 - (pct / 100) * (y1 - y0)
  if (!d) {
    return <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={18} fill="#fff">{s.error ? '' : 'Запускаем 200 прогонов против правил банка...'}</text>
  }
  const x = (i: number) => x0 + ((i - 1) / Math.max(1, d.evals - 1)) * (x1 - x0)
  const shown = d.history.slice(0, s.n)
  let best = d.base.pct
  let path = `M${x0},${y(best)}`
  const records = new Set<number>()
  for (const h of shown) {
    if (h.pct > best) { path += `H${x(h.i)}V${y(h.pct)}`; best = h.pct; records.add(h.i) }
  }
  if (shown.length) path += `H${x(shown[shown.length - 1].i)}`
  const last = shown[shown.length - 1]
  const bestTry = [...shown].reverse().find((h) => h.pct >= best - 1e-9)
  return (
    <g>
      <line x1={x0} x2={x1} y1={y(d.base.pct)} y2={y(d.base.pct)} stroke={C.node} strokeDasharray="6 6" strokeWidth={1.5} />
      <text x={x1} y={y(d.base.pct) + 22} textAnchor="end" fontSize={16} fill={C.node}>было {dec(d.base.pct)}%</text>
      {shown.map((h) => <circle key={h.i} cx={x(h.i)} cy={y(h.pct)} r={records.has(h.i) ? 5 : 3.5} fill={records.has(h.i) ? C.leak : C.node} opacity={records.has(h.i) ? 1 : 0.7} />)}
      <path d={path} fill="none" stroke={C.leak} strokeWidth={3} strokeLinejoin="round" />
      <text x={x0} y={y0 - 24} fontSize={16} fill="#fff">
        {last ? `Попытка ${last.i} из ${d.evals}` : ''}
      </text>
      {s.finished && bestTry && (
        <g>
          <circle cx={x(bestTry.i)} cy={y(best)} r={11} fill="none" stroke={C.leakText} strokeWidth={2.5} />
          <text x={Math.min(x(bestTry.i), x1 - 60)} y={y(best) - 22} textAnchor="middle" fontSize={28} fontWeight={650} fill={C.leakText}
            stroke={C.bg} strokeWidth={5} paintOrder="stroke">{dec(best)}%</text>
        </g>
      )}
    </g>
  )
}

// Пуск, пауза и «в конец» рядом с часами; до запуска кнопок нет, запуск делает главная кнопка шага
function Controls({ phase, busy, onPlay, onSkip }: { phase: string; busy: boolean; onPlay: () => void; onSkip: () => void }) {
  if (phase === 'idle') return <span className="ml-auto" />
  const label = phase === 'playing' ? 'Пауза' : phase === 'paused' ? 'Дальше' : 'Повторить'
  return (
    <span className="ml-auto flex items-center gap-2">
      <button className="ctl ctl-scene !h-10 !px-3 !text-[16px]" onClick={onPlay} disabled={busy} aria-keyshortcuts="Space">
        {phase === 'playing' ? <Pause size={16} strokeWidth={1.75} /> : phase === 'done' ? <RotateCcw size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
        {label}
      </button>
      {(phase === 'playing' || phase === 'paused') && (
        <button className="ctl ctl-scene !h-10 !px-3 !text-[16px]" onClick={onSkip} disabled={busy} aria-keyshortcuts="End">
          <SkipForward size={16} strokeWidth={1.75} />В конец
        </button>
      )}
    </span>
  )
}

function SchemeSelect({ presets, value, onChange, disabled }: { presets: PresetInfo[]; value: string; onChange: (k: string) => void; disabled: boolean }) {
  return (
    <Select.Root items={presets.map((p) => ({ value: p.key, label: p.title }))} value={value}
      onValueChange={(v) => v && onChange(v as string)} disabled={disabled}>
      <Select.Trigger aria-label="Схема атаки"
        className="ctl ctl-scene max-w-full min-w-0 !justify-between !font-medium data-[disabled]:opacity-45 sm:min-w-[340px]">
        <span className="min-w-0 flex-1 text-left leading-tight">
          <span className="block whitespace-nowrap text-[14px] font-normal text-scene-ink-3" data-library>{presets.length} схем в библиотеке</span>
          <Select.Value className="block truncate text-[16px]" />
        </span>
        <Select.Icon className="shrink-0"><ChevronDown size={18} strokeWidth={1.5} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-40">
          <Select.Popup className="min-w-[var(--anchor-width)] rounded-lg border border-scene-line bg-scene-2 p-1 text-ivory shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] outline-none
            origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
            {presets.map((p) => (
              <Select.Item key={p.key} value={p.key}
                className="flex min-h-11 cursor-default items-center gap-3 rounded-md px-3 text-[16px] outline-none select-none data-[highlighted]:bg-scene-3">
                <span className="w-4"><Select.ItemIndicator><Check size={16} strokeWidth={1.5} /></Select.ItemIndicator></span>
                <Select.ItemText>{p.title}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
