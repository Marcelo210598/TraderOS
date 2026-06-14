"use client"

import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { ACCOUNTS as ACCOUNT_CONFIG, type AccountKey } from "@/lib/guardian"

// Deriva a lista das contas oficiais (fonte única em @/lib/guardian)
const ACCOUNTS = (Object.keys(ACCOUNT_CONFIG) as AccountKey[]).map((key) => ({
  key,
  label: ACCOUNT_CONFIG[key].label,
}))

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
