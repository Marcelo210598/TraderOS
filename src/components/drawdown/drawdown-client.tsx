"use client"

import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import type { PlanKey } from "@/lib/plans"
import type { TradeInput } from "@/lib/drawdown-engine"
import { RealTab, type DrawdownAccount } from "./real-tab"
import { SimulateTab } from "./simulate-tab"

interface Props {
  plan: PlanKey
  tab: "real" | "simular"
  accounts: DrawdownAccount[]
  selectedId: string | null
  trades: TradeInput[]
}

export function DrawdownClient({ plan, tab, accounts, selectedId, trades }: Props) {
  const router = useRouter()
  const tabs = [
    { id: "real", label: "Real" },
    { id: "simular", label: "Simular" },
  ] as const

  return (
    <div className="space-y-5">
      <div data-tour="drawdown-tabs" className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.replace(`/drawdown?tab=${t.id}`)}
            className={cn(
              "text-xs px-4 py-1.5 rounded-md font-medium transition-colors",
              tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "real" ? (
        <RealTab plan={plan} accounts={accounts} selectedId={selectedId} trades={trades} />
      ) : (
        <SimulateTab plan={plan} />
      )}
    </div>
  )
}
