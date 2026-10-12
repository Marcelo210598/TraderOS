# MeuTrade AI Partner — CHANGELOG de contratos (Evidence e verificadores)

Registra **mudanças de contrato** observáveis por quem lê os tipos/relatórios (campos, estados, hashes). Ordem: mais recente primeiro. `evidence/1` nunca virou `evidence/2`: todas as mudanças abaixo são aditivas, salvo onde dito.

## 2026-10-12 — E5b conserto: citação de perna não conferida (`V5.derived`)
- **Comportamento (corrige falha minha):** perna citada por um derivado cujo trade não está no bundle (ou não foi conferido com a fonte) passava como `PASS`. Agora ⇒ `SKIPPED S_POPULATION_PARTIAL` ⇒ `SOURCE_VERIFIED_PARTIAL`, com a contagem dita no detalhe; `coverage.derived.partial` conta o derivado uma só vez.
- Divisão de responsabilidade documentada: o E5b confere **cada** citação contra a reingestão; **completude, ordem e duplicidade da lista** de citações são do V6 (recálculo).

## 2026-10-12 — E5b para derivados (`10e3ec9`)
- **Novo check** `V5.derived` (catálogo do E5b: 8 → 9). Sem derivados: `SKIPPED S_NOT_APPLICABLE` (não é PASS).
- **Novo campo** `SourceCoverage.derived { total, full, hashOnly, partial, trades{declared,inBundle,verified}, legRefs{declared,verified}, scope:"DECLARED_POPULATION" }`.
- **MUDANÇA DE SEMÂNTICA (aditiva, mas observável):** `SourceCoverage.populations.complete` passou a considerar também os derivados: `complete = (metrics + derivados) > 0 && nenhuma população HASH_ONLY/parcial`. **Antes, um bundle só com derivados dava sempre `false`** (o campo exigia `metrics.length > 0`). `populations.metrics/full/hashOnly` continuam só de métricas. `complete` significa "população **declarada** listada", não "importação inteira" nem "conferida".
  - Leitores no código (auditados em 12/10): `source-panel.tsx` (só exibe "completa/NÃO completa") e `derived-panel.tsx` (idem); testes: `test-evidence-source.mts` (true para métrica FULL; deepEqual com `complete:false` para HASH_ONLY), `test-evidence-lab-source.mts` (false para parcial). **Nenhum** código ou teste anterior assumia `false` para bundle só com derivados (não existia esse bundle antes do E6.3).
- **Nova limitação** `L_DERIVED_POPULATION_SCOPE` (só em relatórios de bundles com derivados; bundles sem derivados mantêm as 5 anteriores).
- **Novos códigos:** `V_DERIVED_LEG_REF_MISMATCH` (FAIL), `S_DERIVED_TRADES_NOT_VERIFIED` (SKIPPED bloqueante).

## 2026-10-12 — E6.3 Evidence dos derivados + V6 (`7998aab`)
- `evidence/1`: `evidence.derived?` opcional; `claim.kind` e `subject.type` ganham `"DERIVED"`. `evidenceHash` de bundles **sem** derivados: inalterado (testado).
- `verifyEvidence`: 8 checks V6; catálogo 31 → 39 (sem derivados, todos `S_NOT_APPLICABLE`; status dos bundles antigos inalterado).

## 2026-10-12 — E6.0 (`82a52c2`)
- `reconstruction.cycleKey.strategy` → `cycleKey.strategyRef` (**muda o `evidenceHash` de bundles novos**); filtros `strategyId/strategyName` → `strategyIdRefs/strategyNameRefs`; chave de grupo `strategy` → ref; erro `E_STRATEGY_NAME_LEAK`.
