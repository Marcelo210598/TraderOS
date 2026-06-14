// Contas Apex 2026 (EOD) — fonte: material oficial "CONTAS - APEX TRADER FUNDING" (Nômade Trader).
// drawdown = Perda Máxima | target = Meta de Aprovação | lucroMinDia = Lucro Mínimo por Dia
// gorduraSaque = saldo (safety net) acima do inicial necessário p/ sacar | maxSaques = saques por conta PA
export const ACCOUNTS = {
  PA25K:  { label: "PA 25K",  balance: 25000,  drawdown: 1000, target: 1500,  lucroMinDia: 100, gorduraSaque: 1600, maxSaques: 6, minDays: 10, maxContracts: 5  },
  PA50K:  { label: "PA 50K",  balance: 50000,  drawdown: 2000, target: 3000,  lucroMinDia: 250, gorduraSaque: 2600, maxSaques: 6, minDays: 10, maxContracts: 10 },
  PA100K: { label: "PA 100K", balance: 100000, drawdown: 3000, target: 6000,  lucroMinDia: 300, gorduraSaque: 3600, maxSaques: 6, minDays: 10, maxContracts: 14 },
  PA150K: { label: "PA 150K", balance: 150000, drawdown: 4000, target: 9000,  lucroMinDia: 350, gorduraSaque: 4600, maxSaques: 6, minDays: 15, maxContracts: 17 },
} as const

export type AccountKey = keyof typeof ACCOUNTS

export interface AccountConfig {
  label: string
  balance: number
  drawdown: number
  target: number
  lucroMinDia: number
  gorduraSaque: number
  maxSaques: number
  minDays: number
  maxContracts: number
}

export interface DayData {
  date: string
  pnl: number
}

export function simulate(account: AccountConfig, days: DayData[]) {
  let balance = account.balance
  let hwm = account.balance
  let floor = account.balance - account.drawdown
  let isLocked = false
  let blown = false

  for (const d of days) {
    balance += d.pnl
    if (balance > hwm) {
      hwm = balance
      if (hwm >= account.balance + account.target) {
        isLocked = true
        floor = account.balance
      } else if (!isLocked) {
        floor = hwm - account.drawdown
      }
    }
    if (balance <= floor) {
      blown = true
      break
    }
  }

  const safetyMargin = balance - floor
  const profitProgress = Math.min(((balance - account.balance) / account.target) * 100, 100)
  const pctToTarget = Math.max(0, account.target - (balance - account.balance))

  return { balance, floor, safetyMargin, isLocked, blown, profitProgress, pctToTarget }
}
