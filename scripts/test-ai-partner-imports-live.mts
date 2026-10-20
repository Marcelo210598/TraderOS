// E7-14 (Portão C): teste AO VIVO de ponta a ponta da fiação da ingestão.
// Executa os tratadores reais contra:
// 1. Cloudflare R2 real (bucket meutrade-raw)
// 2. Neon Postgres real (branch de TESTE ep-quiet-sun-…)
// 3. SALT_MASTER_KEY real (gerada em runtime)
// Sem PRISMA_LIVE=1 ou sem R2_LIVE=1 este arquivo não faz nada.
//   PRISMA_LIVE=1 R2_LIVE=1 node scripts/test-ai-partner-imports-live.mts
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { buildAiPartnerDeps } from "../src/lib/infra/ai-partner-deps.ts"
import { handleImportDelete, handleImportPost, handleImportsGet, type AiPartnerCtx } from "../src/lib/infra/ai-partner-imports.ts"
import { createR2ObjectStore, loadR2Config } from "../src/lib/infra/object-store-r2.ts"
import { synthCsv } from "./_evidence-fixtures.mts"
import { connectLiveDb, liveEnabled } from "./_prisma-live.mts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const r2LiveEnabled = (): boolean => process.env.R2_LIVE === "1"
const U1 = "cmd3h2k0a0000live1234efgh"
const URL_BASE = "https://app.test/api/ai-partner/imports"

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> }
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["\x27]|["\x27]$/g, "")
    }
  } catch { /* ignora */ }
  return env
}

const p2 = (x: number): string => String(x).padStart(2, "0")
const sampleCsv = synthCsv(Array.from({ length: 25 }, (_, i) => ({
  entryPrice: 2000 + (i % 10),
  exitPrice: 2005 + (i % 10),
  entryAt: `${p2(1 + (i % 28))}/03/2026 09:00:00`,
  exitAt: `${p2(1 + (i % 28))}/03/2026 09:30:00`,
  account: "Sim101",
})) as Any)

if (!liveEnabled() || !r2LiveEnabled()) {
  if (!process.env.COLLECT) {
    console.log("… testes AO VIVO da fiação pulados: requer PRISMA_LIVE=1 e R2_LIVE=1")
  }
} else {
  let passed = 0
  const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
    await fn()
    passed += 1
    console.log(`✓ ${name}`)
  }

  const direct = await connectLiveDb("direct")
  const env = loadEnv()
  // Gera uma SALT_MASTER_KEY válida para a sessão de teste
  env.SALT_MASTER_KEY = randomBytes(32).toString("hex")

  const r2Cfg = loadR2Config(env)
  assert.equal(r2Cfg.ok, true, "R2 config deve ser válida")
  const r2RawStore = createR2ObjectStore((r2Cfg as Any).config)

  const built = buildAiPartnerDeps(env, direct.db)
  assert.equal(built.ok, true, "buildAiPartnerDeps deve montar com sucesso")
  const deps = (built as Any).deps

  const ctx: AiPartnerCtx = {
    userId: U1,
    getPlan: async () => "FREE",
    rateLimit: async () => ({ ok: true, retryAfterSec: 0 }),
    deps,
  }

  let uploadedSha = ""

  try {
    await direct.reset()

    await test("LV1 — POST ao vivo no R2 e Neon: salva CSV comprimido no R2, metadados na ai_import_sources e cria o sal na ai_user_salts", async () => {
      const req = new Request(URL_BASE, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.test" },
        body: JSON.stringify({ text: sampleCsv, fileName: "sample-live.csv" }),
      })

      const res = await handleImportPost(ctx, req)
      assert.equal(res.status, 201, `esperado 201, recebeu ${res.status}`)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.equal(data.created, true)
      assert.equal(typeof data.importId, "string")
      assert.equal(typeof data.fileSha256, "string")
      uploadedSha = data.fileSha256

      // Verifica R2 de verdade: objeto users/{U1}/imports/{sha}.csv.gz deve existir
      const r2Key = `users/${U1}/imports/${uploadedSha}.csv.gz`
      const r2Obj = await r2RawStore.get(r2Key)
      assert.equal(r2Obj.ok, true, `objeto R2 ${r2Key} deve existir`)

      // Verifica Neon de verdade: tabela ai_import_sources
      const dbImp = await direct.db.aiImportSource.findUnique({
        where: { userId_fileSha256: { userId: U1, fileSha256: uploadedSha } },
      })
      assert.ok(dbImp, "linha na ai_import_sources deve existir")
      assert.equal(dbImp.fileName, "sample-live.csv")

      // Verifica Neon de verdade: tabela ai_user_salts (sal criado)
      const salts = await direct.db.aiUserSalt.findMany({ where: { userId: U1 } })
      assert.equal(salts.length, 1, "sal do usuário deve ter sido criado")
    })

    await test("LV2 — IDEMPOTÊNCIA ao vivo: segundo POST do mesmo CSV devolve 200 created:false e não duplica nada", async () => {
      const req = new Request(URL_BASE, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.test" },
        body: JSON.stringify({ text: sampleCsv, fileName: "sample-live.csv" }),
      })

      const res = await handleImportPost(ctx, req)
      assert.equal(res.status, 200, `esperado 200, recebeu ${res.status}`)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.equal(data.created, false)
      assert.equal(data.fileSha256, uploadedSha)

      // Cota continua 1 arquivo
      const imps = await direct.db.aiImportSource.findMany({ where: { userId: U1 } })
      assert.equal(imps.length, 1)
    })

    await test("LV3 — GET ao vivo: lista importações e reporta uso correto do Postgres", async () => {
      const req = new Request(URL_BASE, { method: "GET" })
      const res = await handleImportsGet(ctx, req)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.ok(data.usage)
      assert.equal(data.usage.files, 1)
      assert.equal(data.imports.length, 1)
      assert.equal(data.imports[0].fileSha256, uploadedSha)
    })

    await test("LV4 — DELETE ao vivo: apaga o arquivo do R2 e a linha do Neon, liberando a cota", async () => {
      const req = new Request(`${URL_BASE}/${uploadedSha}`, {
        method: "DELETE",
        headers: { origin: "https://app.test" },
      })
      const res = await handleImportDelete(ctx, req, uploadedSha)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)

      // Verifica que no R2 o objeto foi removido
      const r2Key = `users/${U1}/imports/${uploadedSha}.csv.gz`
      const r2Obj = await r2RawStore.get(r2Key)
      assert.equal(r2Obj.ok, false)

      // Verifica que na tabela ai_import_sources foi removido
      const dbImp = await direct.db.aiImportSource.findUnique({
        where: { userId_fileSha256: { userId: U1, fileSha256: uploadedSha } },
      })
      assert.equal(dbImp, null)

      // GET agora deve mostrar 0 arquivos
      const getRes = await handleImportsGet(ctx, new Request(URL_BASE))
      const getData = await getRes.json()
      assert.equal(getData.usage.files, 0)
    })

    console.log(`\n${passed} testes AO VIVO da fiação passaram com sucesso (R2 + Neon).`)
  } finally {
    // Limpeza garantida
    if (uploadedSha) {
      await r2RawStore.delete(`users/${U1}/imports/${uploadedSha}.csv.gz`).catch(() => undefined)
    }
    await direct.reset().catch(() => undefined)
    await direct.close().catch(() => undefined)
  }
}
