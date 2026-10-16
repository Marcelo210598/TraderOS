# E7 — Persistência e servidor do agente: LEVANTAMENTO (16/10/2026)

> **Só levantamento.** Nenhuma solução desenhada, nenhum código escrito, nada decidido. Cada fato diz de onde veio: **[código]** lido no repositório, **[medido]** número medido numa máquina (Mac 10 núcleos, 24 GB, Node 24.11.1) com fixtures sintéticas, **[doc]** lido nos documentos do projeto. O que **não** foi medido está marcado **NÃO MEDIDO**. As decisões estão na §6, para o Marcelo e o Gemini.

## 1. O que o agente exige do servidor (o `ctx` das capacidades) [código]

As 8 capacidades são funções puras; tudo o que é estado vem do **chamador** (o servidor da E7):

| O que | Quem usa | Observação |
|---|---|---|
| `trades` (AnalyticsTrade[]) e `importRecords` | as 6 analíticas | derivados do arquivo original pela pipeline (`runImportPipeline`) |
| `refEpoch` (= `saltId` vigente) | todas | rótulo não secreto, ex. `s1` |
| `accountRefSalt` (o VALOR do sal) | todas | só do servidor, nunca do modelo; import salgado sem sal ⇒ `ENGINE_REFUSED` |
| `analysis` (timeZone, minSample) | analíticas | preferências do USUÁRIO |
| `aliases` (tabela da conversa) | todas que resolvem/alocam alias | só `metrics.groups` e `rank.groups` ALOCAM; o chamador guarda a tabela devolvida |
| `source` ({ files por importId, options }) | todas | sem o arquivo ⇒ `NOT_VERIFIED` com texto estrutural (estado esperado até a E7) |
| `bundleOf(ref)` | `evidence.explain` | devolve o bundle SELADO do ref (ou null ⇒ `NOT_FOUND`) |
| `ledger`, `specOf(ref)`, `regenerated` | `evidence.refresh` | ledger da conversa; consulta original (capacidade + args) por ref; dados regerados com o sal NOVO + arquivo em `source` |

## 2. O que já existe, em código puro (nada persistido) [código]

- **Pipeline determinística:** `runImportPipeline(csv, { sourceTz, fileName, accountRefSalt })` ⇒ `ImportRecord` + trades canônicos. **Reimportar o mesmo arquivo dá o MESMO `importId`** [medido].
- **Ledger** imutável (`epoch` + `entries: evidenceRef → { capability, handle, view }`), **por conversa e por usuário**, sem `userId` dentro; `refreshEvidence` substitui a entrada STALE.
- **`SaltProvider`** (interface: `get(userId, saltId)`, `current(userId)`, `known(userId)`) com **chaveiro só em memória** (testes e Lab) [código `ingest/salt.ts`]. O doc da política de sal já diz: *"só o armazenamento real do chaveiro fica para a fase de persistência"* e *"perda do sal = perda de verificação dos refs daquele usuário, sem recuperação; backup do chaveiro é requisito"* [doc `salt-policy-plano.md`].
- **Alias por conversa** (`AliasTable` com 3 tipos fixos), recalculado por época.
- **`evidenceRef` = hash do bundle selado** (conteúdo endereçável).

## 3. O que NÃO existe hoje

