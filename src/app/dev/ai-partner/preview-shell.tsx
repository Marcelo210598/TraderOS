"use client"

import { useMemo, useState } from "react"
import { AiPartnerScreen } from "@/components/ai-partner/ai-partner-screen"
import { SCENARIOS, createFakeTransport, scenarioById } from "@/lib/ai-partner-ui/preview-scenarios"

export function PreviewShell() {
  const [id, setId] = useState(SCENARIOS[0].id)
  const [run, setRun] = useState(0)
  const transport = useMemo(() => createFakeTransport(scenarioById(id)), [id, run]) // eslint-disable-line react-hooks/exhaustive-deps -- `run` força um transporte novo (Reiniciar)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 text-sm">
        <strong className="text-foreground">AI Partner — prévia</strong>
        <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs text-gold">desenvolvimento · dados falsos</span>
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          Cenário
          <select value={id} onChange={(e) => setId(e.target.value)} className="min-h-9 rounded-md border border-input bg-background px-2 text-foreground">
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setRun((n) => n + 1)} className="min-h-9 rounded-md border border-border px-3 text-foreground hover:bg-muted">Reiniciar</button>
      </div>
      <AiPartnerScreen key={`${id}-${run}`} transport={transport} />
    </>
  )
}
