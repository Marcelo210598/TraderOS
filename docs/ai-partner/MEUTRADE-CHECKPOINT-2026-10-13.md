# MeuTrade — CHECKPOINT 2026-10-13 (E6.6-0 → E6.6-7)

> **Substitui o `-10-12f` como ponto de retomada.** Português brasileiro, direto. Repo **público** `Marcelo210598/TraderOS` intocado: sem dados reais, sem deploy, banco, Prisma ou produção. Backup privado: `git push backup HEAD:refs/heads/backup/ai-partner-2026-10-13` (só quando o Marcelo mandar).

## ESTADO DOS COMMITS (exato)
- **No backup (privado):** até `5ede7cb` (E6.6-6).
- **SÓ LOCAL (não enviados):** `52a1303` (utilitário único do sal `salt.ts` + guarda 2d), `1137031` (E6.6-7 `exit.breakdown@1`) e o commit deste checkpoint.
- Total local: 93 commits à frente do `origin/main` (nunca houve push pro público).
- **Aprovados pelo Marcelo:** E6.6-0 … E6.6-6. **Aguardando aprovação:** `52a1303` (refactor do sal, pedido por ele) e E6.6-7.

## SUÍTE / BASELINE
`npm run test:domain` PASS — **972 ✓** · baseline de 771 linhas (commit `69805ba`) **idêntico** (0 linhas removidas/alteradas) · `tsc --noEmit` 0 · ESLint (`src/lib/agent`, `src/lib/agent-capabilities`, `scripts/test-agent-*.mts`) 0 · `git diff` em `evidence/ metrics/ ingest/ domain/` **vazio**. (Erros ESLint antigos em test-evidence-lab/s2/verify/timezone não são nossos.)

## O QUE FOI FEITO (12–13/10)
| Passo | Commit | Entrega |
|---|---|---|
| E6.6-0 a–e | `1e87b2e`…`69805ba` | `combineVerdict/buildVerdict` única fonte do `combined`; schema rejeita inconsistente; guardas G1–G4 |
| E6.6-P | `5acc13c`, `3ce3b1d` | plano do resto + léxico (627 termos) |
| E6.6-1 | `2080ac1` | formatador exato, catálogo de 29 motivos, resolvedor de path, projetor A2 com alias |
| E6.6-2a | `c6df512` | ledger imutável + validador estrutural (bump `STRUCTURE_INVALID`) |
| E6.6-V | `778f5b0` | views com `reason` ao lado das folhas anuláveis (PD-2) |
| E6.6-2b | `1811380`, `7e464c7` | validador de texto livre (231 casos adversariais), bump `OPERATIONAL_ADVICE`, `basis` como slot (PD-1) |
| E6.6-3 | `a498fd6` (+`7f20c4f` emenda D7) | máquina de turno (8 chamadas, N=2), catálogos, render com banner |
| E6.6-4 | `948e0f1` | pipeline comum das capacidades (`agent-capabilities/`), envelope, projeção por lista branca |
| guardas Q7 | `9811818` | import nu pego |
| E6.6-5 | `771c3ca` | `metrics.query@1` |
| E6.6-6 | `5ede7cb` | `metrics.groups@1` (12 dimensões, alias de saída, limite 50) |
| sal | `52a1303` | `salt.ts` (`generatorOpts`/`saltMissing`) + guarda (2d); 5 desvios sondados |
| E6.6-7 | `1137031` | `exit.breakdown@1` (EXIT_REASON_ANALYSIS; perna e trade lado a lado; reconciliação; oráculo = `exitReasonAnalysis` direto); 31 mutações |

**E6.6-7, honestidade:** 2 lacunas de teste achadas por mutação viraram teste (pnlBasis/timeZone mudam o `evidenceRef`; reconciliação ponta a ponta X5b). 2 equivalentes declaradas (X11, X16); 1 mutação minha mal formulada (P14) descartada. Erros meus: X8 esperava só 1 motivo (o certo são 2); spread em `project.ts` barrado pelo guarda Q4 (troquei por `concat`).

**Decisões vigentes:** D1–D8 (E6.6-3, D7 = tentativa de capacidade inexistente consome chamada), D4-1…D4-4, D5, D6/D6-1, D7-1…D7-5 (E6.6-7), C1–C10 (C10=B), PD-1 (basis = slot), PD-2 (reason nas views), PD-3 (DATA_NOT_PROVIDED, lead "não informado (o arquivo importado não trouxe este dado)").

## PENDENTE (cada passo só com aprovação explícita)
1. Aprovar `52a1303` e E6.6-7; **push** dos commits locais pro backup.
2. **E6.6-8** `metrics.compare@1` (deltas já têm `reason` nas views) → **E6.6-9** `rank.groups@1` → **E6.6-10** `exit.analysis@1` → **E6.6-11** `evidence.explain@1` (implementar PD-3: código `DATA_NOT_PROVIDED` no catálogo + testes de distinção do vocabulário de verificação) → **E6.6-12** `evidence.refresh@1` + fechamento (guardas globais, docs, CHANGELOG).
3. Pendências abertas: **E6.6-5-A** (resolvedor de alias de ENTRADA: filtros/where por conta/estratégia/setup/timeframe seguem `ARGS_INVALID`); **D6-1** (groupBy strategyVersion/setup/timeframe excluídos); **limitação de desempenho** (até 50×10 `explainMetric` no `metrics.groups`); `L_SALT_*` só testado com reports montados à mão; Q11 1ª metade (INVALID_FORMAT ⇒ UNVERIFIABLE) só alcançável com bundles persistidos (E7); 8 falsos negativos léxicos conhecidos e 3 falsos positivos aceitos (`e66_2b`).
4. Continua fora de escopo: LLM/Vega IA, persistência, UI, banco, Prisma, produção, repo público.

## Leitura rápida para retomar
1. `docs/ai-partner/agent-answer-plano.md` (§7–§17) e este arquivo.
2. `scripts/expectations/agent-answer.expected.json` (blocos `e66_*`, `history`).
3. `src/lib/agent/` (puro) e `src/lib/agent-capabilities/` (único que importa `evidence/` e `metrics/`).
4. Método: expectativa antes do código → ver falhar → mutação (escapes viram teste ou equivalente declarada) → baseline comparado → parar a cada passo.
