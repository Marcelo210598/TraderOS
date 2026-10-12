# MeuTrade — Plano: lista fechada de rótulos + token (`sourceLabel`) — SÓ PLANO, nada implementado

> Status: **proposta para aprovação** (12/10/2026). Decisão do Marcelo já tomada: **lista fechada de rótulos permitidos** (Entry, Target<n>, Stop<n>, Zerar/Flat/Close, vazio) + **hash/token** para qualquer coisa fora da lista. Este documento desenha *como*; as escolhas abertas estão na §9. Nenhum código foi alterado.
> Pré-requisito do E6.5 e de qualquer integração com a Vega IA. Repo público: sem dados reais.

## 1. Problema (verificado no código e nas fixtures)
- O texto do nome da ordem (NT8 `Entry`/`Exit`) entra no Canonical em `entryLegs[].sourceLabel` / `exitLegs[].sourceLabel` e em `RowMeta.entryLabel/exitLabel`.
- A Evidence (E3) o **copia em texto aberto** para: `TradeEvidence.entryLegs[].sourceLabel`, `exitLegs[].sourceLabel`, `sourceRows[].entryLabel`, `sourceRows[].exitLabel`. O E5b precisa deles para reconferir o motivo e os valores contra o CSV.
- O NT8 deixa o usuário nomear ordens livremente (`ExitLong("meu texto")`): em tese pode haver texto livre (nomes de setup, de pessoas, de contas) dentro do bundle.
- **Medição nas 2 fixtures reais locais (12/10):** 50 pernas, 5 classes: vazio 20 · Entry 12 · Stop<n> 8 · Zerar 7 · Target<n> 3 · **texto livre 0**. Logo, hoje o risco é **potencial** (outros usuários), não observado. Nas fixtures o `UNKNOWN` é rótulo **vazio**, não texto estranho.
- Vetores relacionados (mesma família, a decidir junto): **(a)** `ImportRef.reproducibility.exitReasonMap[].pattern` — regex **escrita pelo usuário** que pode embutir texto de rótulo; **(b)** `rowHash` e `tradeId` incluem o rótulo no hash (não reversível, mas adivinhável por dicionário para textos curtos) — fora de escopo, não muda.

## 2. Princípios
1. O **Canonical interno não muda** (guarda o texto original): motivo de saída, `rowHash`, `tradeId`, `importId`, `tradeSetHash` e todas as métricas **ficam idênticos**.
2. Só muda a **projeção para a Evidence** (`explainTrade`): o que sai é `padrão` ou `token`, nunca texto livre.
3. A verificação da origem **continua possível**: o E5b reingere o CSV, projeta com a MESMA função e compara (tokens determinísticos).
4. O schema `evidence/1` passa a **rejeitar** texto livre (garantia no V0, não só convenção).
5. Mantém leitura humana nos casos comuns (padrões legíveis) e o motivo (`reason`/`reasonRule`) continua visível.

## 3. Vocabulário fechado (v1)
Normalização para comparar: remover acentos, `trim`, minúsculas (a mesma `normalizeLabel` já usada pelas regras de motivo). Casamento **estrito** (a string inteira):

| Classe | Padrão (após normalizar) | O que sai na Evidence |
|---|---|---|
| vazio | `^$` | `""` (vazio é preservado: explica `UNKNOWN`) |
| entrada | `^entry$` | o texto original (ex.: `Entry`) |
| alvo | `^target\d{0,3}$` | o texto original (ex.: `Target1`) |
| stop | `^stop\d{0,3}$` | o texto original (ex.: `Stop2`) |
| manual | `^(zerar\|flat\|close)$` | o texto original |
| **qualquer outra coisa** | — | **token** `lbl_<24 hex>` |

- O texto original só é devolvido quando pertence ao vocabulário (fechado, não sensível). Variações de caixa/acento (`ZERAR`, `Zérar`) casam e saem como vieram.
- **Atenção a um descasamento real:** as regras de motivo (`ingest/exit-reason.ts`) usam **prefixo** (`^target`, `^stop`). Um rótulo `StopLossCustom` é classificado `STOP`, mas **não** está na lista fechada ⇒ sai como token (o motivo `STOP` continua aparecendo e verificável). Isso é intencional: a lista de *exibição* é mais estreita que a de *classificação*.

