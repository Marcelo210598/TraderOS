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
| Verificador | O relatório REAL de `verifyEvidence` (39 checks, V6 `S_NOT_APPLICABLE` em bundles sem derivados: nível, id, status, código, explicação) e os 4 veredictos (`VALID`, `TAMPERED`, `UNVERIFIABLE`, `INVALID_FORMAT`). `SKIPPED` nunca aparece como aprovado. |
| Adulteração | 18 cenários executados de verdade (computeEvidenceHash + verifyEvidence), com o JSON alterado, selo antes/depois e o que acusou. Inclui o cenário **coordenado**: `VALID`, que é o limite documentado (o selo não é assinatura; só o CSV original — E5b — denuncia). |
| Origem (E5b) | `verifyEvidenceSource` ao vivo sobre **11 cenários sintéticos** (arquivo íntegro, 1 byte alterado, célula financeira modificada, hash de arquivo divergente, `importId` / `rowHash` / `tradeId` divergentes, **bundle forjado com P&L alterado e selo recalculado**, população parcial `HASH_ONLY`, arquivo ausente, versão do parser incompatível). A tabela compara `verifyEvidence` (V0–V4) × E5b e o detalhe mostra 9 passos: bundle · arquivo (só metadados) · SHA-256 · reexecução da ingestão · `importId` · `rowHash` linha a linha · `tradeId` · valores derivados · resultado final com cobertura e limitações. Legenda dos estados `SOURCE_VERIFIED`, `SOURCE_VERIFIED_PARTIAL` (**nunca** 'população inteira'), `SOURCE_MISMATCH`, `UNVERIFIABLE`. O estado mostrado é o devolvido pela função; os bytes do CSV nunca vão para a página. |
| Derivados (E6) | **12/10/2026 (E6.4).** A Evidence dos derivados do E6.2 (ranking, contribuição, comparação, motivo de saída por perna/trade) e o **V6**, sobre um CSV sintético próprio (21 linhas → 13 ciclos, com alvo, stop, manual, saídas mistas e rótulos desconhecidos). **17 cenários** executados de verdade (explainDerived → selo → `verifyEvidence` V0–V6 → `verifyEvidenceSource`): íntegros (ranking, comparação de contas e de semanas, análise por motivo com UNKNOWN/MIXED, STOP×TARGET nas pernas, ranking de pernas, amostra pequena, métrica indisponível, divergência perna×trade), adulterações com selo refeito (valor, delta, confiança/reconciliação escondida, referência inválida, dimensão trocada) e limites (HASH_ONLY, versão incompatível, dimensão sem referência). Mostra: operação, **unidade (TRADE / LEG / TRADE_AND_LEG, nunca misturadas)**, dimensões, filtros e opções (conta/estratégia só como ref), período, população e `tradeSetHash`, `evidenceHash`, ranking/comparação com contribuição, deltas, razões, amostra, cobertura, `sampleFlag`, confiança, limitações (com texto em português) e reconciliação; os **8 checks do V6** (PASS/FAIL/SKIPPED — SKIPPED aparece como “não verificado”, com o código e a explicação); a distinção entre *reproduzido*, *adulterado*, *não verificável* e *limitações de confiança*; o E5b do mesmo bundle (que pode discordar do V6: no cenário de divergência o V6 reproduz e o E5b acusa `SOURCE_MISMATCH`); e a **navegação do derivado até os TradeEvidence** (trades, pernas com motivo/regra/valores, linhas). **Rótulos de origem (`sourceLabel`, `entryLabel`, `exitLabel`) nunca são exibidos** (JSON com `«omitido»`). |

## Proteção de produção (no servidor, 4 camadas)
Regra única: `NODE_ENV === "development"` (allowlist em `src/lib/dev/evidence-lab/guard.ts`). Qualquer outro valor — `production`, `test`, vazio — recusa.
1. `src/proxy.ts`: a exceção de login para `/dev/evidence-lab` só vale com o guard aberto. Em produção o fluxo de autenticação é o de sempre (anônimo → `/login`).
2. `layout.tsx` → `notFound()`.
3. `page.tsx` → `notFound()` (e o título/metadata só existe com o guard aberto: a 404 de produção não revela nada).
4. `buildDemo`/`runScenario`/`metricsView`/`buildBundle`… chamam `assertEvidenceLabEnabled()` (não confiam no chamador).

