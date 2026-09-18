// Detecta o TIPO de conta pelo nome + conexao que a corretora (Apex/Rithmic) manda,
// ou pelo nome de conta que aparece numa grade/CSV exportado do NinjaTrader.
// O que importa é EM QUAL conta o trade rodou:
//   Sim101 / Demo / Playback / conexao "Simulated"  -> "TEST" (simulacao)
//   APEX-######-##                                   -> "EVAL" (avaliacao / aprovacao, paga)
//   PAAPEX-######-## / PA50K                         -> "PA"   (Performance Account / funded)
// Quando o trader eh aprovado, a Apex renomeia a conta com prefixo "PA" -> vira PA sozinho.
// Fonte única — usada pelo sync ao vivo (route.ts) E pelo import de CSV
// (importar-client.tsx / import/route.ts), pra nunca divergir entre os dois caminhos.
export function detectAccountLabel(accountName?: string, connectionName?: string): string {
  const name = (accountName ?? "").toUpperCase().trim()
  const conn = (connectionName ?? "").toUpperCase().trim()

  const simSignals = ["SIM", "DEMO", "PLAYBACK", "TEST", "SIMULATED"]
  if (simSignals.some((s) => name.includes(s) || conn.includes(s))) return "TEST"

  if (!name) return "EVAL" // sem nome de conta: assume avaliacao (fase mais comum)

  if (name.startsWith("PA")) {
    const size = name.match(/PA(\d+K)/i) // PA25K, PA50K, PA100K...
    return size ? `PA${size[1]}` : "PA"
  }

  if (name.includes("EVAL") || name.includes("APEX")) return "EVAL"

  return "EVAL" // fallback conservador: nunca marca como funded por engano
}