## 4. Token
`labelRef(texto, sal) = "lbl_" + SHA-256("meutrade/labelRef/1" ‖ sal ‖ normalizeLabel(texto)).hex.slice(0, 24)`
- Determinístico, com **domínio próprio** (≠ `accountRef`/`strategyRef`), **mesmo sal** do `accountRefSalt` (um único segredo de importação, nunca gravado).
- Mesmo texto normalizado ⇒ mesmo token (permite agrupar sem ver o texto). **Limite honesto:** é pseudônimo, não anonimização — sem sal, textos curtos/comuns são adivinháveis por dicionário (idêntico ao `accountRef`). Documentar, não esconder.
- Implementação prevista: `src/lib/ingest/identity.ts` (`labelRef`) + `src/lib/evidence/label-vocab.ts` (`projectLabel`, `LABEL_VOCAB_VERSION = 1`). Sem dependência nova; reusa `sha256Hex`.

## 5. Onde aplicar (só a projeção)
`src/lib/evidence/explain-trade.ts`: `entryLegOf`/`exitLegOf` (`sourceLabel`) e a montagem de `SourceRowRef` (`entryLabel`, `exitLabel`) passam por `projectLabel(label, sal)`. Nada mais lê o Canonical para a Evidence. O E5b não muda de lógica: já compara `explainTrades(reingestão)` × bundle; ambos projetam igual.

## 6. Schema e verificação
- Hoje as pernas da Evidence **reaproveitam** `EntryLegSchema/ExitLegSchema` do Canonical. Plano: schemas **específicos da Evidence** (estendem os do Canonical) em que `sourceLabel` é validado por `z.string().regex(...)`: vocabulário **ou** `lbl_[0-9a-f]{24}` **ou** `null`/`""`. Idem `entryLabel/exitLabel` em `SourceRowRef`.
- Consequência desejada: um bundle com texto livre é **`INVALID_FORMAT` no V0** — a garantia é do verificador, não de convenção.
- E5b: sem mudança de lógica; novo teste prova que tokens são reproduzidos (`SOURCE_VERIFIED`) e que um token adulterado dá `SOURCE_MISMATCH` (`V5.values`).
- **Sal:** com sal no import, a verificação já exige o sal (accountRef). Tokens passam a depender dele também (mesma exigência, nenhuma nova).
- Versão do vocabulário: registrar **`labelVocab: 1`** como campo opcional no `ImportRef` (fora do `importId`; ausente = v1) para que uma lista futura (v2) não torne bundles v1 irreprodutíveis em silêncio. (Decisão §9-D.)

## 7. Impacto em hashes (a medir, não supor)
- `importId`, `rowHash`, `tradeId`, `tradeSetHash`, métricas, derivados: **idênticos** (o Canonical e o fingerprint não usam a projeção).
- `evidenceHash`: **idêntico** para bundles em que todos os rótulos já são padrão (caso das 2 fixtures e dos CSVs sintéticos); **muda** só quando havia texto livre (passa a token). Não há bundle persistido hoje (sem banco), então nenhuma migração.
- Compatibilidade: bundles antigos com texto livre passam a ser `INVALID_FORMAT` — aceitável (nenhum existe fora de testes); registrar no `CHANGELOG-contratos.md`.

