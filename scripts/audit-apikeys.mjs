/**
 * Auditoria das API Keys do NinjaTrader.
 *
 * Garante que TODA key no banco está armazenada como hash SHA-256 (nunca em
 * texto puro). Uma key em plaintext é rejeitada pelo sync (401) e trava a
 * sincronização de trades do usuário — foi o bug de 07/06/2026.
 *
 * Uso:
 *   node scripts/audit-apikeys.mjs          # só reporta
 *   node scripts/audit-apikeys.mjs --fix    # migra plaintext -> hash (raw key segue válida)
 */
import "dotenv/config"
import crypto from "crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const FIX = process.argv.includes("--fix")
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex")
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const keys = await prisma.userApiKey.findMany({ select: { id: true, key: true, userId: true } })
let hashed = 0, plaintext = 0, unknown = 0, fixed = 0

for (const k of keys) {
  if (/^[a-f0-9]{64}$/.test(k.key)) {
    hashed++
  } else if (k.key.startsWith("traderos_")) {
    plaintext++
    console.log(`⚠️  PLAINTEXT: user ${k.userId.slice(0, 8)} (${k.key.slice(0, 16)}…)`)
    if (FIX) {
      await prisma.userApiKey.update({
        where: { id: k.id },
        data: { key: sha256(k.key), keyPrefix: k.key.slice(0, 16) },
      })
      fixed++
      console.log(`   ↳ migrada para hash ✓`)
    }
  } else {
    unknown++
    console.log(`❓ FORMATO DESCONHECIDO: user ${k.userId.slice(0, 8)} (${k.key.length} chars)`)
  }
}

console.log(`\nTotal: ${keys.length} | hash: ${hashed} | plaintext: ${plaintext} | desconhecido: ${unknown}`)
if (plaintext > 0 && !FIX) console.log(`\n→ Rode com --fix para migrar as ${plaintext} chave(s) plaintext.`)
if (FIX && fixed > 0) console.log(`→ ${fixed} chave(s) migrada(s).`)
if (plaintext === 0 && unknown === 0) console.log(`✅ Todas as chaves estão hasheadas corretamente.`)

await prisma.$disconnect()
