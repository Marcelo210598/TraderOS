// Helper de teste do E7-13 (Portão C): conexão ao banco de TESTE do Neon (uma branch descartável) e a TRAVA DE SEGURANÇA que impede qualquer teste de tocar o banco de produção.
//   · Só conecta com PRISMA_LIVE=1 E uma variável DEDICADA `E7_TEST_DATABASE_URL` (do ambiente ou do `.env.local`); NUNCA usa a DATABASE_URL para conectar.
//   · `assertSafeTestDatabase(testUrl, prodUrl)` (PURA, testada offline em test-prisma-stores.mts P6) recusa: URL ausente/vazia/não-string, protocolo que não seja postgres, e o MESMO SERVIDOR (host, ignorando o sufixo
//     `-pooler` do Neon e a porta) da URL de produção, qualquer que seja o banco, a senha ou os parâmetros. O resultado NUNCA contém a URL.
//   · `connectLiveDb()` compara a URL de teste com TODAS as URLs de produção conhecidas (DATABASE_URL e DIRECT_URL, do ambiente e dos arquivos .env/.env.local) — lidas SÓ para comparar.
//   · `reset()` apaga linhas SOMENTE das 4 tabelas `ai_*`. O `@prisma/client` só é importado dentro de connectLiveDb (o modo offline nunca o carrega).
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export type SafeDbResult = { readonly ok: true; readonly host: string; readonly database: string } | { readonly ok: false; readonly code: "TEST_DB_URL_MISSING" | "TEST_DB_URL_INVALID" | "TEST_DB_IS_PRODUCTION" | "TEST_DB_PROD_UNVERIFIABLE" }

interface Parsed { readonly host: string; readonly database: string }
function parsePostgresUrl(x: unknown): Parsed | null {
  try {
    if (typeof x !== "string") return null
    const u = new URL(x.trim())
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null
    const database = decodeURIComponent(u.pathname.replace(/^\/+/, ""))
    return u.hostname === "" || database === "" ? null : { host: u.hostname.toLowerCase(), database }
  } catch {
    return null
  }
}
/** O servidor sem o `-pooler` do Neon (a mesma instância serve o pooler e a conexão direta). */
const serverOf = (host: string): string => host.replace(/-pooler(?=\.)/, "")

export function assertSafeTestDatabase(testUrl: unknown, prodUrl: unknown): SafeDbResult {
  if (typeof testUrl !== "string" || testUrl.trim() === "") return { ok: false, code: "TEST_DB_URL_MISSING" }
  const test = parsePostgresUrl(testUrl)
  if (test === null) return { ok: false, code: "TEST_DB_URL_INVALID" }
  if (prodUrl !== undefined && prodUrl !== null && !(typeof prodUrl === "string" && prodUrl.trim() === "")) {
    const prod = parsePostgresUrl(prodUrl)
    if (prod === null) return { ok: false, code: "TEST_DB_PROD_UNVERIFIABLE" } // há uma URL de produção que não dá para ler: sem comparar, não conecta
    if (serverOf(prod.host) === serverOf(test.host)) return { ok: false, code: "TEST_DB_IS_PRODUCTION" }
  }
  return { ok: true, host: test.host, database: test.database }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url))
/** Lê `KEY=valor` de um arquivo de ambiente (sem aspas); só para comparar/obter a URL de teste. Nunca imprime. */
function fromEnvFile(file: string, key: string): string | undefined {
  try {
    const path = `${ROOT}${file}`
    if (!existsSync(path)) return undefined
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m !== null && m[1] === key) return m[2].replace(/^["']|["']$/g, "")
    }
  } catch { /* ilegível: tratado como ausente */ }
  return undefined
}
export const liveEnabled = (): boolean => process.env.PRISMA_LIVE === "1"

export interface LiveDb {
  /** O cliente Prisma real (estruturalmente compatível com a PrismaPort dos adaptadores). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly db: any
  /** Apaga TUDO das 4 tabelas ai_* (só elas), na ordem que respeita a FK. */
  reset(): Promise<void>
  close(): Promise<void>
}
/** `pooled`: usa a URL do POOLER (pgbouncer) do mesmo banco de teste (`E7_TEST_DATABASE_URL_POOLED`) — passa pela MESMA trava. */
export async function connectLiveDb(which: "direct" | "pooled" = "direct"): Promise<LiveDb> {
  if (!liveEnabled()) throw new Error("PRISMA_LIVE=1 é necessário para testar contra um banco")
  const key = which === "pooled" ? "E7_TEST_DATABASE_URL_POOLED" : "E7_TEST_DATABASE_URL"
  const testUrl = process.env[key] ?? fromEnvFile(".env.local", key)
  const prods = [process.env.DATABASE_URL, process.env.DIRECT_URL, fromEnvFile(".env", "DATABASE_URL"), fromEnvFile(".env", "DIRECT_URL"), fromEnvFile(".env.local", "DATABASE_URL"), fromEnvFile(".env.local", "DIRECT_URL")]
  for (const prod of prods) {
    const verdict = assertSafeTestDatabase(testUrl, prod)
    if (!verdict.ok) throw new Error(`banco de teste recusado: ${verdict.code}`) // só o código; nunca a URL
  }
  const { PrismaClient } = await import("@prisma/client")
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl as string }) })
  return {
    db: client,
    reset: async () => {
      await client.aiConversationDelta.deleteMany({})
      await client.aiConversation.deleteMany({})
      await client.aiImportSource.deleteMany({})
      await client.aiUserSalt.deleteMany({})
    },
    close: async () => { await client.$disconnect() },
  }
}
