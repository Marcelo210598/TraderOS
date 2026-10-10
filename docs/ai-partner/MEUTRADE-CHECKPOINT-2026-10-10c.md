# MeuTrade — CHECKPOINT 2026-10-10c (contexto reproduzível · Lab E5b · plano E6/G6)

> **Para o próximo Claude Code:** leia este arquivo inteiro antes de qualquer ação. Substitui o `-10-10b` como ponto de retomada (os anteriores ficam como histórico; as decisões e o "NÃO fazer" deles continuam valendo).
> Idioma com o Marcelo: **sempre português brasileiro**, direto, avisando riscos. Na dúvida, perguntar antes. Passos pequenos: plano → aprovação → implementação → relatório → revisão.
> Documento público (repo público): **sem P&L real, sem nomes de conta/estratégia, sem dados do usuário**.

## PRÓXIMA SESSÃO → o usuário revisa o plano E6/G6
**NÃO implementar o E6 nem integrar o agente sem aprovação.** Plano completo e decisões pendentes: `docs/ai-partner/E6-G6-plano.md` (§3: unidade do motivo de saída perna×trade, `MIXED`/`UNKNOWN`, evidence aditivo, sem p-valor, correção `cycleKey.strategy`, conjunto de perguntas).

## O que aconteceu (3 commits locais, nesta ordem)
1. **`233d887` — contexto reproduzível (§14.12).** `ImportRecord.reproducibility` (opcional, **fora do `importId`**): versões das funções de identidade, `foldPolicy` efetivo, `exitReasonMap` normalizado na ordem, `accountRefSalted` (nunca o sal). `importId`/`rowHash`/`tradeId`/`tradeSetHash` **idênticos** aos do commit anterior (valores pinados em `test-evidence-import-context.mts`, provados por worktree). Imports antigos **não são retro-preenchidos**; o E5b usa o registrado e continua `UNVERIFIABLE` sem sal/versão compatível. Correção embutida: a bandeira de sal não é mais comparada como divergência quando o sal não foi informado.
2. **`f5ab85f` — Evidence Lab, aba "Origem (E5b)".** 11 cenários sintéticos com `verifyEvidenceSource` + `verifyEvidence` reais (íntegro, 1 byte, célula, hash, importId, rowHash, tradeId, **forjado VALID no V0–V4 e SOURCE_MISMATCH no E5b**, HASH_ONLY, sem arquivo, versão). 9 passos, legenda dos estados (parcial ≠ completo). Visão geral atualizada (9 camadas). Validado no localhost e em `next build --webpack` + `next start` (cópia isolada): anônimo → login/401, logado → 404 em tudo.
3. **(este commit)** — plano E6/G6, checkpoint, snapshot.

## Estado técnico
| Item | Valor |
|---|---|
| Repo | `Desktop/Projetos AI/TraderOS` (público), `main`, commits locais à frente do `origin/main`, árvore limpa |
| Testes | `npm run test:domain` PASS (+ `test-evidence-import-context.mts` 7, `test-evidence-lab-source.mts` 8) · `tsc` PASS · tipos dos `.mts` PASS · ESLint do escopo PASS |
| Motor / V0–V4 / E5b | 120 hashes de referência idênticos; 5.238 VALID / 36 UNVERIFIABLE; E5b: 288 bundles reais, 273 verificados, 7 parciais, 8 sem referência, 0 divergências |
| Push / Deploy / Banco / Prisma / Produção | **NENHUM** |

Rodar tudo: `npm run test:domain && npx tsc --noEmit`. Tipos dos `.mts`: `npx tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2023,dom --module esnext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --types node scripts/_evidence-fixtures.mts scripts/test-evidence-*.mts`. Lint conhecido fora do escopo (já existia): `scripts/test-evidence-lab.mts:130`, `scripts/test-evidence-verify.mts:9`, `src/lib/gamification.ts:2`.

## Achados desta sessão
- **Privacidade (pré-existente, E3):** `reconstruction.cycleKey.strategy` leva o **nome da estratégia em texto aberto** no bundle (só a conta vira `accountRef`). O teste do Lab trava que só aparece nesse campo. Corrigir muda schema/`evidenceHash` ⇒ decisão (plano, §3.5).
- **Lab em produção real:** Turbopack não aceita `node_modules` por symlink; para testar produção numa cópia use `next build --webpack`. A cópia leva o `.env`: **apagar depois** (feito).
- **`exitReasonMap` em trades-linha** não aparece em nenhum valor afirmado (só ciclos têm pernas): adulterá-lo ali é imaterial; em ciclos é detectado (`V5.values`).
- **Trades-linha** não guardam o rótulo de saída no Canonical (só no `meta` usado no `rowHash`): motivo de saída = desconhecido (relevante para o E6).

## Decisões do usuário em vigor (não reinterpretar)
- Ordenação do motor intacta; `HASH_ONLY` nunca `VALID`/completo; `evidenceHash` não é assinatura; sem tolerância numérica; Lab sem banco/Prisma, só sintético; **o sal nunca é gravado**; imports antigos não são retro-preenchidos; não inventar sistema de segredos.
- E6 e agente só com plano aprovado; commits separados por etapa; sem push/deploy/banco/Prisma.

## Opcionais futuros
- Lab: cenário "ordem trocada com selo recalculado"; aba do E6 (E6.4).
- Provar a seleção original (E5c); `strict` nos sub-schemas do Canonical.

## O que NÃO fazer
- ❌ E6/G6, agente, Prisma, persistência, UI de produto, **sem aprovação**. ❌ Mudar o motor. ❌ Segundo motor/pipeline/hash. ❌ Dado real (CSV, contas, P&L) no repo. ❌ push/deploy/banco.

## Dicas operacionais
- Dev server do TraderOS costuma estar na 3000 (não derrubar): Lab em `http://localhost:3000/dev/evidence-lab?tab=source&src=forged`.
- Para provar "identidade não mudou": worktree do commit anterior + `ids.mts` comparando `importId`/`tradeId`/`tradeSetHash` (ver `test-evidence-import-context.mts`, valores pinados).
- Playwright MCP só salva screenshots dentro de `~/.playwright-mcp` ou `~`.

## Session Log — 2026-10-10 (sessão 3)
```text
Commits:                  233d887 (contexto reproduzível) · f5ab85f (Lab Origem E5b) · docs (plano E6/G6, checkpoint, snapshot)
Testes:                   test:domain PASS · tsc PASS · tsc dos .mts PASS · ESLint (escopo) PASS
Motor:                    120 hashes de referência idênticos; V0–V4 e E5b inalterados nos reais
Produção do Lab:          anônimo 307/401 · logado 404 (build webpack + start, cópia apagada)
Pendências:               revisão do plano E6/G6 e das 6 decisões da §3
Push / Deploy / Produção: NÃO / NÃO / NÃO tocada
```
