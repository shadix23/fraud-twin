import { Component, Suspense, lazy, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Select } from '@base-ui/react/select'
import { Check, ChevronDown, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import type { Freeze, PresetInfo, Scenario, TxEvent } from './data'
import { clock } from './format'
import { useLang } from './i18n'

// Сцена «внутри банка» в трёх измерениях: слои цепочек вдоль глубины, граница банка плоскостью перед выводом.
// Сам 3D грузится отдельным куском: шапка, панель и транспорт появляются сразу.
export { SPEED, LINE_MIN, exitKey } from './sceneShared'
const Scene3D = lazy(() => import('./Scene3D'))

const hasWebGL = (() => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
})()

export default function Scene(props: {
  sc: Scenario; log: TxEvent[]; freezes: Freeze[]; t: number; done: boolean
  span: { start: number; end: number }; playing: boolean
  presets: PresetInfo[]; scKey: string; onScheme: (k: string) => void; busy: boolean; isHole: boolean
  covered: boolean; split?: boolean
  onPlay: () => void; onSkip: () => void; phase: string
  mark?: number | null; gone?: number | null; aside?: boolean; intro?: boolean; overlay?: ReactNode
  narrow?: boolean // шаг «Клиент»: сцена рядом с экраном клиента, кадр как на телефоне (вид спереди)
  hideMobile?: boolean // шаг «Клиент» на телефоне: вместо сцены экран клиента, сцена остаётся смонтированной
  off?: boolean // v20-fix: шаг «Клиент» на любой ширине: сцены нет (бриф), 3D остаётся смонтированной и не пересоздаётся
}) {
  const { sc, log, freezes, t, done } = props
  const { t: tr } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ W: 900, H: 600 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const compact = size.W < 520 || (!!props.narrow && size.W < 760)

  return (
    <section className={`scene relative isolate flex min-h-0 flex-1 flex-col text-ink ${props.split ? 'lg:min-h-[380px]' : ''} ${props.hideMobile ? 'max-lg:hidden' : ''} ${props.off ? '!hidden' : ''}`} aria-label={tr.scene.aria}>
      <div className={`flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5 lg:px-6 ${props.intro ? 'hidden' : ''}`}>
        <SchemeSelect presets={props.presets} value={props.scKey} onChange={props.onScheme} disabled={props.busy} />
        <Controls phase={props.phase} busy={props.busy} onPlay={props.onPlay} onSkip={props.onSkip} />
        <span className="tabular-nums text-[28px] font-semibold leading-none tracking-tight" aria-label={tr.scene.clockAria(clock(t))}>{clock(t)}</span>
      </div>

      <div ref={box} className="relative flex-1 overflow-hidden max-lg:aspect-[4/3] max-lg:min-h-[240px] lg:min-h-0">
        {hasWebGL ? (
          <GLBoundary fallback={<NoGL />}>
            <Suspense fallback={<p className="absolute inset-0 grid place-items-center text-[16px] text-ink-3">{tr.scene.building}</p>}>
              <Scene3D sc={sc} log={log} freezes={freezes} t={t} done={done} playing={props.playing} isHole={props.isHole}
                covered={props.covered} compact={compact} mark={props.mark} gone={props.gone} aside={props.aside} />
            </Suspense>
          </GLBoundary>
        ) : <NoGL />}
      </div>

      {props.overlay}
    </section>
  )
}

// Без WebGL сцены нет: говорим прямо, что делать; числа в панели считаются как обычно
function NoGL() {
  const { t } = useLang()
  return (
    <div className="absolute inset-0 grid place-items-center px-6 text-center" role="alert">
      <div className="max-w-[440px]">
        <p className="text-[18px] font-medium">{t.scene.noGl}</p>
        <p className="mt-2 text-[16px] text-ink-2">{t.scene.noGlText}</p>
      </div>
    </div>
  )
}

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// Пуск, пауза и «в конец» рядом с часами; до запуска кнопок нет, запуск делает главная кнопка шага
function Controls({ phase, busy, onPlay, onSkip }: { phase: string; busy: boolean; onPlay: () => void; onSkip: () => void }) {
  const { t } = useLang()
  if (phase === 'idle') return <span className="ml-auto" />
  const label = phase === 'playing' ? t.scene.pause : phase === 'paused' ? t.scene.resume : t.scene.replay
  return (
    <span className="ml-auto flex items-center gap-2">
      <button className="ctl ctl-scene !h-10 !px-4 !text-[15px]" onClick={onPlay} disabled={busy} aria-keyshortcuts="Space">
        {phase === 'playing' ? <Pause size={16} strokeWidth={1.75} /> : phase === 'done' ? <RotateCcw size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
        {label}
      </button>
      {(phase === 'playing' || phase === 'paused') && (
        <button className="ctl ctl-scene !h-10 !px-4 !text-[15px]" onClick={onSkip} disabled={busy} aria-keyshortcuts="End">
          <SkipForward size={16} strokeWidth={1.75} />{t.scene.toEnd}
        </button>
      )}
    </span>
  )
}

function SchemeSelect({ presets, value, onChange, disabled }: { presets: PresetInfo[]; value: string; onChange: (k: string) => void; disabled: boolean }) {
  const { t } = useLang()
  return (
    <Select.Root items={presets.map((p) => ({ value: p.key, label: p.title }))} value={value}
      onValueChange={(v) => v && onChange(v as string)} disabled={disabled}>
      <Select.Trigger aria-label={t.scene.scheme}
        className="ctl ctl-scene max-w-full min-w-0 !justify-between !font-medium data-[disabled]:opacity-45 sm:min-w-[340px]">
        <span className="min-w-0 flex-1 text-left leading-tight">
          <span className="block whitespace-nowrap text-[13px] font-medium text-ink-3" data-library>{t.scene.library(presets.length)}</span>
          <Select.Value className="block truncate text-[15px] font-semibold" />
        </span>
        <Select.Icon className="shrink-0"><ChevronDown size={18} strokeWidth={1.5} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-40">
          <Select.Popup className="min-w-[var(--anchor-width)] rounded-2xl bg-surface p-1 text-ink shadow-[0_1px_2px_rgba(14,14,17,0.06),0_18px_40px_-16px_rgba(14,14,17,0.3)] outline-none
            origin-[var(--transform-origin)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
            {presets.map((p) => (
              <Select.Item key={p.key} value={p.key}
                className="flex min-h-11 cursor-default items-center gap-3 rounded-md px-3 text-[16px] outline-none select-none data-[highlighted]:bg-surface-2">
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
