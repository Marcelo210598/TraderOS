import type { Metadata } from "next"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { CarteiraClient } from "@/components/carteira/carteira-client"

export const metadata: Metadata = { title: "Carteira" }

interface RawTrade {
  id: string
  date: Date
  instrument: string
  direction: string
  pnl: unknown
  result: string
  accountId: string | null
  accountLabel: string
  source: string
}

// ── Taxonomia por TIPO de conta (a jornada Apex) ─────────────────────
// A Carteira agrupa tudo do journal nesses 3 baldes, na ordem da jornada.
type Bucket = "EVAL" | "PA" | "TEST"
const BUCKETS: { id: Bucket; name: string; color: string }[] = [
  { id: "EVAL", name: "Avaliação", color: "#F59E0B" }, // âmbar — em progresso
  { id: "PA",   name: "Aprovada",  color: "#10B981" }, // verde — funded
  { id: "TEST", name: "Teste",     color: "#64748B" }, // neutro — não conta
]

function bucketOf(label: string): Bucket {
  if (label === "TEST") return "TEST"
  if (label?.toUpperCase().startsWith("PA")) return "PA"
  return "EVAL" // EVAL e qualquer label desconhecido caem em Avaliação
}

// Enquanto o MT5 está fora de cena, ignoramos tudo que veio dele.
// Pra religar: basta remover esse filtro (dados continuam no banco).
const HIDDEN_SOURCES = new Set(["MT5"])