## 8. Entregas (um commit local cada; expectativas ANTES do código — protocolo de `scripts/expectations/`)
| Passo | Conteúdo | Parada para revisão |
|---|---|---|
| S0 | `scripts/expectations/sourcelabel.expected.json` (tabela rótulo → saída, V0, E5b, hashes pinados) **commitado antes** do código | sim |
| S1 | `labelRef` + `projectLabel` + testes unitários (tabela, acento/caixa, token determinístico, domínio separado, sal) | — |
| S2 | Projeção em `explain-trade` + schemas da Evidence com regex (V0 rejeita texto livre) | — |
| S3 | Provas de não regressão: `importId/rowHash/tradeId/tradeSetHash` pinados; `evidenceHash` idêntico em bundles padrão; baselines 5.238/36 e E5b 273/7/8; derivados/V6 intactos | sim |
| S4 | E5b com tokens (CSV sintético com texto livre inventado; reingestão reproduz; token adulterado detectado); fixtures reais (0 não-padrão ⇒ sem mudança) | — |
| S5 | Lab: `redactLabels`/`maskLabel` passam a mostrar padrão ou token (texto livre inexistente na Evidence); cenário novo "rótulo livre ⇒ token" | — |
| S6 | Docs: `data-contract.md`, `CHANGELOG-contratos.md`, checkpoint; atualizar `L_*` e a pendência `sourcelabel` | sim |

## 9. Decisões abertas (preciso do Marcelo antes do S0)
- **A. Amplitude do vocabulário.** Só o que as fixtures mostram (Entry/Target/Stop/Zerar/Flat/Close) ou também os nomes **padrão do NT8**: `Stop loss`, `Profit target`, `Exit on session close`, `Buy`, `Sell`? Recomendo **começar estrito** (v1 = tabela da §3) e acrescentar na v2 só o que aparecer num export real — hoje não há evidência de que os outros ocorram, e cada item novo amplia o texto que sai em claro.
- **B. Sufixo numérico:** `\d{0,3}` (Target1…Target999) ou limite menor (`\d{0,2}`)? Recomendo `\d{0,2}`.
- **C. `exitReasonMap[].pattern` do usuário** (vetor 1.a): tratar na mesma etapa (recomendo **sim**): aceitar na Evidence só a *forma* (`reason` + hash do padrão) e manter o regex só no registro interno do import; hoje ele sai em texto aberto no `ImportRef.reproducibility`.
- **D. Registrar `labelVocab` no `ImportRef`** (recomendo sim, opcional, fora do `importId`).
- **E. Token sem sal** quando o import não usou sal: aceitar o limite (dicionário) e documentar, ou **exigir sal** para exportar bundles com rótulo não-padrão? Recomendo documentar e deixar para a política de produto (sal por usuário) antes do agente.

## 10. Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Perda de verificabilidade do motivo | `reason`/`reasonRule` continuam na Evidence; E5b reingere e compara (testado no S4). |
| Descasamento prefixo × lista fechada confunde (`StopX` = STOP mas token) | Dito no doc/Lab; `reason` aparece junto do token. |
| Token adivinhável (texto curto, sem sal) | Documentado como pseudônimo; sal recomendado; decisão E. |
| Bundles futuros com vocabulário v2 | `labelVocab` no `ImportRef` (decisão D). |
| Quebrar algo que lê o texto | Auditoria dos leitores feita em 12/10 (`grep` em `src/`): quem **lê** o rótulo para a Evidence é `evidence/explain-trade.ts` (`entryLegOf`/`exitLegOf` e a montagem de `SourceRowRef`, linhas 68–104) e quem o **valida** é `evidence/schema.ts` (linhas 43–44); o E5b só compara via `explainTrades` (não lê o campo); `metrics/analysis.ts` e `metrics/legs.ts` apenas citam o nome em comentário; o resto é ingestão/Canonical (interno, inalterado), Lab e testes. |

## 11. Critérios de aceite
1. Nenhum texto fora do vocabulário em **nenhum** campo de **nenhum** bundle gerado (varredura automática em sintético, 2 fixtures reais e cenários do Lab).
2. V0 rejeita texto livre injetado (selo refeito).
3. `importId/rowHash/tradeId/tradeSetHash` e `evidenceHash` de bundles padrão **idênticos** ao baseline; métricas e V6 idênticos; E5b 273/7/8 e 5.238/36 preservados.
4. E5b reproduz tokens e detecta token adulterado.
5. `test:domain`, `tsc` (+`.mts`) e ESLint do escopo verdes; sem push/deploy/banco/Prisma.

## 12. Fora de escopo
E6.5, integração com a Vega IA, Prisma, persistência, UI de produto, E5c.