- **O banco não tem nada disso** [código `prisma/schema.prisma`]: 20 modelos (User, Trade, TradingAccount, Setup, Subscription, UserApiKey, Challenge…), **nenhum** de import, Evidence, sal, ledger, conversa, mensagem ou execução de agente.
- **A produção não usa a pipeline nova.** Só `/dev/evidence-lab` (página de desenvolvimento) importa `lib/ingest`, `lib/evidence` e `lib/agent` [código]. A rota `trades/import` recebe **linhas já parseadas no cliente** (JSON) e faz `createMany` na tabela legada `trades`: **não guarda o arquivo, nem `tradeId` determinístico, nem pernas/rótulos de ordem, nem nome de estratégia** [código].
- **A tabela `trades` não reconstrói o trade canônico.** Tem preço/PnL/quantidade/conta/`setupId`/MFE/MAE; **não tem** fills, rótulos de saída, ciclos de posição nem hashes [código]. Portanto os trades do agente **não podem ser derivados das linhas atuais do banco**; precisam do **arquivo original** (ou de uma cópia canônica).
- **Não há armazenamento do arquivo original.** UploadThing existe, mas é para screenshots; o `source` das capacidades hoje só roda em teste.
- **Não há LLM no agente.** A "Vega" atual (`/api/ask-claude`, Haiku) despeja contexto direto e segue separada; o Agent V1 do desenho de fundação entraria em rota/flag separados (`AGENT_V1_ENABLED`) [doc `MEUTRADE-AI-technical-foundation.md` §J.3].
- **Não há `Conversation`/`Message`/`AgentRun`** (previstos na §J.3 da fundação: conteúdo estruturado + `evidenceRefs`, modelo, tokens, custo, tools, versão do prompt).

## 4. Medidas [medido, fixtures sintéticas de 1 perna/trade]

| Item | 500 trades | 5.000 trades |
|---|---|---|
| Arquivo CSV original | 96 KB | 964 KB |
| `ImportRecord` (JSON) | 1 KB | 1 KB |
| Trades canônicos (JSON) | 1,9 MB (≈ **3,85 KB/trade**, ≈ 20× o CSV) | 18,8 MB |
| Tempo de `runImportPipeline` (reimport) | ≈ 50–80 ms | ≈ **1,7 s** (≈ 0,33 ms/trade; a 2ª vez não é mais rápida) |
| Bundle `metrics.query` (3 métricas) | 1,7 MB (FULL) | **6 KB** (`HASH_ONLY`) |
| Bundle `metrics.groups` 50×10 | 2,5 MB | **20,3 MB** (15,8 de trades + 4,6 de métricas) |
| View + handle por entrada do ledger | `query` ≈ 0,4 KB; `groups` 50×10 ≈ **71 KB** + 0,4 KB | idem (a view quase não cresce) |
| Latência do `metrics.groups` 50×10 | ≈ 1,0 s | ≈ **7,6 s** (10 mil trades ≈ 18,5 s), **síncrona** |

- **Limite de ids:** `tradeIdsLimit` padrão = **500** [código `prepare.ts`]; populações maiores viram `HASH_ONLY` (bundle pequeno, sem lista de ids). Por isso o `metrics.query` a 5.000 trades tem só 6 KB, mas o `groups` por grupo (≤ 500 cada) ainda pode listar ids ⇒ 20 MB.
- **Memória não foi o risco** no estresse (sem OOM a 512 MB até 5.000 trades; sem vazamento).
- **NÃO MEDIDO:** quantos trades/conversas um usuário real teria; custo de ler/gravar bundles de 20 MB em Postgres/Neon; latência de buscar o arquivo em object storage; limite de duração de função no plano Vercel em uso (o projeto só declara `maxDuration = 60` numa rota de cron).

## 5. Riscos e tensões (cada um com a evidência)

