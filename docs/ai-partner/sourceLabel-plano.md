# MeuTrade — Plano: lista fechada de rótulos + token (`sourceLabel`) — SÓ PLANO, nada implementado

> Status: **plano APROVADO com decisões A–E (12/10/2026); S0 = arquivo de expectativas commitado antes do código; S1+ NÃO iniciados.**
> (Texto original abaixo, ajustado às decisões; a seção 0 resume o que mudou.) Proposta original de Decisão anterior do Marcelo: **lista fechada de rótulos permitidos** (Entry, Target<n>, Stop<n>, Zerar/Flat/Close, vazio) + **hash/token** para qualquer coisa fora da lista. Este documento desenha *como*; as escolhas abertas estão na §9. Nenhum código foi alterado.
> Pré-requisito do E6.5 e de qualquer integração com a Vega IA. Repo público: sem dados reais.

## 0. Decisões do Marcelo (12/10/2026) e o que mudaram no plano
| | Decisão | Efeito no plano |
|---|---|---|
| A | Vocabulário **estrito às 2 fixtures reais**, sem nomes padrão do NT8 | v1 = vazio, `Entry`, `Target<n>`, `Stop<n>`, `Zerar`. **`Flat` e `Close` saem da lista** (as regras de motivo continuam classificando-os como MANUAL; na Evidence viram token). Nomes NT8 padrão (`Stop loss`, `Profit target`, `Buy`, `Sell`…) ficam para uma v2 só se aparecerem num export real. |
| B | Sufixo `\d{0,2}` | `Target`…`Target99`; `Target100` ⇒ token. |
| C | Tratar `exitReasonMap` do `reproducibility` na mesma etapa | **Cabe, com +2 passos (S2b, S4b) e uma mudança de semântica no E5b — ver §6.1.** Escopo avisado, sem atraso estrutural. |
| D | Registrar `labelVocab: 1` no `ImportRef` | Campo opcional no `ImportRef` (fora do `importId`), emitido sempre pelos bundles novos. **Consequência (corrige a §7 original): o `evidenceHash` de TODOS os bundles novos muda** (campo novo, como no §14.12); a prova de que nada além disso mudou é: remover `labelVocab` e recalcular o selo reproduz exatamente o `evidenceHash` de baseline (pinado em `sourcelabel.expected.json`). |
| E | Documentar já: token **sem sal é adivinhável por dicionário**; política de sal por usuário **pendente**, vale para `accountRef`, `strategyRef`, `labelRef` e `patternRef` juntos | Documentado em `data-contract.md` §14.14 e `CHANGELOG-contratos.md`. Nenhuma exigência nova de sal; quem verifica continua precisando do sal quando o import o usou. |

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
| alvo | `^target\d{0,2}$` | o texto original (ex.: `Target1`) |
| stop | `^stop\d{0,2}$` | o texto original (ex.: `Stop2`) |
| manual | `^zerar$` | o texto original (**`Flat`/`Close` NÃO estão na v1**: decisão A) |
| **qualquer outra coisa** | — | **token** `lbl_<24 hex>` |

- O texto original só é devolvido quando pertence ao vocabulário (fechado, não sensível), **já sem espaços nas pontas**. Variações de caixa/acento (`ZERAR`, `Zérar`) casam e saem como vieram (aparados).
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

### 6.1 Decisão C — `exitReasonMap` do usuário (mudança de semântica no E5b)
- **Hoje:** `ImportRef.reproducibility.exitReasonMap[] = { pattern, reason }` leva o **regex do usuário em claro**, e o E5b o **usa para reingerir** (`sourceContextOf`, `verify-source.ts`).
- **Plano:** a Evidence passa a carregar `{ patternRef, reason }`, com `patternRef = "pat_" + SHA-256("meutrade/patternRef/1" ‖ sal ‖ pattern).hex.slice(0,24)`. O regex fica **só no `ImportRecord` interno**.
- **Consequência para o E5b (dita, não escondida):** sem o padrão em claro no bundle, ele deixa de poder reingerir sozinho um import que tinha mapa **não vazio**. O chamador passa o mapa (opção `exitReasonMap`, que já existe para imports anteriores) e o E5b **confere cada padrão contra o `patternRef` registrado**; mapa ausente ou divergente ⇒ `UNVERIFIABLE` (`S_CONTEXT_INSUFFICIENT`, **nunca** adulteração). Imports com **mapa vazio** (todas as fixtures reais e sintéticas atuais) não mudam em nada. É a mesma lógica do sal: o segredo/dado do usuário não viaja no bundle; quem verifica precisa tê-lo.
- **Reprodução do registro:** `recordDiffs` compara o `reproducibility` da reingestão com o do bundle; a reingestão passa a ser **projetada** (mesma função) antes de comparar.
- **Tamanho:** +2 passos no cronograma (S2b projeção/schema do `ImportRef`; S4b E5b com mapa fornecido/ausente/divergente). Não muda `importId`/`rowHash`/`tradeId`.

