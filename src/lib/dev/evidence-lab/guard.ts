// Guard do MeuTrade — Evidence Lab (ferramenta de DESENVOLVIMENTO; nunca faz parte do produto).
// Regra explícita e restritiva (allowlist, não blocklist): o Lab SÓ existe com NODE_ENV === "development".
// Em produção (`next start`/Vercel), em `test` ou sem NODE_ENV, nada é liberado. A checagem é feita NO SERVIDOR em todo ponto de entrada
// (proxy, layout, page e o construtor de dados) — não depende de esconder link.
//
// Puro e sem dependências (importável pelo proxy e pelos testes). `env` é parâmetro para poder testar a decisão sem mexer em process.env.

export const EVIDENCE_LAB_BASE_PATH = "/dev/evidence-lab"

type Env = { NODE_ENV?: string }

export function isEvidenceLabEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV === "development"
}

export function isEvidenceLabPath(pathname: string): boolean {
  return pathname === EVIDENCE_LAB_BASE_PATH || pathname.startsWith(`${EVIDENCE_LAB_BASE_PATH}/`)
}

/** Defesa em profundidade: o construtor de dados também recusa fora de desenvolvimento (não confia no chamador). */
export function assertEvidenceLabEnabled(env: Env = process.env): void {
  if (!isEvidenceLabEnabled(env)) throw new Error("Evidence Lab indisponível: só funciona com NODE_ENV=development.")
}