| # | Risco | Evidência |
|---|---|---|
| R1 | **Fonte de verdade dos trades do agente.** O arquivo original (verificável, determinístico) × a tabela `trades` (conveniente, mas sem ids/pernas). A fundação recomenda evoluir `trades` in-place (§B.1-A) e ter `ImportSource` com `rawStorageKey`; o caminho atual do app (import JSON do cliente) não guarda o arquivo. | §3; doc §B.1/§I.3 |
| R2 | **Guardar o arquivo bruto do usuário** (privacidade/LGPD, custo, criptografia em repouso, exclusão, retenção). Sem ele o `source` fica `NOT_RUN` e tudo `NOT_VERIFIED`. | contrato §7; `agent-contract-plano.md` (linha 67) |
| R3 | **Chaveiro de sal:** o sal é segredo por usuário; perdê-lo = perder a verificação dos refs; guardá-lo exige cifra em repouso, backup e política de rotação/aposentadoria (`RETIRED`). | `salt-policy-plano.md` |
| R4 | **Latência síncrona** (7,6 s a 5.000 trades no 50×10, +1,7 s para reimportar o arquivo) numa função serverless; bloqueia o event loop se rodar na thread da API. | §4; estresse |
| R5 | **Bundles de MBs:** persistir (até 20 MB cada) × **regenerar sob demanda** a partir de (spec + arquivo + época), já que o `evidenceRef` é o hash do conteúdo e a pipeline é determinística. Hoje só o `evidence.explain` pede `bundleOf` (`ExplainContext`). | §4; `evidence-explain.ts` |
| R6 | **Rotação de época:** refs antigos viram STALE; o `refresh` precisa do arquivo + sal novo + `specOf`; sal aposentado ⇒ `S_SALT_RETIRED`. | contrato §7 |
| R7 | **Concorrência:** ledger e tabela de alias são imutáveis e por conversa; duas abas/requisições simultâneas precisam de uma regra (quem "guarda a tabela devolvida"). | `metrics-groups`/`rank-groups` alocam alias |
| R8 | **Importação repetida:** o mesmo arquivo importado duas vezes gera `tradeId` duplicado (`E_DUPLICATE_TRADE_ID`); a deduplicação em 3 níveis está só no desenho (§I.5). | `data-contract.md` (linha 359); fundação §I.5 |
| R9 | **Exclusão/LGPD:** apagar a conta/conversa/sal e o que acontece com refs e bundles (a fundação prevê cascade na exclusão da conta). Sal apagado ⇒ refs irrecuperáveis. | fundação §H.4 |
| R10 | **`userId` nunca do modelo:** todo acesso de dados deve ser escopado pela sessão. | fundação §J.3 |
| R11 | **Estratégia não verificável** (achado do E6.6-5-A2): números por estratégia não são citáveis; só muda com a Evidence carregando a estratégia (D6-1 também depende disso). | plano §30/§33 |

## 6. Decisões em aberto (para Marcelo/Gemini; NADA decidido)

1. **Fonte de verdade:** (a) arquivo bruto em object storage + derivar os trades sob demanda; (b) arquivo + cópia canônica em JSON (≈ 20× o CSV); (c) outra. Impacta R1, R2, R4.
2. **Política do arquivo bruto:** guardar? por quanto tempo? cifrado? apagar com a conta? (R2, R9). Sem guardar, o `source` e o `refresh` não funcionam.
3. **Bundles:** persistir (até ~20 MB) ou regenerar sob demanda a partir de spec + arquivo + época (R5)? Define o que é o `bundleOf`.
4. **Sal:** onde e como cifrar o chaveiro, quem faz backup, e o que acontece ao apagar o usuário (R3, R9).
5. **Execução:** o agente roda na API (síncrono, limite de função) ou em worker/fila (R4)? Há teto de trades por consulta?
6. **Escopo da conversa:** o que é persistido por conversa (ledger, specs, tabela de alias) e a regra de concorrência (R7).
7. **Estratégia verificável** entra na E7 ou fica de fora (R11)?
8. **Ordem e fatiamento** (proposta na §7, para aprovar ou trocar).

## 7. Proposta de fatiamento (PROPOSTA, não aprovada; só depois das decisões da §6)

E7-0 decisões e contrato de armazenamento · E7-1 arquivo original + `ImportRecord` (ligação com o `trades` legado) · E7-2 `SaltProvider` persistente (cifrado, com backup) · E7-3 conversa: ledger + specs + tabela de alias · E7-4 `bundleOf` (persistir ou regenerar) · E7-5 montador do `ctx` e orçamento de latência. Cada passo com expectativa antes do código e aprovação, como até aqui. **Antes de qualquer UI ou LLM.**

## 8. Fora deste levantamento

LLM/orquestrador (§J.3), UI/chips "Por quê?", importadores de outras plataformas (§I), pesquisa/backtest. A E7 é só o elo de dados entre o agente puro e o banco/infra.
