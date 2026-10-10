# MeuTrade — CHECKPOINT 2026-10-10

> **Para o próximo Claude Code:** leia este arquivo inteiro antes de qualquer ação. Substitui o `-10-09` como ponto de retomada (o de 09/10 fica como histórico; as decisões e o "NÃO fazer" dos anteriores continuam valendo).
> Idioma com o Marcelo: **sempre português brasileiro**, direto, avisando riscos. Na dúvida, perguntar antes. Passos pequenos: plano → aprovação → implementação → relatório → revisão.
> Documento público (repo público): **sem P&L real, sem nomes de conta/estratégia, sem dados do usuário**.

## PRÓXIMA SESSÃO → o usuário decide o E5b
**NÃO começar o E5b, E6/G6, Prisma, persistência, UI pública nem agente sem aprovação.** O E5b (a decidir) = verificar a **proveniência** reexecutando a ingestão contra o **CSV original** (`fileSha256`, `importId`, `rowHash`, `tradeId` e a ordem original dos dados).

## O que aconteceu em 10/10
1. **Ordem da sequência (commit `83d4408`)** — resolve a pendência nº 1 do checkpoint de 09/10 (*ordem em empates de saída*). Decisão do usuário: opção 3, a Evidence **registra** a ordem exata usada pelo motor, **sem mudar resultados** nem criar desempate. `population.sequence = { dependent, order }` (só `tradeId`s; `null` em `HASH_ONLY` e em métrica não sequencial), copiado do trace do próprio cálculo; `V4.sequence` (31 checks). `S_ORDER_AMBIGUOUS` deixou de existir; sobrou `S_ORDER_NOT_RECORDED` (ordem ausente **e** empate de instante).
2. **E5.3 — auditoria final (commit local seguinte)** — sem mudar motor, schema nem resultados. Ver `data-contract.md` §14.10.

## Estado técnico
| Item | Valor |
|---|---|
| Repo | `Desktop/Projetos AI/TraderOS` (público), `main`, **local à frente do `origin/main`** (19 commits após o E5.3), árvore limpa |
| Commits | `83d4408` ordem da sequência · E5.3 (auditoria/docs/checkpoint) · antes: `a3ce35e` checkpoint 09/10, `b9e7359` Evidence Lab, `b0392bb` E5.2, `49d6a1c` E5.1, `74f2351` rowHash, `8a190e1` E5.0 |
| Testes | `npm run test:domain` PASS (inclui `test-evidence-sequence.mts` 13, `test-evidence-audit.mts` 7) · `tsc --noEmit` PASS · tipos dos `.mts` PASS · ESLint do escopo (`src/lib/metrics`, `evidence`, `dev` + scripts novos) PASS |
| Motor | 120 hashes de referência (`fixtures/_synthetic/engine-baseline-pre-sequence.json`) idênticos aos de antes da mudança |
| Push / Deploy / Banco / Prisma / Produção | **NENHUM** |

Rodar tudo: `npm run test:domain && npx tsc --noEmit`. Tipos dos `.mts`: `npx tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2023,dom --module esnext --moduleResolution bundler --allowImportingTsExtensions --esModuleInterop --types node scripts/_evidence-fixtures.mts scripts/test-evidence-*.mts`. Lint conhecido fora do escopo (já existia): `scripts/test-evidence-lab.mts:130` (any), `scripts/test-evidence-verify.mts:9` (import não usado), `src/lib/gamification.ts:2`.

## Resultados (fixtures reais locais, ciclos e linhas × com/sem R × 39 métricas × total/grupos/`HASH_ONLY`)
- 5.274 bundles íntegros: **5.238 VALID · 36 UNVERIFIABLE (todos `HASH_ONLY`) · 0 TAMPERED · 0 INVALID_FORMAT · 0 FAIL**. (Em 09/10 eram 5.097 VALID / 177 UNVERIFIABLE; os 141 de "ordem ambígua" viraram VALID.)
- 7.536 ataques em amostra, 7.536 detectados: 5.406 TAMPERED · 1.060 INVALID_FORMAT · 1.060 UNVERIFIABLE (`engineVersion`) · 10 VALID (trocas de empatados imateriais — esperado, ver abaixo).
- Corpus sintético de auditoria: ~1.050 bundles íntegros + ~2.265 mutações; os 4 estados são alcançados.

