# MeuTrade — CHECKPOINT 2026-10-12f (sourceLabel · rowTrades · política de sal · E6.5)

> **Substitui o `-10-12e` como ponto de retomada** (decisões e "NÃO fazer" anteriores continuam). Português brasileiro, direto. Repo **público**: sem dados reais. **Tudo local: 69 commits à frente do `origin/main`, sem push, deploy, banco, Prisma nem produção.**

## PRÓXIMA SESSÃO
**O Marcelo decide o próximo passo. Se for o E6.6, traga o ESCOPO e o PLANO (expectativa escrita ANTES do código, como sempre) antes de escrever qualquer linha.** Não começar nada novo sem essa decisão.

### E6.6 só pode começar por (PRÉ-REQUISITO OBRIGATÓRIO, aprovado)
`agent-contract-plano.md` §6.1 e `agent-capabilities.md` §9:
1. `combineVerdict(verify, source)` como **única** fonte do `combined` (inclui `source = NOT_RUN ⇒ NOT_VERIFIED`; precedência `TAMPERED_OR_MISMATCH > NOT_VERIFIED > VERIFIED_PARTIAL > VERIFIED`);
2. `EvidenceHandleSchema` **rejeitando** `combined ≠ combineVerdict(verify, source)` (hoje o schema ACEITA — lacuna travada pelo teste **KG1**, que quebra de propósito quando isto for fechado);
3. nenhum handle construído sem a função;
4. **nada** do E6.6 (capacidade, validador, PromptView, projetor) é mesclado antes dos itens 1–3;
5. nota técnica: zod 4 não permite `.omit()` em schema com `refine` ⇒ criar `EvidenceHandleBase` (sem refine) e derivar dele o handle de servidor e a visão do modelo (mesmo padrão do `ReproducibilityBase`).

## O que foi concluído em 12/10/2026 (tudo local)
| Entrega | Onde (docs) | Teste principal |
|---|---|---|
| **sourceLabel S0–S6**: rótulo na Evidence = vocabulário v1 (`Entry`, `Target<0–99>`, `Stop<0–99>`, `Zerar`) ou token `lbl_`; `patternRef` p/ o mapa do usuário; `labelVocab` | `sourceLabel-plano.md`, `data-contract.md` §14.15 | `test-evidence-sourcelabel-s2/s4/s4b`, `test-evidence-label-vocab` |
| **E5b × bundles de linhas (`rowTrades`)** corrigido (índice de ids incluía só ciclos) | `CHANGELOG-contratos.md`, `data-contract.md` §V5.5 | `test-evidence-source-rowtrades` |
| **Política de sal por usuário P0–P6**: sal ≥ 256 bits gerado pelo sistema, chaveiro versionado EM MEMÓRIA, `saltId`/`saltCheck` no bundle, geração fail-closed, E5b lê via provider (`saltCheck` nunca é portão), 8 cenários no Lab | `salt-policy-plano.md`, `data-contract.md` §14.14–14.15 | `test-salt-policy-p1/p2/p3/p4`, `test-evidence-lab-salt`, `test-evidence-salt-propagation` |
| **E6.5 contrato do agente** (só desenho + tipos + testes estáticos): 8 capacidades, envelope com `verify`+`source`+`combined`, slots exatos, ledger de `evidenceRef`, N = 2 regerações, K = 20, 8 chamadas/turno, 49 frases canônicas, T0/T1/T2 | `agent-contract-plano.md`, `agent-capabilities.md`, `src/lib/agent/{contract,views,phrases}.ts` | `test-agent-contract-types`, `test-agent-contract-static`, `test-evidence-no-solo-verdict` (SG2) |

**Achados que mudaram o desenho (guardar):**
- `combine()` do E5b escondia SKIPPED bloqueante atrás de `S_POPULATION_PARTIAL` (corrigido).
- Heurística legada "todas as contas divergem ⇒ sal errado ⇒ UNVERIFIABLE" deixava o atacante escolher a severidade (corrigida para bundles com `saltId`; resíduo: só string + `saltCheck` errado).
- `ensure()` do chaveiro curava em silêncio um usuário sem sal atual (agora `E_SALT_NO_CURRENT`).
- Casas decimais da exibição = as do motor (R e razão 4, dinheiro/percentual 2): **nunca** um 2º arredondamento.
- Códigos `S_*` que bloqueiam: 21 (todos têm frase; catálogo conferido contra o código por teste).

## Limites que continuam (documentados)
- V9: ref adulterado + `saltId` desconhecido ⇒ `UNVERIFIABLE` (indistinguível de sal aposentado; combinado `NOT_VERIFIED`).
- Imports legados/não-salgados: sem `saltCheck`, a trava de geração não os cobre (lacuna do sal esquecido segue, com pista no E5b).
- Refs (`acc_/str_/lbl_/pat_`) são pseudônimos, **não anonimização**.
- Sem armazenamento do arquivo original o `source` do agente é `NOT_RUN` ⇒ tudo `NOT_VERIFIED` com o texto ESTRUTURAL (estado esperado até a fase de persistência).

## Estado técnico
`npm run test:domain` PASS (**746** conferências `✓`) · `tsc` PASS (+ `.mts`) · ESLint do escopo PASS (único erro antigo e conhecido: `scripts/test-evidence-lab.mts:130`) · baselines de hash/ids idênticos · **nenhuma** mudança em produção, push, deploy, banco ou Prisma.

## Pendente (NÃO fazer sem aprovação explícita do Marcelo)
E6.6 (começa pelo pré-requisito acima) · integração com a Vega IA/LLM · armazenamento do arquivo original · armazenamento real do chaveiro de sal (cifrado, com backup) · E5c (provar a seleção original) · vocabulário v2 (`Flat`/`Close`) · Prisma/persistência · UI de produto.

## Leitura rápida para retomar
1. `docs/ai-partner/agent-contract-plano.md` (§6.1) e `agent-capabilities.md`.
2. `data-contract.md` §14.13–14.15.
3. `scripts/expectations/{agent-contract,salt-policy,sourcelabel,e5b-rowtrades}.expected.json` (expectativas escritas antes do código; `_meta.history` registra cada correção).
4. `historico/2026-10-12.md` (sessões 7–16) e `historico/resumo.md`.
