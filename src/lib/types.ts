export type TradeResult = "WIN" | "LOSS" | "BREAKEVEN"
export type Direction = "LONG" | "SHORT"
export type SessionType = "AM" | "PM" | "OVERNIGHT"

export interface TradeTag {
  id: string
  name: string
}

export interface SetupRef {
  id: string
  name: string
}

export interface Screenshot {
  id: string
  url: string
  label: string | null
}

export interface Trade {
  id: string
  date: string
  instrument: string
  direction: Direction
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPoints: number
  commission: number
  result: TradeResult
  sessionType: SessionType
  setupId: string | null
  setup: SetupRef | null
  notes: string | null
  aiAnalysis: string | null
  tags: TradeTag[]
  screenshots: Screenshot[]
  createdAt: string
}

export interface Setup {
  id: string
  name: string
  description: string | null
  rules: string | null
  tags: string[]
  isActive: boolean
  stats: {
    total: number
    wins: number
    losses: number
    winRate: number
    totalPnl: number
  }
  createdAt: string
}

export interface PaginatedTrades {
  trades: Trade[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface CheckIn {
  id: string
  type: "PRE" | "POST"
  sessionDate: string
  emotional: number
  energy: number
  focus: number
  stress: number
  confidence: number
  notes: string | null
  createdAt: string
}