## As 4 distinções (não confundir)
1. **Ordem registrada para reproduzir o motor** — provada: alimentada ao mesmo motor, reproduz `value`/campos/contribuintes.
2. **Ordem original dos dados** — NÃO provada. Trocar empatados e refazer o selo **só é detectável se mudar valor ou contribuintes**; o verificador valida as afirmações do bundle, não inventa prova da sequência original.
3. **Verificação matemática da população declarada** — provada (V3/V4); não prova a seleção original (`L_SELECTION_NOT_PROVEN`).
4. **Origem** — depende do **E5b** (`L_ORIGIN_NOT_PROVEN`); o selo não é assinatura (`L_SEAL_NOT_SIGNATURE`).

## Achado do E5.3 (corrigido)
`combine()` recebia `p.r[id] ?? NA("não se aplica")`: um check esquecido por algum caminho viraria "não se aplica" (não bloqueante). Nenhum caminho dependia disso (medido), mas virou `SKIPPED S_CHECK_NOT_EXECUTED` (bloqueante) e há teste de fonte.

## Decisões do usuário em vigor (não reinterpretar)
- Não alterar a ordenação do motor (instante de saída; desempate = posição no array de entrada) nem criar desempate novo.
- `HASH_ONLY` nunca é `VALID`; sem alegar verificação da sequência completa. `evidenceHash` não é assinatura. Versão incompatível ⇒ `UNVERIFIABLE`. Sem tolerância numérica. Lab sem banco/Prisma.
- Estratégia/sessão sem referência na Evidence ⇒ associação `SKIPPED`, sem ampliar o schema agora.

## Opcionais futuros (não bloqueiam)
- Cenário visual no Evidence Lab: **ordem trocada com selo recalculado** (integridade interna × ordem original).
- Tornar `strict` os sub-schemas herdados do Canonical (hoje o `V0.unknown-fields` compensa).

## O que NÃO fazer
- ❌ E5b/E6/G6, Prisma, persistência, UI de produto, agente, **sem aprovação**. ❌ Mudar o motor. ❌ Segundo motor/hash no verificador. ❌ Dado real no repo público. ❌ push/deploy/banco.

## Dicas operacionais
- Dev server costuma estar na porta 3000 (não derrubar). Lab: `/dev/evidence-lab` (só `NODE_ENV=development`).
- Prova "não mudei o motor": baseline de hashes (`engine-baseline-pre-sequence.json`, testado em `test-evidence-sequence.mts`).
- O gerador sintético colapsa linhas "parecidas" (mesma data com módulo, exit < entry é rejeitado): em novos conjuntos use dias distintos e confira `trades.length`.
- zsh: aspas em globs; evitar `echo ===`.

## Session Log — 2026-10-10
```text
Commits:                  83d4408 (ordem da sequência) + E5.3 (auditoria/docs)
Testes:                   test:domain PASS · tsc PASS · tsc dos .mts PASS · ESLint (escopo) PASS
Motor:                    120 hashes de referência idênticos
Bundles reais:            5.274 → 5.238 VALID · 0 TAMPERED · 36 UNVERIFIABLE (HASH_ONLY) · 0 INVALID_FORMAT
Ataques:                  7.536 em amostra, 7.536 detectados (5.406 TAMPERED, 1.060 INVALID_FORMAT, 1.060 UNVERIFIABLE, 10 VALID imateriais)
Pendências:               decidir E5b; depois E6/G6; Prisma só com contrato validado
Push / Deploy / Produção: NÃO / NÃO / NÃO tocada
```