**Não há endpoint de API**: a página é renderizada no servidor e a navegação é por parâmetros de URL (a aba Derivados usa `?tab=derived&dv=<cenário>&dvt=<trade>`; **nenhuma rota nova** — a proteção de produção é a mesma da página). Sem banco/Prisma/auth, sem as fixtures reais, sem dependência nova.

Verificado em `next build` + `next start` (`NODE_ENV=production`): anônimo → 307 `/login`; logado (cookie de sessão válido) → **404** em `/dev/evidence-lab`, em qualquer querystring e subcaminho, sem vazar título nem dados; `/api/dev/evidence-lab` → 404.

## Testes
`scripts/test-evidence-lab.mts` (no `npm run test:domain`): guard (allowlist), recusa com `NODE_ENV=production` em todos os construtores, pontos de entrada, isolamento (imports), dados sintéticos, fidelidade ao domínio (métricas, bundle, selo, cenários = chamadas diretas) e estados da visão geral.

## Aba Origem (E5b) — como funciona e o que garante
- **Funções reais:** `src/lib/dev/evidence-lab/source.ts` roda `verifyEvidenceSource` e `verifyEvidence` (e a mesma `runImportPipeline`, com o contexto do `ImportRef`, só para mostrar as tabelas "declarado × reingestão"). Nada de JSON estático: um teste refaz 3 cenários à mão fora do Lab e compara.
- **Sintético e sem persistência:** o CSV é o do Lab (inventado); fica no servidor, nunca é enviado à página (a aba mostra tamanho, SHA-256, BOM e quebra de linha). Não há upload nem endpoint: os cenários são parâmetros de URL (`?tab=source&src=forged`).
- **Produção:** o mesmo guard em 4 camadas (`NODE_ENV === "development"`, no servidor); `sourceContext`/`runSourceScenario`/`runAllSourceScenarios` recusam fora de desenvolvimento.
- **Testes:** `scripts/test-evidence-lab-source.mts` (8) e `scripts/test-evidence-lab.mts` (atualizado: 9 camadas).
- **Achado de privacidade do E3 — RESOLVIDO no E6.0 (12/10/2026):** `reconstruction.cycleKey.strategy` (nome em texto aberto) virou `cycleKey.strategyRef`; o teste do Lab agora trava que o nome da estratégia **não aparece em lugar nenhum** do bundle (`data-contract.md` §15.1).



## Aba Derivados (E6) — como funciona e o que garante
- **Funções reais:** `src/lib/dev/evidence-lab/derived.ts` roda `explainDerived` (E6.2 + visão por refs), `computeEvidenceHash` (adulterações refazem o selo como um atacante), `verifyEvidence` (V0–V6) e `verifyEvidenceSource` (E5b). Nenhum resultado em JSON estático (teste compara selo, veredito e origem com chamadas diretas; o ranking guardado = `rankGroups` direto).
- **Sintético e sem persistência:** `derivedDemoCsv()` (inventado; contas “Conta Demo A/B”, estratégia “Estratégia Demo”); bytes ficam no servidor; sem upload, sem banco/Prisma, sem fixtures reais, sem dashboard.
- **Privacidade:** conta e estratégia só como `accountRef`/`strategyRef`; rótulos de origem **omitidos** na interface (`redactLabels`) e nunca lidos pelo painel; nenhum bundle completo é enviado a IA nesta etapa (a Vega IA não é tocada).
- **Produção:** mesma regra única (`NODE_ENV === "development"`) e as mesmas 4 camadas; os construtores novos recusam fora de dev. **Verificado em `next build --webpack` + `next start` (NODE_ENV=production, cópia isolada, apagada depois):** anônimo → 307 `/login`; com sessão válida → **404** em `/dev/evidence-lab`, `?tab=derived`, `?tab=derived&dv=…&dvt=…` e `/dev/evidence-lab/x`; `/api/dev/evidence-lab` → 401 anônimo / 404 logado; sem vazar título nem dados.
- **Validação em desenvolvimento (porta do `next dev`):** as 17 páginas de cenário e as 7 abas anteriores respondem 200; no HTML renderizado, 0 ocorrências de nome de conta/estratégia ou de rótulos de ordem.
- **Testes:** `scripts/test-evidence-lab-derived.mts` (9) no `test:domain`; `test-evidence-lab.mts` (camada nova: 10 camadas; pendências E6.5 e `sourceLabel`).
- **Pendência registrada (antes da integração do agente):** revisão específica para minimizar ou substituir o `sourceLabel` nos `TradeEvidence` (o E5b depende dele), mantendo a verificação da origem. Nenhum bundle completo vai à Vega IA.
