import { useEffect, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Slider } from '@base-ui/react/slider'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { X } from 'lucide-react'
import type { Bank, Calib, CalibField } from './data'
import { plainKzt } from './format'

// Калибровка двойника под банк: диалог справа, агрегаты вместо данных клиентов
export default function Calibration({ open, bank, live, onApply, onClose }: {
  open: boolean; bank: Bank; live: boolean
  onApply: (c: Calib) => Promise<void>; onClose: () => void
}) {
  const [vals, setVals] = useState<Calib>(bank.calib)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setVals(bank.calib); setErr(null); setBusy(false) } }, [open, bank])

  const presetOf = (c: Calib) => bank.calib_presets.find((p) => bank.calib_fields.every((f) => p.values[f.key] === c[f.key]))
  const match = presetOf(vals)
  const same = bank.calib_fields.every((f) => vals[f.key] === bank.calib[f.key])
  const badLimits = vals.daily_limit < vals.amount_limit
  const canApply = !busy && !same && !badLimits && (live || !!match)

  const apply = async () => {
    setBusy(true); setErr(null)
    try { await onApply(vals) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[rgba(6,5,18,0.55)] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-bronze/40 bg-paper shadow-[-12px_0_40px_-12px_rgba(6,5,18,0.45)] outline-none
          transition-transform duration-200 ease-[var(--ease-out)] data-[starting-style]:translate-x-8 data-[ending-style]:translate-x-8">
          <div className="flex items-start justify-between gap-4 border-b border-hair px-6 py-5">
            <div>
              <Dialog.Title className="text-[22px] font-semibold tracking-tight text-deep">Настроить двойник под банк</Dialog.Title>
              <Dialog.Description className="mt-1 text-[16px] text-ink-2">Банк даёт агрегаты, данные клиентов не нужны.</Dialog.Description>
            </div>
            <Dialog.Close className="ctl ctl-quiet !w-11 !px-0" aria-label="Закрыть" disabled={busy}><X size={20} strokeWidth={1.5} /></Dialog.Close>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <section>
              <h3 className="text-[18px] font-semibold">Готовый профиль</h3>
              <ToggleGroup value={match ? [match.id] : []} onValueChange={(v) => { const p = bank.calib_presets.find((x) => x.id === v[0]); if (p) setVals(p.values) }}
                disabled={busy} aria-label="Готовые профили банка" className="mt-2 flex rounded-lg bg-page p-1">
                {bank.calib_presets.map((p) => (
                  <Toggle key={p.id} value={p.id} title={p.note}
                    className="h-10 flex-1 rounded-md px-2 text-[16px] font-semibold text-ink-3 transition-[background-color,color,box-shadow] duration-[120ms] hover:text-ink data-[pressed]:bg-paper data-[pressed]:text-deep data-[pressed]:shadow-[0_1px_2px_rgba(16,12,40,0.12),0_0_0_1px_rgba(16,12,40,0.08)]">
                    {p.name}
                  </Toggle>
                ))}
              </ToggleGroup>
              <p className="mt-2 text-[16px] text-ink-3">{match ? match.note : 'Свой профиль, считает сервер симулятора'}</p>
            </section>

            <section>
              <h3 className="text-[18px] font-semibold">Свой профиль</h3>
              {!live && <p className="mt-1 text-[16px] text-ink-2">Сервер не отвечает: ползунки выключены, готовые профили работают.</p>}
              <div className="mt-3 space-y-5">
                {bank.calib_fields.map((f) => (
                  <Field key={f.key} f={f} v={vals[f.key]} disabled={!live || busy}
                    set={(v) => setVals((o) => ({ ...o, [f.key]: v }))} />
                ))}
              </div>
              {badLimits && <p className="mt-3 text-[16px] text-leak" role="alert">Суточный лимит меньше лимита одного перевода.</p>}
            </section>
            {err && <p className="text-[16px] text-leak" role="alert">{err}</p>}
          </div>

          <div className="border-t border-hair px-6 py-4">
            <p className="mb-3 flex items-center gap-2 text-[16px] text-ink-2"><span className="h-2 w-2 shrink-0 rotate-45 border border-bronze" aria-hidden />Синтетический банк, параметры - гипотезы</p>
            <div className="flex gap-2">
              <button className="ctl ctl-main flex-1" onClick={apply} disabled={!canApply}>{busy ? 'Пересобираем двойник...' : 'Пересчитать двойник'}</button>
              <button className="ctl ctl-quiet" onClick={() => setVals(bank.calib)} disabled={busy || same}>Сбросить</button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function show(f: CalibField, v: number) {
  if (f.unit === '%') return `${Math.round(v * 100)}%`
  if (f.unit === '₸') return plainKzt(v)
  if (f.unit) return `${v} ${f.unit}`
  return v.toLocaleString('ru-RU')
}

function Field({ f, v, set, disabled }: { f: CalibField; v: number; set: (v: number) => void; disabled: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[16px]">
        <span id={`l-${f.key}`}>{f.title}</span>
        <span className="font-semibold">{show(f, v)}</span>
      </div>
      <Slider.Root value={v} min={f.min} max={f.max} step={f.step} disabled={disabled} aria-labelledby={`l-${f.key}`}
        onValueChange={(x) => set(f.unit === '%' ? Math.round(Number(x) * 100) / 100 : Number(x))} className="mt-2 data-[disabled]:opacity-40">
        <Slider.Control className="flex h-6 w-full cursor-pointer touch-none items-center">
          <Slider.Track className="h-1.5 w-full rounded-full bg-hair">
            <Slider.Indicator className="rounded-full bg-stop" />
            <Slider.Thumb aria-label={f.title} className="h-5 w-5 rounded-full border-2 border-stop bg-paper shadow-[0_1px_3px_rgba(16,12,40,0.25)] focus-visible:outline-[3px] focus-visible:outline-stop-scene" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  )
}
