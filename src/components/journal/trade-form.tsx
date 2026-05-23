"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Loader2, Calculator, TrendingUp, TrendingDown, ImagePlus } from "lucide-react"
import type { Setup, Trade } from "@/lib/types"
import { ScreenshotUploader, type UploadedScreenshot } from "./screenshot-uploader"

const INSTRUMENTS = ["NQ", "ES", "YM", "RTY", "CL", "GC", "SI", "ZB", "6E", "MNQ", "MES"]
const SESSION_TYPES = [
  { value: "AM", label: "Manhã (AM)" },
  { value: "PM", label: "Tarde (PM)" },
  { value: "OVERNIGHT", label: "Overnight" },
]
const POINT_VALUES: Record<string, number> = {
  NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, RTY: 50,
  CL: 1000, GC: 100, SI: 5000, ZB: 1000, "6E": 125000,
}

interface TradeFormProps {
  setups: Setup[]
  initial?: Partial<Trade>
  onSuccess?: (trade: Trade) => void
}

export function TradeForm({ setups, initial, onSuccess }: TradeFormProps) {
  const router = useRouter()
  const isEdit = !!initial?.id
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [screenshots, setScreenshots] = useState<UploadedScreenshot[]>([])

  const [form, setForm] = useState({
    date: initial?.date ? new Date(initial.date).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    instrument: initial?.instrument ?? "NQ",
    direction: initial?.direction ?? "LONG",
    entryPrice: initial?.entryPrice?.toString() ?? "",
    exitPrice: initial?.exitPrice?.toString() ?? "",
    quantity: initial?.quantity?.toString() ?? "1",
    commission: initial?.commission?.toString() ?? "0",
    result: initial?.result ?? "WIN",
    sessionType: initial?.sessionType ?? "AM",
    setupId: initial?.setupId ?? "",
    notes: initial?.notes ?? "",
    tags: initial?.tags?.map((t) => t.name).join(", ") ?? "",
    emotional: "5",
  })

  // Calcular PnL automaticamente
  const pointValue = POINT_VALUES[form.instrument] ?? 20
  const entry = parseFloat(form.entryPrice) || 0
  const exit = parseFloat(form.exitPrice) || 0
  const qty = parseInt(form.quantity) || 1
  const commission = parseFloat(form.commission) || 0

  let pnlPoints = 0
  if (entry && exit) {
    pnlPoints = form.direction === "LONG" ? exit - entry : entry - exit
  }
  const pnlDollars = pnlPoints * pointValue * qty - commission

  // Auto-detectar resultado
  useEffect(() => {
    if (pnlDollars > 0) setForm((f) => ({ ...f, result: "WIN" }))
    else if (pnlDollars < 0) setForm((f) => ({ ...f, result: "LOSS" }))
    else if (entry && exit) setForm((f) => ({ ...f, result: "BREAKEVEN" }))
  }, [pnlDollars, entry, exit])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const payload = {
      date: new Date(form.date).toISOString(),
      instrument: form.instrument,
      direction: form.direction,
      entryPrice: parseFloat(form.entryPrice),
      exitPrice: parseFloat(form.exitPrice),
      quantity: parseInt(form.quantity),
      pnl: parseFloat(pnlDollars.toFixed(2)),
      pnlPoints: parseFloat(pnlPoints.toFixed(4)),
      commission: parseFloat(form.commission) || 0,
      result: form.result,
      sessionType: form.sessionType,
      setupId: form.setupId || null,
      notes: form.notes || null,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      screenshots: screenshots.map((s) => ({ url: s.url, key: s.key, label: s.label ?? null })),
    }

    const url = isEdit ? `/api/trades/${initial.id}` : "/api/trades"
    const method = isEdit ? "PATCH" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error?.toString() ?? "Erro ao salvar trade")
      setLoading(false)
      return
    }

    const trade = await res.json()
    if (onSuccess) onSuccess(trade)
    else router.push("/journal")
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Linha 1: Data + Sessão */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Data e Hora">
          <input
            type="datetime-local"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Sessão">
          <select value={form.sessionType} onChange={(e) => set("sessionType", e.target.value)} className={inputCls}>
            {SESSION_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Linha 2: Ativo + Direção */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Ativo">
          <select value={form.instrument} onChange={(e) => set("instrument", e.target.value)} className={inputCls}>
            {INSTRUMENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Direção">
          <div className="flex gap-2">
            {(["LONG", "SHORT"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => set("direction", d)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-all",
                  form.direction === d
                    ? d === "LONG"
                      ? "bg-profit/15 border-profit/40 text-profit"
                      : "bg-loss/15 border-loss/40 text-loss"
                    : "bg-input border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {d === "LONG" ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {d}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* Linha 3: Entry + Exit + Quantidade */}
      <div className="grid grid-cols-3 gap-4">
        <Field label="Entrada">
          <input
            type="number"
            step="0.25"
            placeholder="21000.00"
            value={form.entryPrice}
            onChange={(e) => set("entryPrice", e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Saída">
          <input
            type="number"
            step="0.25"
            placeholder="21050.00"
            value={form.exitPrice}
            onChange={(e) => set("exitPrice", e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Contratos">
          <input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            required
            className={inputCls}
          />
        </Field>
      </div>

      {/* PnL calculado */}
      {entry > 0 && exit > 0 && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-center justify-between",
          pnlDollars > 0 ? "bg-profit/5 border-profit/20" : pnlDollars < 0 ? "bg-loss/5 border-loss/20" : "bg-muted border-border"
        )}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calculator className="w-4 h-4" />
            <span>PnL calculado</span>
          </div>
          <div className="text-right">
            <p className={cn("text-xl font-bold font-mono", pnlDollars > 0 ? "text-profit" : pnlDollars < 0 ? "text-loss" : "text-muted-foreground")}>
              {pnlDollars >= 0 ? "+" : ""}${pnlDollars.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              {pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(2)} pts × {qty} contrato{qty > 1 ? "s" : ""}
            </p>
          </div>
        </div>
      )}

      {/* Linha 4: Comissão + Resultado + Setup */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Comissão ($)">
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.commission}
            onChange={(e) => set("commission", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Resultado">
          <select value={form.result} onChange={(e) => set("result", e.target.value)} className={inputCls}>
            <option value="WIN">✅ Win</option>
            <option value="LOSS">❌ Loss</option>
            <option value="BREAKEVEN">➖ Breakeven</option>
          </select>
        </Field>
        <Field label="Setup usado">
          <select value={form.setupId} onChange={(e) => set("setupId", e.target.value)} className={inputCls}>
            <option value="">Sem setup</option>
            {setups.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Tags */}
      <Field label="Tags (separadas por vírgula)">
        <input
          type="text"
          placeholder="ICT, OB, FVG, revenge trade..."
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
          className={inputCls}
        />
      </Field>

      {/* Notas */}
      <Field label="Notas">
        <textarea
          rows={4}
          placeholder="O que aconteceu neste trade? O que aprendeu?"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className={cn(inputCls, "resize-none")}
        />
      </Field>

      {/* Screenshots */}
      <Field label={<span className="flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5" />Screenshots (opcional)</span>}>
        <ScreenshotUploader value={screenshots} onChange={setScreenshots} />
      </Field>

      {error && (
        <p className="text-sm text-loss bg-loss/10 border border-loss/20 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Ações */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? "Salvar alterações" : "Registrar trade"}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
