export const ACCOUNTS = {
  PA25K:  { label: "PA 25K",  balance: 25000,  drawdown: 1500,  target: 1500,  minDays: 10, maxContracts: 5  },
  PA50K:  { label: "PA 50K",  balance: 50000,  drawdown: 2500,  target: 3000,  minDays: 10, maxContracts: 10 },
  PA75K:  { label: "PA 75K",  balance: 75000,  drawdown: 2750,  target: 4500,  minDays: 10, maxContracts: 12 },
  PA100K: { label: "PA 100K", balance: 100000, drawdown: 3000,  target: 6000,  minDays: 10, maxContracts: 14 },
  PA150K: { label: "PA 150K", balance: 150000, drawdown: 5000,  target: 9000,  minDays: 15, maxContracts: 17 },
  PA250K: { label: "PA 250K", balance: 250000, drawdown: 7500,  target: 15000, minDays: 20, maxContracts: 20 },
} as const

export type AccountKey = keyof typeof ACCOUNTS

export interface AccountConfig {
  label: string
  balance: number
  drawdown: number
  target: number
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