export default async function CarteiraPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const userId = session.user.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allAccountsRaw = await (prisma as any).tradingAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  })
  // Fora tudo que é MT5 (some da Carteira sem apagar do banco)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visibleAccounts = allAccountsRaw.filter((a: any) => !HIDDEN_SOURCES.has(a.source))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountsRaw = visibleAccounts.filter((a: any) => !a.isArchived)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archivedRaw = visibleAccounts.filter((a: any) => a.isArchived)

  const tradesAll = (await prisma.trade.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { id: true, date: true, instrument: true, direction: true, pnl: true, result: true, accountId: true, accountLabel: true, source: true },
  })) as unknown as RawTrade[]
  // Trades do MT5 também ficam de fora
  const trades = tradesAll.filter((t) => !HIDDEN_SOURCES.has(t.source))

  // Depósitos/saques (Fase 2 — extrato completo)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txns = (await (prisma as any).balanceTransaction.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { id: true, date: true, type: true, amount: true, accountId: true },
  })) as { id: string; date: Date; type: string; amount: unknown; accountId: string }[]

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // Só trades de contas ATIVAS (e não-MT5) entram no consolidado/curva/histórico
  const activeIds = new Set<string>(accountsRaw.map((a: Record<string, unknown>) => a.id as string))
  const activeTrades = trades.filter((t) => t.accountId != null && activeIds.has(t.accountId))

  // ── Passo 1: agrega por conta (base do cálculo de saldo) ───────────
  const perAccount = accountsRaw.map((a: Record<string, unknown>) => {
    const accTrades = trades.filter((t) => t.accountId === a.id)
    const totalPnl = accTrades.reduce((s, t) => s + Number(t.pnl), 0)
    const monthPnl = accTrades.filter((t) => new Date(t.date) >= monthStart).reduce((s, t) => s + Number(t.pnl), 0)
    const wins = accTrades.filter((t) => t.result === "WIN").length
    const losses = accTrades.filter((t) => t.result === "LOSS").length
    const txnSum = txns.filter((t) => t.accountId === a.id).reduce((s, t) => s + Number(t.amount), 0)
    const initial = Number(a.initialBalance ?? 0)
    const realBalance = a.balance != null ? Number(a.balance) : null
    const balance = realBalance ?? initial + totalPnl + txnSum
    return {
      id: a.id as string,
      name: a.name as string,
      source: a.source as string,
      label: a.label as string,
      bucket: bucketOf(a.label as string),
      currency: (a.currency as string) ?? "USD",
      initialBalance: initial,
      hasRealBalance: realBalance != null,
      balance,
      totalPnl,
      monthPnl,
      tradeCount: accTrades.length,
      wins,
      losses,
    }
  }) as {
    id: string; name: string; source: string; label: string; bucket: Bucket; currency: string
    initialBalance: number; hasRealBalance: boolean; balance: number
    totalPnl: number; monthPnl: number; tradeCount: number; wins: number; losses: number
  }[]

  // Mapa conta → bucket (usado no histórico e nas séries por tipo)
  const bucketByAccount = new Map<string, Bucket>(perAccount.map((a) => [a.id, a.bucket]))

  // ── Passo 2: consolida por TIPO (3 grupos) ─────────────────────────
  const groups = BUCKETS.map(({ id, name, color }) => {
    const accts = perAccount.filter((a) => a.bucket === id)
    const balance = accts.reduce((s, a) => s + a.balance, 0)
    const totalPnl = accts.reduce((s, a) => s + a.totalPnl, 0)
    const monthPnl = accts.reduce((s, a) => s + a.monthPnl, 0)
    const initialBalance = accts.reduce((s, a) => s + a.initialBalance, 0)
    const tradeCount = accts.reduce((s, a) => s + a.tradeCount, 0)
    const wins = accts.reduce((s, a) => s + a.wins, 0)
    const losses = accts.reduce((s, a) => s + a.losses, 0)
    const closed = wins + losses
    return {
      id, name, color,
      balance: round2(balance),
      totalPnl: round2(totalPnl),
      monthPnl: round2(monthPnl),
      initialBalance,
      tradeCount,
      winRate: closed > 0 ? Math.round((wins / closed) * 100) : 0,
      accountsCount: accts.length,
      hasRealBalance: accts.length > 0 && accts.every((a) => a.hasRealBalance),
    }
  }).filter((g) => g.accountsCount > 0) // só mostra tipos que têm conta de verdade

  // ── Consolidado ───────────────────────────────────────────────────
  const totalBalance = groups.reduce((s, g) => s + g.balance, 0)
  const totalPnl = groups.reduce((s, g) => s + g.totalPnl, 0)
  const monthPnl = groups.reduce((s, g) => s + g.monthPnl, 0)
  const totalInitial = perAccount.reduce((s, a) => s + a.initialBalance, 0)
  const balanceMonthAgo = totalBalance - monthPnl
  const monthPct = balanceMonthAgo !== 0 ? (monthPnl / Math.abs(balanceMonthAgo)) * 100 : 0

  // ── Equity curve (consolidada + uma linha por TIPO) ───────────────
  function buildSeries(initial: number, accTrades: RawTrade[]) {
    let running = initial
    const pts: { t: number; v: number }[] = [{ t: accTrades[0] ? new Date(accTrades[0].date).getTime() - 1 : now.getTime(), v: round2(running) }]
    for (const t of accTrades) {
      running += Number(t.pnl)
      pts.push({ t: new Date(t.date).getTime(), v: round2(running) })
    }
    return pts
  }
  const consolidatedSeries = buildSeries(totalInitial, activeTrades)
  const groupSeries = groups.map((g) => {
    const initial = perAccount.filter((a) => a.bucket === g.id).reduce((s, a) => s + a.initialBalance, 0)
    const gTrades = activeTrades.filter((t) => t.accountId != null && bucketByAccount.get(t.accountId) === g.id)
    return { id: g.id, name: g.name, color: g.color, points: buildSeries(initial, gTrades) }
  })

  // ── Histórico (últimos 60 lançamentos) ────────────────────────────
  const groupMeta = new Map<Bucket, { name: string; color: string }>(BUCKETS.map((b) => [b.id, { name: b.name, color: b.color }]))
  const tradeItems = activeTrades.map((t) => {
    const b = (t.accountId && bucketByAccount.get(t.accountId)) || bucketOf(t.accountLabel)
    const meta = groupMeta.get(b)!
    return {
      kind: "TRADE" as const,
      id: t.id,
      t: new Date(t.date).getTime(),
      date: new Date(t.date).toISOString(),
      instrument: t.instrument,
      direction: t.direction,
      amount: Number(t.pnl),
      group: b as string,
      accountName: meta.name,
      accountColor: meta.color,
    }
  })
  const txnItems = txns
    .filter((t) => t.accountId != null && activeIds.has(t.accountId))
    .map((t) => {
      const b = bucketByAccount.get(t.accountId) ?? "EVAL"
      const meta = groupMeta.get(b)!
      return {
        kind: t.type as "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT",
        id: t.id,
        t: new Date(t.date).getTime(),
        date: new Date(t.date).toISOString(),
        instrument: "",
        direction: "",
        amount: Number(t.amount),
        group: b as string,
        accountName: meta.name,
        accountColor: meta.color,
      }
    })
  const history = [...tradeItems, ...txnItems].sort((a, b) => b.t - a.t).slice(0, 60)

  // ── Contas individuais (pra editar nome/saldo/arquivar) ────────────
  const manageAccounts = perAccount.map((a) => ({
    id: a.id,
    name: a.name,
    source: a.source,
    label: a.label,
    currency: a.currency,
    initialBalance: a.initialBalance,
    hasRealBalance: a.hasRealBalance,
    balance: round2(a.balance),
    tradeCount: a.tradeCount,
  }))

  // ── Contas arquivadas (resumo leve, pra restaurar) ────────────────
  const archived = archivedRaw.map((a: Record<string, unknown>) => {
    const accTrades = trades.filter((t) => t.accountId === a.id)
    return {
      id: a.id as string,
      name: a.name as string,
      source: a.source as string,
      tradeCount: accTrades.length,
    }
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Carteira"
        subtitle="Saldos e evolução por tipo de conta"
        userName={session.user.name}
        userEmail={session.user.email}
        userImage={session.user.image}
        userPlan={(session.user as { plan?: string }).plan ?? "FREE"}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <CarteiraClient
            consolidated={{ totalBalance: round2(totalBalance), totalPnl: round2(totalPnl), monthPnl: round2(monthPnl), monthPct: round2(monthPct), groupsCount: groups.length, tradesCount: activeTrades.length }}
            groups={groups}
            consolidatedSeries={consolidatedSeries}
            groupSeries={groupSeries}
            history={history}
            manageAccounts={manageAccounts}
            archived={archived}
          />
        </div>
      </div>
    </div>
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
