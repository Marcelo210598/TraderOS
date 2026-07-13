"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Loader2, Calculator, TrendingUp, TrendingDown, ImagePlus } from "lucide-react"
import type { Setup, Trade } from "@/lib/types"
import { ACCOUNT_OPTIONS, getAccountOption } from "@/lib/accounts"
import { ScreenshotUploader, type UploadedScreenshot } from "./screenshot-uploader"
import { TagInput } from "./tag-input"
import { openUpgradeModal } from "@/lib/upgrade"

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

interface AccountPick {
  id: string
  name: string
  label: string
  source: string
}

interface TradeFormProps {
  setups: Setup[]
  initial?: Partial<Trade>
  accounts?: AccountPick[]
  onSuccess?: (trade: Trade) => void
}

export function TradeForm({ setups, initial, accounts = [], onSuccess }: TradeFormProps) {
  const router = useRouter()
  const isEdit = !!initial?.id
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [screenshots, setScreenshots] = useState<UploadedScreenshot[]>(
    initial?.screenshots?.map((s) => ({
      url: s.url,
      key: s.key ?? s.id,
      name: s.label ?? "screenshot",
      label: s.label ?? undefined,
    })) ?? []
  )
  const [tags, setTags] = useState<string[]>(initial?.tags?.map((t) => t.name) ?? [])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])

  const [form, setForm] = useState({
    date: initial?.date ? new Date(initial.date).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    instrument: initial?.instrument ?? "NQ",
    direction: initial?.direction ?? "LONG",
    entryPrice: initial?.entryPrice?.toString() ?? "",
    exitPrice: initial?.exitPrice?.toString() ?? "",
    quantity: initial?.quantity?.toString() ?? "1",
    commission: initial?.commission?.toString() ?? "0",
    mfe: initial?.mfe?.toString() ?? "",
    mae: initial?.mae?.toString() ?? "",
    result: initial?.result ?? "WIN",
    sessionType: initial?.sessionType ?? "AM",
    accountLabel: initial?.accountLabel ?? "EVAL",
    setupId: initial?.setupId ?? "",
    notes: initial?.notes ?? "",
    emotional: "5",
  })

  // Conta onde o trade foi feito. Se há contas detectadas, escolhe uma delas
  // (a integração já sabe o tipo). Sem contas, cai no seletor de tipo (fallback).
  const hasAccounts = accounts.length > 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialAccountId = (initial as any)?.accountId as string | undefined
  const [accountId, setAccountId] = useState<string>(initialAccountId ?? accounts[0]?.id ?? "")

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

  // Carregar sugestões de tags do usuário
  useEffect(() => {
    fetch("/api/trades/tags")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTagSuggestions(data) })
      .catch(() => {})
  }, [])

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
      // Conta escolhida (integração já sabe o tipo) ou fallback por tipo
      ...(hasAccounts && accountId ? { accountId } : { accountLabel: form.accountLabel }),
      setupId: form.setupId || null,
      notes: form.notes || null,
      mfe: form.mfe ? parseFloat(form.mfe) : null,
      mae: form.mae ? parseFloat(form.mae) : null,
      tags,
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
      // Limite de plano atingido → abre modal de upgrade
      if (res.status === 403) {
        openUpgradeModal({
          reason: data.error?.toString(),
          suggestedPlan: data.suggestedPlan ?? "PRO",
        })
      }
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
      {/* Conta */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Conta</p>
        {hasAccounts ? (
          <>
            <div className="flex flex-wrap gap-2">
              {accounts.map((acc) => {
                const t = getAccountOption(acc.label)
                const active = accountId === acc.id
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setAccountId(acc.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                      active ? "border-teal bg-teal/5 text-foreground" : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                    )}
                  >
                    {acc.name}
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono", t.bg, t.border, t.color)}>{t.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-1.5">Escolha a conta onde a operação foi feita — o tipo (Teste/Avaliação/Aprovada) vem da própria conta.</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set("accountLabel", opt.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all",
                    form.accountLabel === opt.value
                      ? cn(opt.bg, opt.border, opt.color)
                      : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-1.5">Conecte o NinjaTrader pra classificar automático. Por enquanto, escolha o tipo.</p>
          </>
        )}
      </div>

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

      {/* MFE / MAE */}
      <div className="grid grid-cols-2 gap-4">
        <Field label={<span title="Maximum Favorable Excursion — máximo que o preço foi a seu favor (em pontos)">MFE <span className="normal-case font-normal opacity-60">(pts) — opcional</span></span>}>
          <input
            type="number"
            step="0.25"
            min="0"
            placeholder="ex: 45.00"
            value={form.mfe}
            onChange={(e) => set("mfe", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label={<span title="Maximum Adverse Excursion — máximo que o preço foi contra você (em pontos)">MAE <span className="normal-case font-normal opacity-60">(pts) — opcional</span></span>}>
          <input
            type="number"
            step="0.25"
            min="0"
            placeholder="ex: 12.00"
            value={form.mae}
            onChange={(e) => set("mae", e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

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
      <Field label="Tags">
        <TagInput
          value={tags}
          onChange={setTags}
          suggestions={tagSuggestions}
          placeholder="ICT, OB, FVG, revenge-trade... (Enter ou vírgula)"
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
