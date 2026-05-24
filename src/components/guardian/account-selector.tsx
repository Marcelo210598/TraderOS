"use client"

import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

const ACCOUNTS = [
  { key: "PA25K", label: "PA 25K" },
  { key: "PA50K", label: "PA 50K" },
  { key: "PA75K", label: "PA 75K" },
  { key: "PA100K", label: "PA 100K" },
  { key: "PA150K", label: "PA 150K" },
  { key: "PA250K", label: "PA 250K" },
]

interface Props {
  currentAccount: string
}

export function GuardianAccountSelector({ currentAccount }: Props) {
  const router = useRouter()

  return (
    <div className="flex flex-wrap gap-2">
      {ACCOUNTS.map((a) => (
        <button
          key={a.key}
          onClick={() => router.push(`/guardian?account=${a.key}`)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all",
            currentAccount === a.key
              ? "bg-teal/10 border-teal/40 text-teal"
              : "border-border text-muted-foreground hover:border-teal/30 hover:text-foreground"
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
