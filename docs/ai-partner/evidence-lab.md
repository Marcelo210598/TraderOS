# MeuTrade — Evidence Lab

Ferramenta de **desenvolvimento** para ver, no navegador, o que a fundação de dados, as métricas e a Evidence fazem. **Não é a interface do produto.**

## Como abrir
```bash
npm run dev          # ou o `next dev` que já estiver rodando
# http://localhost:3000/dev/evidence-lab        (a porta é a do seu next dev)
```
Sem login e sem banco. Tudo é calculado **agora** pelas funções reais do domínio sobre um CSV **inventado** (16 linhas → 14 ciclos: contas "Conta Demo A/B", estratégia "Estratégia Demo"). Nenhuma fixture real, conta ou resultado real é usado.

## O que mostra (abas)
> 10/10/2026: a aba **Origem (E5b)** foi acrescentada e a Visão geral foi atualizada (9 camadas; E5b, E5.3 e a ordem em empates deixaram de ser pendências).

| Aba | Conteúdo |
|---|---|
| Visão geral | As 8 camadas (ingestão, canonical, reconstrução, timezones, métricas, identidade, Evidence, verificação V0–V4) com estado **Concluído / Parcialmente verificável / Pendente / Fora de escopo**, base e limites de cada uma, e uma **sonda ao vivo** que roda o código real. Lista o que ainda NÃO existe (E5b, E5.3, E6, Prisma, parser EN…). |
| Trilha do trade | `TradeEvidence → SourceRowRef → ImportRef` de cada um dos 14 ciclos: ids, rowHash, preços, componentes financeiros, R, reconstrução (confiança, borda, ambiguidades), pernas, linhas de origem, origem de cada campo. |
| Métricas | As 39 métricas do motor (NET/GROSS, R líquido/pontos), contribuintes por papel, agrupamentos (conta, hora, direção, dia da semana, estratégia). |
| EvidenceBundle | Gera o bundle de qualquer métrica (total ou grupo; população completa `FULL` ou acima do limite `HASH_ONLY`): `evidenceHash`, `tradeSetHash`, `MetricEvidence`, trades, imports, JSON. |
| Verificador | O relatório REAL de `verifyEvidence` (31 checks: nível, id, status, código, explicação) e os 4 veredictos (`VALID`, `TAMPERED`, `UNVERIFIABLE`, `INVALID_FORMAT`). `SKIPPED` nunca aparece como aprovado. |
| Adulteração | 18 cenários executados de verdade (computeEvidenceHash + verifyEvidence), com o JSON alterado, selo antes/depois e o que acusou. Inclui o cenário **coordenado**: `VALID`, que é o limite documentado (o selo não é assinatura; só o CSV original — E5b — denuncia). |
| Origem (E5b) | `verifyEvidenceSource` ao vivo sobre **11 cenários sintéticos** (arquivo íntegro, 1 byte alterado, célula financeira modificada, hash de arquivo divergente, `importId` / `rowHash` / `tradeId` divergentes, **bundle forjado com P&L alterado e selo recalculado**, população parcial `HASH_ONLY`, arquivo ausente, versão do parser incompatível). A tabela compara `verifyEvidence` (V0–V4) × E5b e o detalhe mostra 9 passos: bundle · arquivo (só metadados) · SHA-256 · reexecução da ingestão · `importId` · `rowHash` linha a linha · `tradeId` · valores derivados · resultado final com cobertura e limitações. Legenda dos estados `SOURCE_VERIFIED`, `SOURCE_VERIFIED_PARTIAL` (**nunca** 'população inteira'), `SOURCE_MISMATCH`, `UNVERIFIABLE`. O estado mostrado é o devolvido pela função; os bytes do CSV nunca vão para a página. |

## Proteção de produção (no servidor, 4 camadas)
Regra única: `NODE_ENV === "development"` (allowlist em `src/lib/dev/evidence-lab/guard.ts`). Qualquer outro valor — `production`, `test`, vazio — recusa.
1. `src/proxy.ts`: a exceção de login para `/dev/evidence-lab` só vale com o guard aberto. Em produção o fluxo de autenticação é o de sempre (anônimo → `/login`).
2. `layout.tsx` → `notFound()`.
3. `page.tsx` → `notFound()` (e o título/metadata só existe com o guard aberto: a 404 de produção não revela nada).
4. `buildDemo`/`runScenario`/`metricsView`/`buildBundle`… chamam `assertEvidenceLabEnabled()` (não confiam no chamador).

**Não há endpoint de API**: a página é renderizada no servidor e a navegação é por parâmetros de URL. Sem banco/Prisma/auth, sem as fixtures reais, sem dependência nova.

Verificado em `next build` + `next start` (`NODE_ENV=production`): anônimo → 307 `/login`; logado (cookie de sessão válido) → **404** em `/dev/evidence-lab`, em qualquer querystring e subcaminho, sem vazar título nem dados; `/api/dev/evidence-lab` → 404.

## Testes
`scripts/test-evidence-lab.mts` (no `npm run test:domain`): guard (allowlist), recusa com `NODE_ENV=production` em todos os construtores, pontos de entrada, isolamento (imports), dados sintéticos, fidelidade ao domínio (métricas, bundle, selo, cenários = chamadas diretas) e estados da visão geral.

## Aba Origem (E5b) — como funciona e o que garante
- **Funções reais:** `src/lib/dev/evidence-lab/source.ts` roda `verifyEvidenceSource` e `verifyEvidence` (e a mesma `runImportPipeline`, com o contexto do `ImportRef`, só para mostrar as tabelas "declarado × reingestão"). Nada de JSON estático: um teste refaz 3 cenários à mão fora do Lab e compara.
- **Sintético e sem persistência:** o CSV é o do Lab (inventado); fica no servidor, nunca é enviado à página (a aba mostra tamanho, SHA-256, BOM e quebra de linha). Não há upload nem endpoint: os cenários são parâmetros de URL (`?tab=source&src=forged`).
- **Produção:** o mesmo guard em 4 camadas (`NODE_ENV === "development"`, no servidor); `sourceContext`/`runSourceScenario`/`runAllSourceScenarios` recusam fora de desenvolvimento.
- **Testes:** `scripts/test-evidence-lab-source.mts` (8) e `scripts/test-evidence-lab.mts` (atualizado: 9 camadas).
- **Achado de privacidade (pré-existente, E3):** `reconstruction.cycleKey.strategy` leva o **nome da estratégia em texto aberto** no bundle (só a conta é substituída por `accountRef`). O teste do Lab trava que a estratégia só aparece nesse campo. Corrigir exige decisão (muda o schema/`evidenceHash`).

