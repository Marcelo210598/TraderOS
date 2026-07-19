import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { PrintActions } from "./print-actions"
import { signedUsd } from "@/lib/utils"

interface Props {
  searchParams: Promise<Record<string, string>>
}

export default async function JournalPrintPage({ searchParams }: Props) {
  const session = await auth()
  const user = session!.user
  const sp = await searchParams

  const where = {
    userId: user.id,
    ...(sp.result && { result: sp.result as "WIN" | "LOSS" | "BREAKEVEN" }),
    ...(sp.instrument && { instrument: sp.instrument }),
    ...(sp.setupId && { setupId: sp.setupId }),
    ...(sp.tag && { tags: { some: { name: sp.tag } } }),
    ...((sp.from || sp.to) ? {
      date: {
        ...(sp.from && { gte: new Date(sp.from) }),
        ...(sp.to && { lte: new Date(sp.to + "T23:59:59") }),
      }
    } : {}),
  }

  const trades = await prisma.trade.findMany({
    where,
    include: {
      tags: true,
      setup: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  })

  const totalPnl = trades.reduce((a, t) => a + Number(t.pnl), 0)
  const wins = trades.filter((t) => t.result === "WIN").length
  const losses = trades.filter((t) => t.result === "LOSS").length
  const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0
  const avgPnl = trades.length > 0 ? totalPnl / trades.length : 0
  const grossWin = trades.filter((t) => t.result === "WIN").reduce((a, t) => a + Number(t.pnl), 0)
  const grossLoss = Math.abs(trades.filter((t) => t.result === "LOSS").reduce((a, t) => a + Number(t.pnl), 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0

  const activeFilters: string[] = []
  if (sp.result) activeFilters.push(sp.result)
  if (sp.instrument) activeFilters.push(sp.instrument)
  if (sp.tag) activeFilters.push(`tag: ${sp.tag}`)
  if (sp.from) activeFilters.push(`de ${sp.from}`)
  if (sp.to) activeFilters.push(`até ${sp.to}`)

  const now = new Date()

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 12mm 14mm; }
        @media print {
          html, body { background: white !important; color: black !important; }
          .print-hidden { display: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
        }
      `}</style>

      <PrintActions />

      <div className="bg-white text-gray-900 min-h-screen p-6 text-[11px]" id="print-content">

        {/* Cabeçalho */}
        <div className="flex items-start justify-between mb-5 pb-4 border-b-2 border-gray-900">
          <div>
            <h1 className="text-xl font-bold tracking-tight">MeuTrade</h1>
            <p className="text-gray-500 text-xs mt-0.5">Exportação do Journal de Trades</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p className="font-medium text-gray-900">{user.name}</p>
            <p>{user.email}</p>
            <p className="mt-1">Gerado em {format(now, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
            {activeFilters.length > 0 && (
              <p className="mt-0.5 text-gray-400">Filtros: {activeFilters.join(" · ")}</p>
            )}
          </div>
        </div>

        {/* Stats resumo */}
        <div className="grid grid-cols-5 gap-3 mb-5">
          {[
            { label: "Total de trades", value: String(trades.length) },
            { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? "#16a34a" : "#dc2626" },
            { label: "P&L Total", value: signedUsd(totalPnl, 2), color: totalPnl >= 0 ? "#16a34a" : "#dc2626" },
            { label: "P&L Médio", value: signedUsd(avgPnl, 2), color: avgPnl >= 0 ? "#16a34a" : "#dc2626" },
            { label: "Profit Factor", value: profitFactor >= 99 ? "∞" : profitFactor.toFixed(2), color: profitFactor >= 1.5 ? "#16a34a" : profitFactor >= 1 ? "#ca8a04" : "#dc2626" },
          ].map((s) => (
            <div key={s.label} className="border border-gray-200 rounded-lg p-3 text-center">
              <p className="text-gray-500 text-[10px]">{s.label}</p>
              <p className="text-base font-bold font-mono mt-0.5" style={{ color: s.color ?? "#111827" }}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Tabela de trades */}
        {trades.length === 0 ? (
          <p className="text-center text-gray-400 py-12">Nenhum trade encontrado com os filtros aplicados.</p>
        ) : (
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-gray-100">
                {["#", "Data", "Ativo", "Dir", "Conta", "Setup", "Entrada", "Saída", "Pts", "P&L", "Resultado", "Tags", "Notas"].map((h) => (
                  <th key={h} className="border border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, idx) => {
                const pnl = Number(t.pnl)
                const pts = Number(t.pnlPoints)
                const isWin = t.result === "WIN"
                const isLoss = t.result === "LOSS"
                return (
                  <tr key={t.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="border border-gray-200 px-2 py-1 text-gray-400 font-mono">{idx + 1}</td>
                    <td className="border border-gray-200 px-2 py-1 font-mono whitespace-nowrap">
                      {format(new Date(t.date), "dd/MM/yy HH:mm")}
                    </td>
                    <td className="border border-gray-200 px-2 py-1 font-mono font-semibold">{t.instrument}</td>
                    <td className="border border-gray-200 px-2 py-1 font-mono" style={{ color: t.direction === "LONG" ? "#16a34a" : "#dc2626" }}>
                      {t.direction}
                    </td>
                    <td className="border border-gray-200 px-2 py-1 font-mono">{(t as Record<string, unknown>).accountLabel as string ?? "PA"}</td>
                    <td className="border border-gray-200 px-2 py-1">{t.setup?.name ?? "—"}</td>
                    <td className="border border-gray-200 px-2 py-1 font-mono">{Number(t.entryPrice).toFixed(2)}</td>
                    <td className="border border-gray-200 px-2 py-1 font-mono">{Number(t.exitPrice).toFixed(2)}</td>
                    <td className="border border-gray-200 px-2 py-1 font-mono" style={{ color: pts >= 0 ? "#16a34a" : "#dc2626" }}>
                      {pts >= 0 ? "+" : ""}{pts.toFixed(2)}
                    </td>
                    <td className="border border-gray-200 px-2 py-1 font-mono font-semibold whitespace-nowrap" style={{ color: pnl >= 0 ? "#16a34a" : "#dc2626" }}>
                      {signedUsd(pnl, 2)}
                    </td>
                    <td className="border border-gray-200 px-2 py-1 font-semibold" style={{ color: isWin ? "#16a34a" : isLoss ? "#dc2626" : "#6b7280" }}>
                      {t.result}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">
                      {t.tags.map((tag) => tag.name).join(", ") || "—"}
                    </td>
                    <td className="border border-gray-200 px-2 py-1 text-gray-600 max-w-[180px]">
                      <span className="line-clamp-1">{t.notes ?? "—"}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-semibold">
                <td colSpan={9} className="border border-gray-200 px-2 py-1.5 text-right text-gray-600">
                  Total ({trades.length} trades · {wins}W / {losses}L)
                </td>
                <td className="border border-gray-200 px-2 py-1.5 font-mono font-bold" style={{ color: totalPnl >= 0 ? "#16a34a" : "#dc2626" }}>
                  {signedUsd(totalPnl, 2)}
                </td>
                <td colSpan={3} className="border border-gray-200 px-2 py-1.5 text-gray-500 text-[9px]">
                  Win Rate: {winRate}% · PF: {profitFactor >= 99 ? "∞" : profitFactor.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Rodapé */}
        <div className="mt-5 pt-3 border-t border-gray-200 flex items-center justify-between text-[9px] text-gray-400">
          <p>MeuTrade — trader-os-ashy.vercel.app</p>
          <p>{user.name} · {format(now, "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
        </div>
      </div>
    </>
  )
}