## 7. Impacto em hashes (a medir, não supor)
- `importId`, `rowHash`, `tradeId`, `tradeSetHash`, métricas, derivados: **idênticos** (o Canonical e o fingerprint não usam a projeção).
- `evidenceHash`: **muda em todos os bundles novos** pelo campo `labelVocab` (decisão D) — e, **além disso**, só muda quando havia texto livre (token) ou mapa de usuário (`patternRef`). Prova de que nada mais mudou: bundle novo **sem** a chave `labelVocab`, com selo recalculado, = `evidenceHash` de baseline pinado antes do código. Não há bundle persistido hoje (sem banco), então nenhuma migração.
- Compatibilidade: bundles antigos com texto livre passam a ser `INVALID_FORMAT` — aceitável (nenhum existe fora de testes); registrar no `CHANGELOG-contratos.md`.

## 8. Entregas (um commit local cada; expectativas ANTES do código — protocolo de `scripts/expectations/`)
| Passo | Conteúdo | Parada para revisão |
|---|---|---|
| S0 | `scripts/expectations/sourcelabel.expected.json` (tabela rótulo → saída, V0, E5b, hashes pinados) **commitado antes** do código | sim |
| S1 | `labelRef` + `projectLabel` + testes unitários (tabela, acento/caixa, token determinístico, domínio separado, sal) | — |
| S2 | Projeção em `explain-trade` + schemas da Evidence com regex (V0 rejeita texto livre) + `labelVocab` no `ImportRef` | — |
| S2b | (decisão C) `patternRef` no lugar do regex do usuário no `ImportRef`; regex só no registro interno | — |
| S3 | Provas de não regressão: `importId/rowHash/tradeId/tradeSetHash` pinados; `evidenceHash` idêntico em bundles padrão; baselines 5.238/36 e E5b 273/7/8; derivados/V6 intactos | sim |
| S4b | (decisão C) E5b: mapa de usuário fornecido (confere por `patternRef`) / ausente / divergente ⇒ `UNVERIFIABLE`; mapa vazio inalterado | sim |
| S4 | E5b com tokens (CSV sintético com texto livre inventado; reingestão reproduz; token adulterado detectado); fixtures reais (0 não-padrão ⇒ sem mudança) | — |
| S5 | Lab: `redactLabels`/`maskLabel` passam a mostrar padrão ou token (texto livre inexistente na Evidence); cenário novo "rótulo livre ⇒ token" | — |
| S6 | Docs: `data-contract.md`, `CHANGELOG-contratos.md`, checkpoint; atualizar `L_*` e a pendência `sourcelabel` | sim |

### Andamento (atualizado a cada passo)
| Passo | Estado |
|---|---|
| S0 (`f36268f`) e S0b (`2ee6c2f`) | **feitos** — expectativas e 9 pins de baseline escritos antes do código |
| S1 | **feito** — `labelRef` (`ingest/identity.ts`) e `projectLabel`/`isVocabLabel`/`isProjectedLabel` (`evidence/label-vocab.ts`) + `test-evidence-label-vocab.mts` (11). **Não ligado** ao `explain-trade`/schema (isso é o S2): nenhum comportamento existente muda |
| S2, S2b, S3, S4, S4b, S5, S6 | pendentes |
Observação do S1: a projeção **não é idempotente de propósito** (projetar um token gera outro token): ela se aplica uma única vez, ao texto canônico; assim um rótulo escrito pelo usuário que imite um token não se passa por outro rótulo.

## 9. Decisões (todas respondidas em 12/10/2026 — ver §0)
A estrito às 2 fixtures · B `\d{0,2}` · C sim (com S2b/S4b e a semântica da §6.1) · D sim (`labelVocab: 1`) · E documentar e adiar a política de sal (vale para `accountRef`, `strategyRef`, `labelRef` e `patternRef`).
**Ainda sem política de sal por usuário:** hoje o sal é opcional e por import; sem ele, `accountRef`, `strategyRef`, `labelRef` e `patternRef` são **adivinháveis por dicionário** para textos curtos/comuns. Isso é limite documentado, não corrigido.

## 10. Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Perda de verificabilidade do motivo | `reason`/`reasonRule` continuam na Evidence; E5b reingere e compara (testado no S4). |
| Descasamento prefixo × lista fechada confunde (`StopX` = STOP mas token) | Dito no doc/Lab; `reason` aparece junto do token. |
| Token adivinhável (texto curto, sem sal) | Documentado (§9/E) como pseudônimo; política de sal por usuário pendente e comum a todos os refs. |
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
