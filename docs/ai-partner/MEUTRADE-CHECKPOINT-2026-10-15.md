# MeuTrade — CHECKPOINT 2026-10-15 (E6.6 FECHADO)

> **Substitui o `-10-14` como ponto de retomada.** Português brasileiro, direto. Repo público `Marcelo210598/TraderOS` (`origin`) **nunca recebeu push** (`eb8a28a`). Backup PRIVADO `TraderOS-backup`, branch `backup/ai-partner-2026-10-13`.

## ESTADO EXATO
- Código do E6.6 em `882fbae` (HEAD no momento do fechamento da fase; o commit de docs do dia vem depois). Backup = `882fbae` (fast-forward conferido). `origin` = `eb8a28a`.
- **Suíte `npm run test:domain`: 1083 ✓** (exit 0) · `tsc --noEmit` 0 · ESLint limpo (1 warning antigo em `gamification.ts`, fora do escopo).
- Tudo puro e SÓ local: sem LLM/Vega IA, persistência, UI, banco, Prisma, `origin`.

## O QUE EXISTE (src/lib/agent-capabilities/, 14 arquivos)
`metrics.query@1`, `metrics.groups@1`, `metrics.compare@1`, `exit.breakdown@1`, `exit.analysis@1`, `rank.groups@1`, `evidence.explain@1`, `evidence.refresh@1` + `assess`, `envelope`, `project`, `alias-input`, `group-key`, `salt`. Validador/render/ledger/catálogo em `src/lib/agent/`. Plano completo: `agent-answer-plano.md` §18–§29; expectativas em `scripts/expectations/agent-answer.expected.json` (blocos `e66_*`, `_meta.history` mais recente no topo).
- **Refresh:** `ctx = { ledger, specOf, regenerated (com `source`) }`; STALE decidido pelo ledger; `data: null`; `refreshEvidence` substitui entrada STALE de mesmo ref (sem sal o ref não muda entre épocas). O servidor real (E7) precisa fornecer `bundleOf`, `specOf` e `regenerated`.

## 🚧 PRÓXIMOS PASSOS (cada um só com aprovação; um passo por vez; expectativa ANTES do código)
1. **E6.6-5-A2** `strategy` (`strategyId ?? strategyName`; filtros em E; `strategyName` fora de `VERIFIABLE_FILTERS` ⇒ UNVERIFIABLE).
2. **D6-1** (groupBy strategyVersion/setup/timeframe excluídos) · **estresse 50×10** do `metrics.groups` · **endurecer RF9** (aceita 2 desfechos).
3. Limitações herdadas: 8 FN léxicos do e66_2b + 3 FP, 10 FN do 2c, 10 FN do fix-B, 5 FP (H11); Q11 1ª metade só com bundles persistidos; `L_SALT_*` só com reports à mão.
4. Depois: **E7** (persistência de bundles/ledger/specs) — decisão do Marcelo.

## MÉTODO (repetir sempre)
Expectativa commitada ANTES → teste FALHA (`ERR_MODULE_NOT_FOUND`) → código mínimo → mutações (escape vira teste ou equivalente declarada; mutação no-op refeita) → suíte comparada linha a linha com o baseline → tsc + ESLint → relatório com erros próprios admitidos. Confirmar achados do Gemini na prática. `git add` SEMPRE por nome. Push só ao backup privado, fast-forward, com autorização do Gemini; `origin` nunca.

## 🧹 HIGIENE (não é do projeto)
`sudo chown -R 501:20 ~/.npm` · `node_modules` no iCloud (`.nosync`) · `npm audit` 34 vulns não investigado · `* 2.*` já no `.gitignore`.
