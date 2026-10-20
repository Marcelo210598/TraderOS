# TraderOS — Progresso

## ✅ 20/10/2026 — AI Partner: E7-13 PORTÃO D — migração aditiva APLICADA EM PRODUÇÃO (Neon); 4 tabelas ai_* novas; dados legados intactos
PORTÃO D FEITO: migração `20261020150000_add_ai_partner_storage` APLICADA EM PRODUÇÃO (Neon, endpoint ep-lucky-glitter-aciv9115) em 20/10/2026, com OK do Marcelo, via `prisma migrate deploy` (script migrate-prod.mts do scratchpad, com pré-voo só-leitura). Antes: ENSAIO numa cópia com dados (branch `e7-rehearsal`, ep-little-bread-acncqaay) ⇒ idêntico; BACKUP = branch `backup-pre-ai-partner` (ep-super-poetry-acvu5b2m, sem expiração, NUNCA aplicar nada nela). Resultado em produção: 25 tabelas (21 antigas + 4 `ai_*` novas, VAZIAS), `migrate status` = up to date, as 20 tabelas legadas com contagens IDÊNTICAS à cópia (users=9, trades=68, notifications=526…); o `false` do script foi BUG MEU (contei `_prisma_migrations`, que passou de 12 p/ 13 linhas por causa da própria migração). `_prisma_migrations` de produção tem `add_notifications` duplicada (1 tentativa revertida + 1 concluída): normal, o Prisma ignora. Nenhum código do app usa as tabelas ainda; o app não precisou de deploy. Branches `e7-ai-partner-test` e `e7-rehearsal` expiram em 21/10 (o backup fica). Lições: ao conferir integridade pós-migração excluir `_prisma_migrations`; branch do Neon que vira ensaio precisa ser com DADOS (a `_prisma_migrations` vem junto). PRÓXIMO: E7-14 fiação (rota de upload com plano do usuário ⇒ registerImportWithQuota ⇒ R2 + adaptadores Prisma com o cliente de src/lib/prisma.ts INJETADO), decidir se o Free usa o AI Partner; depois loop do LLM+UI e cofre da chave mestra. Pendência separada: revogar token R2 da Cloudflare.

## ✅ 20/10/2026 — AI Partner: E7-13 Portão C (testes ao vivo do Prisma em branch real do Neon) — código no backup; origin intocado
PORTÃO C (ao vivo) CONCLUÍDO em branch descartável (`ep-quiet-sun-…`); produção (`ep-lucky-glitter-…`) não foi tocada. Trava `assertSafeTestDatabase` aprovada. Migração de teste aplicada com sucesso após marcar migrações legadas como aplicadas. Suíte offline segue em **1343 ✓** (o teste ao vivo entra em `test:domain` mas se auto-pula sem `PRISMA_LIVE=1`). 6 testes novos ao vivo (`scripts/test-prisma-live.mts`, LV1–LV6) todos verdes:
- LV1: CAS real com 10 commits concorrentes na mesma versão (5 direta, 5 pooler) ⇒ exatamente 1 vence e 9 dão CONFLICT.
- LV2: transação interativa funciona pelo pooler com rollback real em caso de PK duplicada (preserva versão).
- LV3: cascata da FK apaga deltas no delete e deleteAllForUser; isolamento estrito entre usuários com mesmo conversationId; versão futura dá CONFLICT.
- LV4: integridade de bytes (0..255) e datas (string original preservada); CAS de recifragem do sal (apenas 1 de 2 recifragens simultâneas vence).
- LV5: purgeUserData sobre adaptadores Prisma zera dados do usuário alvo sem tocar no outro.
- LV6: latências medidas na conexão direta (~37ms commit / 19ms leitura) e pooler (~33ms commit / 18ms leitura); conexão leva ~120ms.
Mutações ao vivo EP11–EP15 e EP17 pegas. P6 do sal relaxado apenas para rede real do Prisma.
REGISTRO (fato, sem cobrança): a URL da branch colada no chat tinha a senha do papel `neondb_owner`, que é IDÊNTICA à da produção (a branch herda a senha do papel). Decisão do Marcelo de 01/08 (não rotacionar credenciais do Neon) MANTIDA. Pendência SEPARADA e em aberto: revogar/recriar o token R2 da Cloudflare (as chaves também apareceram em print).
PRÓXIMO: PORTÃO D (produção) só com aprovação explícita + snapshot no Neon.

## ✅ 20/10/2026 — AI Partner: E7-13 Portão B (adaptadores Prisma offline) — código no backup (expectativa `cc093a3`); origin intocado; NENHUM banco tocado
PORTÃO B (offline) FEITO; nenhum banco tocado. Suíte **1337 → 1343 ✓** (P1–P6 em `scripts/test-prisma-stores.mts`), tsc 0, ESLint 0 erros, estabilidade 8×, 20 mutações offline pegas (EP12/EP14/contrato real só no portão C). `prisma/schema.prisma`: +64 linhas, 0 remoções (hash do legado travado): `AiUserSalt`, `AiImportSource`, `AiConversation`, `AiConversationDelta` (prefixo Ai, SEM FK p/ User, payloads/datas em TEXTO, colunas snake_case). Migração `20261020150000_add_ai_partner_storage` gerada OFFLINE (4 CREATE TABLE + FK interna cascade). Adaptadores `infra/prisma-{port,salt-store,import-source-store,conversation-store}.ts` com cliente INJETADO (não importam @prisma/client); commit da conversa = `updateMany where version=expected` + insert do delta numa transação. `scripts/_prisma-live.mts`: `assertSafeTestDatabase` recusa o MESMO SERVIDOR da produção (ignora -pooler e porta) e conexão só com PRISMA_LIVE=1 + E7_TEST_DATABASE_URL (nunca DATABASE_URL). Contrato dos 3 stores ganhou a impl. Prisma só com PRISMA_LIVE=1. Erro meu: `prisma format` reformatou o schema legado (revertido; NUNCA rodar format). Prisma 7.8; são 11 migrações + lock. PRÓXIMO = PORTÃO C: Marcelo cria branch descartável no Neon e põe E7_TEST_DATABASE_URL no .env.local (nunca no chat); aplico a migração SÓ na branch (DATABASE_URL=… prisma migrate deploy), rodo suítes e mutações ao vivo (EP11–EP15) e meço: transação interativa pelo pooler, latência, Bytes/2 MiB. PORTÃO D (produção) só com OK separado + snapshot.

## ✅ 20/10/2026 — AI Partner: E7-12 cota de arquivos importados por plano — código no backup (expectativa `ce81f7a`); origin intocado
Suíte **1323 → 1337 ✓** (L1–L3 em `test-import-source-store.mts`; Q1–Q11 em `scripts/test-import-quota.mts`), tsc 0, ESLint src/lib 0 erros, estabilidade 8×. `plans.ts`: `PLAN_IMPORT_QUOTAS` (Free 2 arq/5 MiB, Starter 20/50 MiB, Pro 100/250 MiB; FORA de `PlanLimits`). `ImportSourceStore.list(userId)` (ordenado, cópia, corrompidas em `corrupt`). `infra/import-quota.ts`: `registerImportWithQuota(deps, req, plan)` confere ANTES de gravar (reenvio do mesmo sha não consome cota; `QUOTA_EXCEEDED` {resource files|bytes, limit, used, suggestedPlan}; fail-closed; erros do registerImport passam iguais) + `getImportUsage` p/ UI. Apagar libera cota; rebaixar não apaga. Mutações EQ1–EQ19 pegas. Custo calculado: 10.000 Free no teto ≈ US$0,03/mês, 1.000 Pro ≈ US$0,77/mês (cota = proteção contra abuso, números podem subir). Limites: cota macia sob concorrência (até N−1 a mais), órfãos no raw não contam, sem retenção por tempo, SEM fiação à rota/UI (quem chamar passa o plano). Pergunta aberta: Free tem vegaPerMonth 0 — liberar o AI Partner no Free? (se não, cota Free = 0).

## ✅ 20/10/2026 — AI Partner: E7-11 cliente S3/R2 (ObjectStore sobre o Cloudflare R2) — código no backup (expectativa `3aabe91`); origin intocado
Suíte **1314 → 1323 ✓** (R1–R9 em `scripts/test-object-store-r2.mts`; C1–C12 também na 4ª implementação; G7 retitulado), tsc 0, ESLint src/lib 0 erros, estabilidade 8×. `infra/object-store-r2.ts`: `createR2ObjectStore` (SigV4 PRÓPRIO sem SDK; HMAC em `hash.ts`) + `loadR2Config(env)` (secret fora de JSON/String/inspect). MEDIDO AO VIVO no R2: `PUT If-None-Match:*` ⇒ 200 novo / 412 existente (CAS real), DELETE ⇒ 204 existindo ou não (delete usa HEAD antes; `existed` informativo), GET sem credencial não é público. Apagar por prefixo = LIST + DELETE por chave (DELETE é grátis). Teste ao vivo R10 com `R2_LIVE=1` PASSOU no bucket `meutrade-raw` (cota grátis; alerta de gasto US$1 configurado; bucket limpo). Mutações ER1–ER19 pegas (ER14 equivalente). Conta Cloudflare/R2 criados pelo Marcelo; chaves em `.env.local` (gitignored, 0600). PENDÊNCIA: as chaves do token apareceram em PRINT na conversa; Marcelo decidiu seguir assim; revogar/recriar o token e apagar o print do Desktop quando puder. Fora: fiação ao Next, retry/backoff, cota por plano (E7-12), retenção.

## ✅ 20/10/2026 — AI Partner: E7-10 RawFileStorage sobre ObjectStore com gzip — commit de código no backup (expectativa `bfd353a`); origin intocado
Suíte **1306 → 1314 ✓** (C1–C12 agora também no adaptador de objeto; G1–G8 novos em `scripts/test-raw-file-storage.mts`), tsc 0, ESLint src/lib 0 erros, estabilidade 8×. `infra/object-store.ts` (porta mínima putIfAbsent/get/delete/deleteByPrefix + memória) e `infra/raw-file-storage-object.ts` (`createObjectRawFileStorage`: SEMPRE gzip em `users/{u}/imports/{sha}.csv.gz`, sha do ORIGINAL conferido no put e após o gunzip, teto 25 MiB na descompressão, objeto corrompido ⇒ CORRUPT, falha do store ⇒ STORAGE_ERROR sem eco). Sem SDK, sem rede, sem conta. Mutações EO1–EO17 pegas (EO11 pelo G1, não pelo C10). Medido: CSV real NT8 comprime 4,2×; R2 grátis 10 GB/1 M escritas/10 M leituras, egress grátis, depois US$0,015/GB-mês. Roteiro de custo mínimo: E7-11 cliente S3/R2 (EXIGE conta Cloudflare + chaves, só com OK; medir antes se o R2 faz escrita condicional e se a conta grátis exige cartão), E7-12 cota de arquivos por plano. Limites: não fala com nuvem; atomicidade do putIfAbsent no R2 não verificada; cripto em repouso é a do provedor.

## ✅ 20/10/2026 — AI Partner: E7-9 persistência das mensagens da conversa — commit `f58008a` (expectativa `f88620d`), backup atualizado; origin intocado
Suíte **1290 → 1306 ✓** (M1–M8 em `scripts/test-conversation-messages.mts`, N1–N8 em `test-turn-session.mts`), tsc 0, ESLint src/lib 0 erros, estabilidade 8×. Mensagens da conversa (user + assistant) dentro do MESMO delta do turno (`messages` opcional; delta antigo segue legível): user literal ≤4.000 (`openTurn({userMessage})`), assistant = `answer` validado (null no STOP) + `rendered` (registro do que o usuário viu, não recalculado) + `citations` derivadas e conferidas no ledger do commit; o PRIMEIRO desfecho terminal do `validate` vence; limites 200 msgs/conversa e 64 KiB/msg (`LIMIT_MESSAGES`→`LIMIT_EXCEEDED`; `MESSAGE_INVALID`→`COMMIT_REJECTED`); `OpenConversation.messages` congelado (todas; fatia = do consumidor); `commitTurn` chama `now()` uma vez. LGPD herdada (deleteConversation/purgeUserData apagam). Mutações EM1–EM25 pegas. Limites: texto do usuário gravado literal (dado pessoal); render falho de resposta aceita vira STRUCTURE_INVALID sem teste de entrada; sem resumo de histórico, sem prompt, sem LLM/UI/Prisma.

## ✅ 20/10/2026 — AI Partner: E7-8 citabilidade do `evidence.explain` (ref derivado por página) — commit `81c9fbe`, backup atualizado; origin intocado
Suíte **1275 → 1290 ✓** (X1–X6, T1–T8, RF14), tsc 0, ESLint src/lib 0 erros. Cada página do explain ganha ref próprio (`explainPageRef` em `evidence/hash.ts` = `ev_` + 32 hex de sha256 de `{v:"explain@1",ref,page}`); a entry vai ao ledger do turno; `ClaimSchema`, ledger e `ConversationStore` NÃO mudam (zero migração); portão Q2 intacto. D-X7: `evidence-refresh.ts` devolve `ARGS_INVALID` para entrada não reexecutável (antes seria `FILE_NOT_AVAILABLE`). EX1–EX19 pegas (EX16 equivalente por construção: `BundleCache.put` recusa ref×hash). Correções minhas: operação `refresh` do explain era código morto (ref muda a cada época); linha 67 lida como 68; RF10 e K4/C5/EX11 reescritos. **Limites:** ref derivado não é regenerável nem refrescável (refazer o explain sobre o ref analítico); uma página = uma entrada (teto 500). Detalhe: `agent-answer-plano.md` §42 e `expected.json` → `e7_8`. Pendentes (cada um com aprovação): R2, mensagens da conversa, Prisma, laço LLM + UI, chave mestra em cofre, retenção de backups, bloqueio de conta/auditoria.

## ✅ 19/10/2026 — AI Partner: E7-7 exclusão em cascata / LGPD Art. 18 — commit `acddf47`, backup atualizado; origin intocado
Suíte **1258 → 1275 ✓** (17 casos em `scripts/test-user-purge.mts`), tsc 0, ESLint src/lib 0 erros. `infra/user-purge.ts`: `purgeUserData` (arquivos → metadados → conversas → sais → cache; PARA no primeiro erro, sal nunca destruído se etapa anterior falhou; reexecução idempotente), `deleteImportFile` (arquivo antes da linha), `deleteConversation`. Stores ganharam `delete`/`deleteAllForUser`; `BundleCache.purgeUser` com geração por usuário (voo atrasado não ressuscita dado). Cache só é purgado se algo foi de fato apagado. EL1–EL16 pegas 16/16 (+6 extras). **Limites:** backups/snapshots/nuvem não cobertos; cache por processo; `rm` ≠ apagamento físico em SSD; bloqueio de conta e auditoria são da camada de auth/Prisma; purga definitiva sem carência. Detalhe: `agent-answer-plano.md` §41 e `expected.json` → `e7_7`.

## ✅ 19/10/2026 — AI Partner: E7-6 executor determinístico do turno (sem LLM) — commit `884160b`, backup atualizado; origin intocado
Suíte **1232 → 1258 ✓**, tsc 0, ESLint (src/lib + testes) 0 erros. `infra/turn-session.ts` (`openTurn/call/validate/commit`): sal carregado 1x, pin do servidor, ctx memoizado, aliases fluindo, época desatualizada ⇒ ledger rotacionado + `rotateTo`, refresh herda spec+pin, `onBundle` aquece o cache, explain fora do ledger (achado medido: a entrada do explain colide com a analítica), colisão breakdown×analysis ⇒ `ENGINE_REFUSED`, UM commit atômico no fim (`TURN_CONFLICT`, sem retry). EM1–EM16 pegas (+8 extras). Portões Q3, SC11 e SG1 abertos só para `turn-session.ts`. **Roteiro E7-0…E7-6 concluído (elo de dados do agente).** Seguem pendentes, cada um com aprovação própria: exclusão em cascata/LGPD, escolha do provedor de storage (R2), mensagens da conversa, Prisma, laço com LLM + UI, chave mestra em cofre, citabilidade do explain (mudar a chave do ledger). Detalhe: `agent-answer-plano.md` §40 e `expected.json` → `e7_6`.

## ✅ 19/10/2026 — AI Partner: E7-5 gancho `onBundle` + regenerador de bundle + cache LRU — commit `b7a5409`, backup atualizado; origin intocado
Suíte **1195 → 1232 ✓**, tsc 0, ESLint (src/lib + testes) 0 erros. `assess.ts` + 6 capacidades ganham `onBundle` aditivo (após o sucesso, exceção engolida, saída idêntica sem gancho); `infra/bundle-cache.ts` (LRU 64 MiB por bytes, chave userId+ref, single-flight, falha nunca guardada); `infra/regenerate.ts` (`regenerateBundle` só ref CURRENT com `REF_MISMATCH` fail-closed, `prepareBundle` para o explain síncrono, `regeneratedFor` para o refresh). Oráculo: 6 capacidades regeneram ref e bundle idênticos byte a byte. Mutações RM1–RM18 pegas (+ extras; RM22 equivalente). Portão Q3 aberto só para `regenerate.ts`. Colisão exit.breakdown×exit.analysis mantida (LEDGER_CONFLICT). Próximo: orquestrador do turno (ainda sem OK). Detalhe: `agent-answer-plano.md` §39 e `expected.json` → `e7_5`.

## ✅ 19/10/2026 — AI Partner: E7-4 pin de dataset + ImportSourceStore + makeContext — commit `0f0070d`, backup atualizado; origin intocado
Suíte **1166 → 1195 ✓**, tsc 0, ESLint 0. `infra/dataset-pin.ts` (pin por spec, máx. 10, ordem canônica), `infra/import-source-store.ts` (memória + disco 0600, `CONFLICT` sem sobrescrever), `infra/dataset.ts` (`registerImport`, `makeContext` com conferência de `importId`, sem risco inventado, `ignoreBOM`); `conversation-store.ts` grava o pin na spec e a fachada revalida cada delta. DM1–DM16 + 6 extras pegas. Achado: `exit.breakdown` e `exit.analysis` (sem compare) emitem o mesmo `evidenceRef`. Próximo: E7-5 (regenerador `bundleOf`/`regenerated`, gancho `onBundle`, cache LRU 64 MiB single-flight). Detalhe: `historico/2026-10-19.md`.

## ✅ 18/10/2026 — AI Partner: E7-3 estado da conversa persistente — commit `17443d8`, backup atualizado; origin intocado
Suíte **1145 → 1166 ✓**, tsc 0, ESLint 0. `infra/conversation-store.ts`: log de deltas atômicos (`v000001.json`… por `link` exclusivo = CAS), uma `version` por conversa, `commit(expectedVersion)` ⇒ `CONFLICT` sem retry; leitura dobra o log num modelo relacional e remonta o ledger pelas funções PURAS em ordem (época, seq); alias só cresce pelo fim; specs sem refs reais; limites 500 entradas / 256 KiB por linha / 2 MiB por delta. 20 mutações reais pegas (+1 controle). Medido: 500 entradas abrem em 36 ms (memória) / 76 ms (disco). Portões SC11 e SG1 abertos só para `conversation-store.ts`. Próximo: E7-4 (`bundleOf`). Detalhe: `agent-answer-plano.md` §37 e `expected.json` → `e7_3`.

## ✅ 18/10/2026 — AI Partner: E7-2 `SaltProvider` persistente cifrado — commit `be3ecb7`, backup atualizado; origin intocado
Suíte **1122 → 1145 ✓**, tsc 0, ESLint 0. `infra/cipher.ts` (AES-256-GCM, nonce 96 bits interno, AAD `userId:saltId`, `keyVersion`, `SALT_MASTER_KEY` / `_VERSION` / `_PREV_<n>`) e `infra/salt-store.ts` (`SaltStore` assíncrono em memória e disco + `createPersistentSalts` + `recipherAll`); `SaltProvider` segue síncrono e `salt.ts` inalterado. 16 mutações planejadas + 4 extras, todas pegas. Doc: `docs/ai-partner/E7-2-chave-mestra.md` (perda da chave = sais irrecuperáveis). `.env.example` é ignorado pelo git. Próximo: E7-3 (estado da conversa). Detalhe: `agent-answer-plano.md` §36 e `scripts/expectations/agent-answer.expected.json` → `e7_2`.

## ✅ 16/10/2026 — AI Partner: A2 `strategy`, estresse 50×10, RF9, D6-1, E7-0 e E7-1 — backup até `b51284f`; origin intocado
Suíte **1083 → 1122 ✓**, tsc 0, ESLint 0. `strategy` como filtro/dimensão (11ª do compare); estresse medido (≈linear, sem OOM); RF9 com desfecho único; D6-1 excluído com tripwires; E7-0 contrato de armazenamento; E7-1 `RawFileStorage` (memória+disco, 16/16 mutações). Próximo: E7-2 (`SaltProvider` cifrado). Detalhe: `historico/2026-10-16.md`.

## ✅ 15/10/2026 — AI Partner: E6.6 FECHADO (E6.6-8…12 + 5-A + 7b + fixes do validador) — backup até `882fbae`; origin intocado
Suíte **984 → 1083 ✓**, tsc 0, ESLint limpo. Novas capacidades: `metrics.compare`, `rank.groups`, `exit.analysis`, `evidence.explain` (+PD-3 `DATA_NOT_PROVIDED`), `evidence.refresh` (+`refreshEvidence` no ledger; sem sal o ref não muda entre épocas) e alias de entrada de conta. `VERIFIED_PARTIAL` coberto ponta a ponta (receita real). Pendências: E6.6-5-A2 `strategy`, D6-1, estresse 50×10, endurecer RF9. Detalhe: `historico/2026-10-15.md` e `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-15.md`.

## ✅ 14/10/2026 — AI Partner: E6.6-7a, 7a', 2c + review adversarial do Gemini — backup até `ce767a3`; 2c só local
Gemini (Antigravity, só leitura) revisa cada passo; eu reproduzo cada achado antes de agir (rodada 1: 6/7 confirmados; rodada 2: 3/4, 1 refutado). **E6.6-7a/7a'**: X13–X15c + G15b (rBasis, DIVERGENT por valor e quantidade, literais, cobertura parcial, minSample). **E6.6-2c**: validador barra ordens de mercado (`ADVICE` 83 → 178; homônimos só em locução; 10 falsos negativos pinados). Suíte **984 ✓**, tsc 0. Próximos: rodada 3 do Gemini, push, E6.6-7b (`undefined` ⇒ ARGS_INVALID + `buckets[].unit`), decidir FP `analise`, E6.6-8…12. Retomar por `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-14.md`.

## ✅ 12/10/2026 — E5b × bundles de LINHAS (`rowTrades`) CORRIGIDO — só local, sem push
Causa raiz: o índice de ids da reingestão só tinha ciclos. Conserto de 1 linha em `verify-source.ts` + `test-evidence-source-rowtrades.mts` (10 testes); baselines idênticos. Detalhe no CHANGELOG.

## ✅ 09/10/2026 — Evidence Lab (localhost) — só local, sem push
`/dev/evidence-lab`: inspeção visual da fundação (camadas, trilha do trade, métricas, bundle, verificador, 18 cenários de adulteração). Só `NODE_ENV=development`, sem banco/API/fixtures reais. Detalhe: `docs/ai-partner/evidence-lab.md`.
- Única mexida em arquivo de auth: `src/proxy.ts` (exceção de login SÓ com guard aberto; em produção nada muda). Validado com `next build` + `next start`.
- 901 conferências HTML × domínio no dev server; `scripts/test-evidence-lab.mts` (8 testes).

## 📝 10/10/2026 — Plano E6/G6 (SÓ PLANO, nada implementado)
`docs/ai-partner/E6-G6-plano.md`: dimensão `exitReason` (trade) + `exitBreakdown` (perna) + ranking/contribuição/comparação + Evidence dos derivados (aditiva) + desenho das capacidades para o agente. 6 decisões pendentes (§3). **Aguardando revisão do usuário.** Checkpoint: `MEUTRADE-CHECKPOINT-2026-10-10c.md`.

## ✅ 10/10/2026 — Evidence Lab: aba "Origem (E5b)" — só local, sem push
Nova aba em `/dev/evidence-lab?tab=source`: 11 cenários sintéticos executados com `verifyEvidenceSource` + `verifyEvidence` reais (íntegro, 1 byte, célula financeira, hash de arquivo, importId, rowHash, tradeId, **bundle forjado VALID no V0–V4 e SOURCE_MISMATCH no E5b**, HASH_ONLY, arquivo ausente, versão do parser), com 9 passos e legenda dos estados (parcial nunca é "completo"). Visão geral atualizada (9 camadas; E5b/E5.3/ordem deixam de ser pendências). Mesmo guard em 4 camadas; validado em `next build --webpack` + `next start` numa cópia isolada (anônimo → login/401; logado → 404 em tudo). `scripts/test-evidence-lab-source.mts` (8). Achado pré-existente: `cycleKey.strategy` expõe o nome da estratégia (E3). Detalhe: `docs/ai-partner/evidence-lab.md`.

## ✅ 12/10/2026 — AI Partner: sourceLabel S2b + S4b (mapa do usuário → patternRef) — só local, sem push
`ImportRef` leva só `patternRef` + motivo (regex fica no registro interno); E5b exige o mapa do chamador e o confere por hash: ausente/divergente ⇒ UNVERIFIABLE (`S_CONTEXT_INSUFFICIENT`), nunca FAIL. Tabela dos 4 casos rodada contra código real. Requisito de contrato: mesmo sal do import em TODOS os refs ao gerar a Evidence. `test-evidence-sourcelabel-s4b.mts` (8). **Nota para o S6:** matriz de combinações (sal × vocabulário × mapa × derivado) como prática geral.

## ✅ 12/10/2026 — AI Partner: sourceLabel S2 (projeção + schema + labelVocab) — só local, sem push
Rótulos de ordem na Evidence agora só como vocabulário v1 ou token `lbl_…`; V0 rejeita texto livre (selo refeito inclusive); `ImportRef.labelVocab: 1`; E5b com sal efetivo e `S_VERSION_INCOMPATIBLE`. **Prova dos 9 bundles rodada de verdade:** remover `labelVocab` + recalcular = baseline nos 9; o bundle derivado HASH_ONLY (sem `ImportRef`) nem muda de hash. Correção de expectativa registrada em `_meta.history`. Teste `test-evidence-sourcelabel-s2.mts` (8). Pendentes: S2b/S4b (mapa do usuário → `patternRef`; tabela dos 4 casos rodada contra código real no S4b), S5 (Lab), S6.

## ✅ 12/10/2026 — AI Partner: sourceLabel S0b + S1 — só local, sem push
S0b (`2ee6c2f`): 9 bundles pinados (inclui métrica+derivado no mesmo bundle) para a prova "remover `labelVocab` + recalcular = baseline" + semântica do veredito combinado (UNVERIFIABLE = NOT_VERIFIED, nem ok nem adulteração) escrita antes do código. Guarda `test-evidence-no-solo-verdict.mts` estendido (7): cobre UNVERIFIABLE de arquivo ausente/versão/HASH_ONLY/estratégia e os casos do mapa (S4b) já registrados. S1: `labelRef` + `projectLabel` + `test-evidence-label-vocab.mts` (11; 36 casos da expectativa; re-derivação independente do token; fixtures reais: 0 fora do vocabulário). **Não ligado ainda (S2).** Flat/Close ficam para a v2 do vocabulário (provável 1º feedback real de usuário).

## ✅ 12/10/2026 — AI Partner: Lab sem nome de conta em claro (aba Métricas e cenário extra-field) — só local
`groupLabelView` (redact-view.ts): grupos `account`/`strategy` do motor aparecem como `accountRef`/`strategyRef` nas abas Métricas e EvidenceBundle (select); cenário de adulteração `extra-field` injeta marcador neutro em vez de "Conta Demo A". Crawl real das 122 páginas das abas antigas: 0 nomes/rótulos em claro. Teste em `test-evidence-lab-derived.mts` (11).

## ✅ 12/10/2026 — AI Partner: sourceLabel — decisões A–E e S0 (expectativas) — só local, sem push
Decisões: A estrito às 2 fixtures (sem `Flat`/`Close`/nomes NT8) · B `\d{0,2}` · C `exitReasonMap` → `patternRef` (+S2b/S4b; E5b passa a exigir o mapa do chamador p/ imports com mapa não vazio) · D `labelVocab: 1` no `ImportRef` (⇒ `evidenceHash` de todo bundle novo muda; prova por remoção do campo + pins) · E política de sal por usuário pendente (vale para accountRef/strategyRef/labelRef/patternRef), documentada em `data-contract.md` §14.14. S0 = `scripts/expectations/sourcelabel.expected.json` (36 casos de projeção + invariantes + pins de baseline do commit `804def3`). **S1+ não iniciado.**

## ✅ 12/10/2026 — AI Partner: decisões da 2ª revisão (redação nas abas, veredito combinado, plano do sourceLabel) — só local, sem push
(1) **Plano** da lista fechada de rótulos + token: `docs/ai-partner/sourceLabel-plano.md` (SÓ documento; decisões abertas A–E; passos S0–S6 com expectativas antes do código). (2) `redactLabels`/`maskLabel` em TODAS as abas (componente `Json` sempre redige); HTML real das 79 páginas das abas antigas: 0 rótulos em claro. (3) Veredito combinado: aviso no código/limitação/telas + `test-evidence-no-solo-verdict.mts` + regra E6.5 §6.1. Achado: "Conta Demo A/B" (fictício) ainda aparece na tabela de grupos do motor na aba Métricas por conta — saída do motor, não Evidence.

## ✅ 12/10/2026 — AI Partner: ajustes da revisão externa (E5b/E6.4) — só local, sem push
Itens do parecer: (1) teste antigo do E5b agora EXATO (8 checks PASS + `V5.derived` = NOT_APPLICABLE; antes "ou"); (2) `populations.complete` auditado (nenhum leitor assumia `false`) e registrado em `docs/ai-partner/CHANGELOG-contratos.md`; (3) grep automatizado nas 238 páginas da aba Derivados: 0 vazamentos; (4) expectativas em arquivo separado (`scripts/expectations/`, protocolo no README; `test-evidence-expectations.mts`); (5) casos de borda de `refs.legs` rodados — achou e **consertou** uma falha: o E5b dava PASS a perna citada de trade ausente do bundle (agora PARTIAL). Achado: abas ANTIGAS do Lab (trade/bundle/tamper/source) ainda mostram JSON com rótulos sintéticos — decisão pendente. Fixtures reais: 0 rótulos de texto livre (UNKNOWN = rótulo vazio).

## ✅ 12/10/2026 — AI Partner: E6.4 Evidence Lab — aba Derivados (E6) — só local, sem push
`docs/ai-partner/evidence-lab.md` ("Aba Derivados"), `data-contract.md` §15.5, checkpoint `2026-10-12e`. Aba `?tab=derived`: 17 cenários sintéticos com as funções reais (íntegros, adulteração com selo refeito, HASH_ONLY/versão/dimensão sem referência), os 8 checks do V6 (SKIPPED = "não verificado"), unidades TRADE/LEG separadas, confiança/limitações em PT, E5b do mesmo bundle, navegação até os TradeEvidence; rótulos de origem nunca exibidos; sem endpoint novo. Produção verificada de verdade (anônimo 307 /login; logado 404). Teste `test-evidence-lab-derived.mts` (9). **Pendência antes do agente:** minimizar `sourceLabel` nos TradeEvidence. **Próximo: revisão → E6.5.**

## ✅ 12/10/2026 — AI Partner: E5b reconhece populações de derivados — só local, sem push
`data-contract.md` §14.13. Novo check `V5.derived` + `coverage.derived`: população FULL do derivado conferida contra o CSV (trades + pernas citadas); HASH_ONLY/ids ausentes = PARTIAL; sem trades = UNVERIFIABLE; escopo = população DECLARADA (limitação `L_DERIVED_POPULATION_SCOPE` só com derivados). Bundles sem derivados: comportamento idêntico (5 limitações; 273/8/7). Teste `test-evidence-source-derived.mts` (11).

## ✅ 12/10/2026 — AI Partner: E6.3 Evidence dos derivados + V6 — só local, sem push
Detalhe: `data-contract.md` §15.4, `historico/2026-10-12.md`, `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-12d.md`. Extensão ADITIVA de `evidence/1` (`evidence.derived?`, `claim/subject = DERIVED`; bundles sem derivados mantêm o mesmo `evidenceHash`). `explainDerived` (visão por refs, trava de vazamento) e **V6** (8 checks; catálogo 31→39): reexecuta as funções reais do E6.2 sobre os TradeEvidence e compara (valores, deltas/contribuições/posições, amostra/cobertura/confidence/limitações/reconciliação, refs, determinismo); HASH_ONLY/versão/dimensão sem referência ⇒ SKIPPED (nunca PASS). Teste `test-evidence-derived.mts` (20). **Atenção:** `sourceLabel` já vive nos TradeEvidence (E3) — não replicado no derivado; decisão futura se for sensível. **Próximo: revisão do E6.3 → E6.4.**

## ✅ 12/10/2026 — AI Partner: E6.2 ranking, contribuição e comparação de grupos — só local, sem push
Detalhe: `data-contract.md` §15.3, `historico/2026-10-12.md`, `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-12c.md`. `src/lib/metrics/analysis.ts`: `rankGroups`, `compareGroups`, `comparePeriods`, `exitReasonAnalysis` (pernas × trades, unidades rotuladas), `compareExitReasons`, `compareTradeBuckets`, `rankGroupsByExitLegs`. Descritivo (sem p-valor), indisponível = null+motivo, denominador válido, UNKNOWN/MIXED/TINY listados (nada descartado), divergência perna×trade rebaixa a confiança, conta/estratégia só como ref. Sem mudança em fórmulas, hashes, schema. Teste `test-metrics-analysis.mts` (21). **Próximo: revisão do E6.2 → E6.3.**

## ✅ 12/10/2026 — AI Partner: E6.1 `exitBreakdown` por perna de saída — só local, sem push
Detalhe: `data-contract.md` §15.2, `historico/2026-10-12.md`, `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-12b.md`. `src/lib/metrics/legs.ts`: por motivo (TARGET/STOP/MANUAL/UNKNOWN; MIXED só é bucket do trade) quantidade, líquido/bruto/comissão/taxas (valores da origem por perna, ausente = null + cobertura, nunca 0), contribuição, refs (`tradeId`+`legIndex`+`rowNos`) e `legSetHash`; conferência perna×trade (divergência mostrada, não forçada). Sem mudança de schema/`evidence/1`, hashes ou métricas. Teste `test-metrics-exit-breakdown.mts` (20). **Próximo: revisão do E6.1 → E6.2.**

## ✅ 12/10/2026 — AI Partner: E6.0 dimensão `exitReason` + `strategyRef` na Evidence — só local, sem push
Plano E6/G6 **aprovado** (6 decisões, `docs/ai-partner/E6-G6-plano.md`). Entregue só o E6.0 (commit local próprio). Detalhe: `historico/2026-10-12.md` + `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-12.md` + `data-contract.md` §15.1.
- `groupBy:"exitReason"` e `filters.exitReason`: bucket por trade = motivos distintos de TODAS as pernas de saída → 1 motivo / `MIXED` (`partial` se inclui UNKNOWN) / `UNKNOWN` (sem pernas). Nunca inferido do P&L. Métricas, `tradeSetHash` e identidades idênticos ao baseline.
- `cycleKey.strategy` → `strategyRef` (+ `strategyIdRefs/strategyNameRefs`, `groupKey` e trava `E_STRATEGY_NAME_LEAK`); `evidence/1` mantido.
- Teste novo `test-metrics-exit-reason.mts` (24) no `test:domain`. **Próximo: revisão do E6.0 → E6.1 (quebra por perna).**

## ✅ 10/10/2026 — AI Partner: contexto reproduzível das importações (`ImportRecord.reproducibility`) — só local, sem push
Importações **novas** registram versões das funções de identidade, `foldPolicy` efetivo, `exitReasonMap` normalizado (na ordem) e `accountRefSalted` (nunca o sal). Bloco **opcional e fora do `importId`**: `importId`/`rowHash`/`tradeId`/`tradeSetHash` idênticos aos do commit anterior (pinados em teste); imports antigos não são retro-preenchidos. E5b usa o registrado (e continua `UNVERIFIABLE` quando falta sal/versão). Detalhe: `data-contract.md` §14.12; `scripts/test-evidence-import-context.mts` (7 testes).

## ✅ 10/10/2026 — AI Partner: E5b `verifyEvidenceSource` (proveniência contra o CSV original) — só local, sem push
Liga o bundle ao **arquivo**: bytes do CSV → SHA-256 → reingestão (mesmo pipeline) → `importId`, `rowHash`, `tradeId` e valores derivados do arquivo. Função isolada; `verifyEvidence`, motor e schema `evidence/1` **intactos**. Detalhe: `data-contract.md` §14.11; checkpoint: `MEUTRADE-CHECKPOINT-2026-10-10b.md`.
- Estados: `SOURCE_VERIFIED` · `SOURCE_VERIFIED_PARTIAL` (HASH_ONLY) · `UNVERIFIABLE` · `SOURCE_MISMATCH` · `INVALID_FORMAT`. Indisponibilidade de arquivo/contexto/versão nunca vira adulteração.
- Achados: `fileSha256` é hash do texto UTF-8 (bytes exatos via UTF-8 estrito + BOM preservado); `accountRefSalt`/`foldPolicy`/`exitReasonMap` não estão no bundle; só comparar ids não pega a forja "coordenada" ⇒ compara também os valores (via `explainTrades` da reingestão).
- `scripts/test-evidence-source.mts` (25 testes). Reais: 17 ciclos + 34 trades-linha, 34 linhas, 288 bundles → 273 verificados · 7 parciais · 8 sem referência · 0 divergências; 552/552 ataques.
- **Próximo:** revisão do E5b → decidir E6/G6 e a integração do agente. Nada disso foi iniciado.

## ✅ 10/10/2026 — AI Partner: E5.3 auditoria final do verificador — só local, sem push
Fecha o contrato do `verifyEvidence` (V0–V4 + sequência). **Sem mudar motor, schema ou resultados.** Detalhe: `data-contract.md` §14.10; checkpoint: `MEUTRADE-CHECKPOINT-2026-10-10.md`.
- Auditoria: `SKIPPED` nunca vira `PASS`; achado e correção de um default latente (`?? NA` ⇒ `S_CHECK_NOT_EXECUTED`, bloqueante); `S_ORDER_AMBIGUOUS` não existe mais.
- `scripts/test-evidence-audit.mts` (7 testes): ~1.050 bundles íntegros + ~2.265 mutações; 4 estados alcançados.
- Reais: 5.274 bundles → 5.238 VALID / 36 UNVERIFIABLE (HASH_ONLY); 7.536 ataques, 7.536 detectados; motor com 120 hashes idênticos.
- Documentado: ordem registrada ≠ ordem original; trocar empatados com selo refeito só é detectável se mudar value/contribuintes.
- **Próximo:** decisão do usuário sobre o **E5b** (proveniência contra o CSV original). E6/G6, Prisma, UI e agente seguem fora.

## ✅ 10/10/2026 — AI Partner: ordem da sequência registrada na Evidence — só local, sem push
Decisão do usuário (opção 3 dos empates de saída): a Evidence registra a ordem EXATA que o motor usou, **sem mudar nenhum resultado** nem criar desempate. `population.sequence = { dependent, order }` (só tradeIds; `null` em `HASH_ONLY`/métrica não sequencial), vem do trace do próprio cálculo; novo check `V4.sequence` (31 checks); `S_ORDER_AMBIGUOUS` → `S_ORDER_NOT_RECORDED` (só ordem ausente com empate). Detalhe: `data-contract.md` §14.9.
- Motor idêntico (baseline congelado de 120 hashes); fixtures reais: 5.274 bundles, 0 FAIL, 5.238 VALID (os 141 "ordem ambígua" viraram VALID), 36 HASH_ONLY. `scripts/test-evidence-sequence.mts` (13 testes).
- **Próximo:** revisão do relatório → E5.3; depois E5b, E6/G6 (commits separados).

## ✅ 09/10/2026 — AI Partner: E5.2 `verifyEvidence` V3 + V4 — só local, sem push
Verificador completo: **V3** (fingerprint → `tradeSetHash`) e **V4** (MESMO motor sobre os `TradeEvidence`; value, campos, contribuintes, qualidade, associação, versões). `VALID` agora existe (zero FAIL + nenhum SKIPPED bloqueante); `limitations` sempre no relatório. Detalhe: `data-contract.md` §14.8.
- 5.274 bundles reais sem falso positivo; 6.303 ataques detectados. `maxDrawdownR` com oráculo à mão.
- Achado: nos trades-linha com saída empatada, `maxDrawdown`/`maxConsecutiveWins`/`Losses` dependem da ordem de entrada (não registrada) ⇒ `S_ORDER_AMBIGUOUS`. **Resolvido em 10/10** (ver abaixo).
- **Próximo:** revisão → Evidence Lab (localhost); E5.3 só depois.

## ✅ 09/10/2026 — AI Partner: E5.1 `verifyEvidence` V0–V2 — só local, sem push
Primeira versão do verificador: **V0 formato, V1 selo, V2 referências** (V3/V4 = E5.2, não existem). Status do bundle limpo: **`UNVERIFIABLE`** (nunca `VALID` nesta etapa). Detalhe: `data-contract.md` §14.7, `historico/2026-10-09.md`.
- `src/lib/evidence/verify.ts` + `scripts/test-evidence-verify.mts` (26 testes; no `test:domain`). 21 checks fixos, códigos `V_*`/`S_*`.
- Achado: o schema `evidence/1` descartava em silêncio campo extra (inclusive `sourceName`) em sub-objetos reaproveitados do Canonical → `V0.unknown-fields` cobre sem alterar o schema.
- Fixtures reais: 1.034 bundles limpos sem FAIL; 857 ataques detectados, 0 perdidos.
- **Próximo:** revisão do usuário → E5.2 (V3 `tradeSetHash` + V4 métricas, `maxDrawdownR`).

## ✅ 09/10/2026 — AI Partner: E5.0 (dados para verificar + `E_DUPLICATE_TRADE_ID`) — só local, sem push
Preparação do `verifyEvidence`; **E5.1 NÃO começou** (aguarda revisão). Detalhe: `docs/ai-partner/data-contract.md` §14.5 e `historico/2026-10-09.md`.
- `TradeEvidence` ganhou (aditivo, obrigatório, estrito, cópia fiel): `r{net,netReason,points}`, `risk.reason`, `pointsPerContract`. Continua `evidence/1`.
- `tradeFingerprintFromEvidence` ≡ `tradeFingerprint` (mesma `fingerprintOf`); `tradeSetHash` refeito da Evidence = o do motor.
- `explainMetric`: novo `E_DUPLICATE_TRADE_ID` (mesmo arquivo importado 2×); motor intacto.
- Estabilidade: `tradeSetHash`/resultado do motor idênticos ao commit `88cdad3` (golden pinado). Só o `evidenceHash` dos bundles muda, de propósito.
- **Ajuste pós-revisão** (commit separado): `rowHash` entra no fingerprint dos trades `SOURCE_ROW`; métricas e `tradeSetHash` de ciclos idênticos (§14.6).
- **Próximo:** revisão do usuário do ajuste → E5.1 (V0–V2).

## ✅ 08/10/2026 — AI Partner: Evidence E1 a E4 (só local, sem push)
Fundação de rastreabilidade do AI Partner, tudo puro (sem banco/Prisma/UI). Detalhe em `historico/2026-10-08.md` e `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-08.md`.
- **E1 identidade** (`fa19969`): `importId`, `rowHash`, `tradeId` determinísticos, `account.ref`, `ImportRecord`, SHA-256 em `src/lib/infra/hash.ts`.
- **E2 schema** (`26674d0`): `evidence/1` estrito, `tradeSetHash` SHA-256 (hash53 removido), `evidenceHash` do bundle.
- **E3 `explainTrade`** (`272a0be`, `d0b1813`): trade → linha → import, lista branca, privacidade de conta fail-closed, `fileName` só com lista completa de contas.
- **E4 `explainMetric`** (`c77ddbb`): trace dos contribuintes saído do próprio motor (18 papéis), `HASH_ONLY` acima de 500, filtros/grupos por conta em `accountRef`. Motor idêntico ao commit anterior.
- Testes: `test:domain` PASS (16 suítes), tsc/eslint PASS. Fixtures reais: 17 ciclos + 34 linhas, 0 divergências.
- **Próximo:** plano do E5 (`verifyEvidence`) → aprovação → implementação. Depois E6; Prisma só com contrato validado. 11 commits locais à frente do origin.

## ✅ 29/09/2026 — 4ª e 5ª mesas: Tradeify e Bulenox, NO AR
Pesquisa das mesas que mais valem entrar → **Tradeify** (commit `aed0c8c`) e **Bulenox** (`8fb7ea3`), ambas no ar em `meutrade.app`. Detalhe em `historico/2026-09-29.md`.
- **Tradeify:** Growth, Select Flex, Select Daily, Lightning. Help Center atrás de Cloudflare → lido pelo Chrome; monitoramento manual + lembrete mensal.
- **Bulenox:** Qualification + Master, Momentum, Fast Track. Help Center/FAQ vêm da API pública do site → cron lê 10 itens (`cmsParaTexto`); preços da Qualification = conferência manual.
- Testes: quiz 33 ok, monitor 28 ok.
- **Comparativo entre mesas** `/mesas/comparar` no ar (`db0ec92`) + dúvidas da FFF fechadas.

## ✅ 28/09/2026 (noite) — 3ª mesa: Apex Trader Funding, NO AR
Levantamento pedido pelo Marcelo (site + Help Center). O site e o suporte da Apex ficam atrás de **Cloudflare (403 pro servidor)**, então a leitura foi feita **pelo Chrome do Marcelo** (extensão Claude in Chrome) e o **cron NÃO vigia a Apex**: a conferência é manual (`docs/mesas-proprietarias/apex-conferencia.md`), com o marco zero em `fontes/apex-hashes-2026-09-28.txt` (38 artigos) e um **lembrete por push na 1ª segunda de cada mês** (`ALVOS_MANUAIS` + `lembreteManualDevido` em `monitor.ts`, rota `mesas-check`).
- **Só contas novas (a partir de 01/03/2026):** duas trilhas, **EOD** e **Intraday** (cada uma Standard ou "No Activation Fee"). Legado fora da comparação (aviso na página).
- **Fatos:** avaliação = pagamento ÚNICO, 30 dias corridos, sem reset, sem reembolso; taxa de ativação da PA ($59 Intraday, $90 EOD, ou grátis na versão mais cara) com 7 dias pra pagar; split 100%; saque a cada 5 dias qualificados, consistência 50%, safety net, mín $500, máx 6 saques por PA; até 20 PAs; inatividade (2 dias de $50 em 30 dias); fechar tudo antes das 16:59 ET; stop obrigatório, sem hedge/robô; Live por convite (90/10, saque diário); saque fora dos EUA pela Plane (conta no país de residência); **Brasil não está na lista de países restritos**.
- **Código:** `src/lib/mesas/apex.ts` (2 planos), `quiz-apex.ts` (5 perguntas), Apex em `MESAS` (hub agora com 3 mesas, sitemap dinâmico). Preços de tabela lidos no seletor da home (16 combinações).
- **Validado:** números do 50K e 25K conferem com o levantamento; console sem erro; quiz e hub no celular ok; cron em dry (Lucid 44 + FFF 95, 0 erros). Testes: quiz 21 ok, monitor 24 ok. tsc/eslint limpos.
- Divergências da própria fonte (documentadas): artigo geral de saque (© 2023) fala em "8 dias com 5 de $50" × páginas atuais (5 dias com $100–$350); home diz "sem revisão de saque" × Help Center (análise em até 2 dias úteis, 5–11 dias úteis no total).
- **Commitado e no ar em 28/09/2026** (Apex incluída). O aviso "site bloqueia leitura automática" foi removido da página (usuário não precisa saber como os dados são lidos).

## 🚧 28/09/2026 (noite) — 2ª mesa: Funded Futures Family (FFF), só localhost
Marcelo pediu todos os planos, todas as informações e a FFF no cron. O botão da FFF usa a URL base, sem código de referência (o `ref_code` do link recebido não pertence a ninguém).
- **Levantamento** em `docs/mesas-proprietarias/fff-levantamento-2026-09-28.md` (site WordPress abre normal, sem Cloudflare). 5 planos: Prime, Velocity, Premier+, Straight to Funded, S2F Accelerate (só 50K). Avaliações = assinatura mensal; S2F = pagamento único. Regras gerais (16:15 NY, regra dos 10s, teto $100K, Rise, Live/Rithmic, Brasil fora da lista restrita), Termos (não reembolsável, chargeback).
- **Modelo de dados estendido, compatível** (`types.ts`): `cobranca` mensal/única, tamanho ausente (`Partial`), `celulas`/`extras` por plano, `linhasExtras`, `regrasGerais`, `avisos`, `saqueMinimo`. Regressão: tabela da Lucid IDÊNTICA à de produção nos 4 tamanhos (pegou um `saqueMinimo` que eu tinha esquecido).
- Dados em `src/lib/mesas/fff.ts` + quiz próprio `quiz-fff.ts` (5 perguntas). Página `/mesas/fff` com aviso da mudança do Premier+ (09/09/2026), comparativo, cards, "Regras que valem pra todos os planos" (6 blocos), fontes deduplicadas. Sitemap agora deriva de `MESAS`. Corrigi frases minhas que as tabelas do site não sustentavam ("Velocity mais barato").
- **Cron generalizado** (`monitor.ts` + `api/cron/mesas-check`): Lucid (44 artigos) + FFF (35 páginas: 5 planos, regras, Termos, 27 FAQs). Anti-SSRF agora só aceita URLs EXATAS da lista. Achado: FAQs da FFF não têm `<article>` → extrator cai pro `<main>` (sem isso daria 27 erros/semana). 79/79 lidos, hash estável, caminho "mudou" testado na FFF.
- **FFF: Help Center oficial (60 artigos, `intercom.help/funded-futures-family`)** resolveu as dúvidas e corrigiu 3 pontos que estavam no ar: fechamento diário 16:45 (HC) × 16:15 (FAQ), S2F sem reset, saque aprovado no fim do dia. Regras novas: 7 dias pra ativar a financiada, inatividade semanal, assinatura que continua após estourar, reembolso restrito. Premier+ financiada = 40% pra todas as versões. Base $2K e Prestige só no HC (fora da comparação, avisado na página). Cron agora vigia FFF = 35 páginas + 60 artigos (139 itens no total, 8s). Ambíguos na própria fonte (sinalizados na página): fechamento 16:45×16:15, Premier+ Standard 50%×nenhuma na avaliação, S2F 25K 1 mini×3.
- **Hub `/mesas`**: cards das mesas com destaque (brilho teal, chips dos planos, split e data de conferência, botão alinhado no fundo), por pedido do Marcelo.
- Testes: `test-quiz-mesas.mts` 16 ok, `test-mesas-monitor.mts` 16 ok. tsc/eslint limpos. **Commitado e no ar em 28/09/2026 (ver commit `feat: adiciona Funded Futures Family...`).** Cron da FFF passa a rodar a partir do deploy (1ª execução segunda 05/10 12h UTC).

## 🚧 28/09/2026 — Seção "Mesas Proprietárias" (passos 1 e 2, só localhost)
Seção nova e separada do Drawdown, pública (sem login) em `/mesas` e `/mesas/lucid`.
- **Levantamento oficial da Lucid** (4 planos: Pro/Flex/Daily/Direct) em `docs/mesas-proprietarias/`, lido do site oficial + Help Center (59 artigos). Conferido: 59/59 artigos idênticos, 24/24 números e 33/33 regras batem com os dados do código.
- **Comparativo lado a lado** por tamanho (25K–150K), cards "A favor / Vale saber antes", escalonamento do Flex, fontes com data. Dados como DADO em `src/lib/mesas/` (genérico p/ outras mesas). `/mesas` liberado em `src/proxy.ts` + sitemap.
- **Bloco "Ficou com dúvida?"**: WhatsApp do especialista com mensagem pronta + link do site de cupons dele com modal de aviso ao sair.
- Preço = só "de tabela" (muda toda semana). Cupom VAULT é da própria Lucid, não é afiliado. `linkAfiliado` existe, vazio.
- **Mobile testado** (390/320px): tabela comparativa com rótulo estreito (112px) + coluna fixa, ajuda dos rótulos só no desktop; sem overflow.
- **Quiz "Qual plano combina comigo?" (passo 3, feito)**: 5 perguntas → plano sugerido + motivos + "fique de olho" + alternativa. Motor puro em `src/lib/mesas/quiz.ts`, perguntas como DADO em `quiz-lucid.ts` (cada frase amarrada a regra verificada), UI em `components/mesas/quiz-plano.tsx`. Notícia forte bloqueia a Daily. Testes: `node scripts/test-quiz-mesas.mts` (9 ok). Testado ao vivo em 390px.
- **CTA do especialista (Piero)** no resultado do quiz + bloco "Ficou com dúvida?": nome, "mais de 2 anos no mercado de mesas proprietárias", WhatsApp citando o plano sugerido. Marcelo NÃO recebe nada; aviso de transparência em `contato.ts` (`avisoParceria`).
- **Bloco educativo (feito)**: `/mesas` ganhou "Como funciona uma mesa proprietária" (4 passos, "o que costuma ser bom", "pra ir de olho", glossário de 9 termos em `<details>`), dados em `src/lib/mesas/educativo.ts`. `/mesas/lucid` ganhou "A Lucid como mesa" (vantagens + atenção da mesa toda, campos opcionais `Mesa.vantagens/atencao`, só regra verificada). Testado em 390px, sem overflow.
- **Dourado nos tamanhos (25K–150K)** do comparativo (novo token `--gold` em `globals.css`, reaproveitável) + **link "Mesas Proprietárias" no menu lateral** (grupo Aprendizado, ícone Landmark, `sidebar.tsx`). Sidebar não testada logada por mim (só tsc/eslint).
- **Cron do Help Center (feito, SEM IA)**: `GET /api/cron/mesas-check` (segunda 12h UTC = 9h BRT, em `vercel.json`, protegido por `CRON_SECRET`). Baixa 44 artigos de regras da Lucid (só `support.lucidtrading.com`, anti-SSRF, sem seguir redirect), compara hash com o snapshot no **Upstash Redis** (chaves `mesas:lucid:*`, sem migration) e, se mudou, **push pros admins** + diff guardado em `mesas:lucid:mudancas` e no log. NÃO publica nada: Marcelo revisa `lucid.ts`. 1ª execução só cria a base e avisa "Monitor ativo". `?dry=1` = lê e compara sem gravar nem push. Código: `src/lib/mesas/{monitor,kv}.ts` + `notifyAdminsMesas` em `admin.ts`. Testes: `node scripts/test-mesas-monitor.mts` (9 ok). Validado: 44/44 lidos, hash estável em 2 leituras (0 falso alarme), Redis roundtrip, caminho "mudou" com snapshot adulterado. **Não testado:** push real (só depois do deploy). Resumo por IA (Groq) fica pra depois, só se o diff bruto ficar ruim de ler.
- **Decisão (28/09):** Drawdown fica CENTRALIZADO na seção Drawdown. Não haverá botão "Simular no Drawdown" nas páginas de mesa.
- **✅ COMMITADO (`e8271be`) E NO AR em `meutrade.app` (28/09/2026)**: `/mesas`, `/mesas/lucid`, quiz, educativo, menu e cron. Verificado em produção: páginas 200, sitemap com as 2 rotas, cron sem senha = 401. **Ainda não rodou** o cron em produção (1ª execução segunda 05/10 12h UTC cria a base e manda push "Monitor ativo"). Falta: simulador de saque (adiado pelo Marcelo), 2ª mesa.

## ✅ 27/09/2026 — 3 gaps de LGPD fechados: exclusão de conta, consentimento no cadastro, cookies
Itens 4/5/6 da auditoria de segurança/LGPD desta sessão (ver bloco logo abaixo):
- **Exclusão de conta self-service** (Art. 18 LGPD): `DELETE /api/user` — cancela assinatura Asaas
  ativa ANTES de apagar (senão o Asaas continuava cobrando uma assinatura órfã), depois
  `prisma.user.delete` (todas as 16 relações com `userId` têm `onDelete: Cascade` de verdade no
  banco, confirmado nas migrations — apaga trades, journal, check-ins, setups, planos, API keys,
  notificações etc. numa tacada só). UI em Configurações → "Zona de perigo": modal exige digitar
  "EXCLUIR" antes de habilitar o botão. Admins são avisados por push (`notifyAdminsAccountDeleted`).
  **Testado ao vivo com conta descartável** (`teste.lgpd.claude@example.com`, criada e apagada na
  hora): confirmado no banco que o usuário sumiu, cascade rodou sem erro de FK, e a conta real do
  Marcelo + os 64 trades dele seguem intactos.
- **Consentimento explícito no cadastro** (Art. 5º XII): checkbox obrigatório (desmarcado por
  padrão) substituindo o texto passivo no rodapé do formulário — trava tanto o botão de
  e-mail/senha quanto o "Continuar com Google" até marcar. Campo novo `User.termsAcceptedAt`
  (migration aplicada em produção) grava quando aceitou, nos dois fluxos (rota de registro +
  `events.createUser` do NextAuth pro Google). Testado ao vivo: sem marcar, botão não faz nada;
  marcando, conta criada e timestamp gravado (confirmado direto no Neon).
- **Banner de cookies**: `CookieConsentBanner` — cookies de sessão (login) sempre ativos, sem
  pedir nada; `TrackingScripts` (Meta Pixel + GA/Google Ads) só renderiza depois de aceitar.
  Decisão em `localStorage`, com link "Gerenciar cookies" em Configurações pra mudar de ideia
  a qualquer momento (reabre o banner via evento customizado, sem precisar recarregar a página).
  Vercel Analytics/Speed Insights não usam cookie, ficaram de fora do gate. Testado ao vivo:
  aparece na primeira visita, "Recusar"/"Aceitar" funcionam, "Gerenciar cookies" reabre.
- Política de Privacidade atualizada pra refletir a realidade nova (exclusão self-service
  imediata, banner de cookies) em vez do texto genérico de antes.
- `tsc` + `eslint` + build de produção limpos em tudo. Deploy: aguardando ok do Marcelo.

## ✅ 27/09/2026 — Auditoria de segurança + LGPD, upgrades de dependência e Semgrep de novo
Pedido do Marcelo: avaliação geral de segurança + LGPD. Resultado completo (achados, gaps de LGPD,
prioridades) só na conversa por ora, não copiado pra cá — resumo do que foi corrigido nesta sessão:
- **`npm audit`: 4 críticos → 0.** `next` 16.2.6 → 16.3.6 (RCE/SSRF/DoS corrigidos, sem major bump).
  `next-auth` beta.31 → beta.32 + `@auth/prisma-adapter` 2.11.2 → 2.11.3 (unifica `@auth/core` em
  0.41.3) — fecha os 2 CVEs críticos do Auth.js (fail-open em erro de config; bypass de homóglifo
  no normalizador de e-mail) + 2 HIGH/MODERATE. Testado: tsc + build limpos, 11 testes do
  drawdown-engine ok, login Google E por senha validados ao vivo no localhost pós-upgrade.
- **Semgrep rodou de novo** (pendente desde 16/09) — baseline (`p/security-audit`, `p/secrets`) +
  TypeScript/React/Node/Next.js + Trail of Bits, modo important-only (achados de segurança
  confiança/impacto médio-alto). **0 findings** em 285 arquivos escaneados (todas os 8 scans
  rodaram limpo, 0 falharam). `p/nextjs` cobriu 0 arquivos — glob da ruleset não bate com
  `proxy.ts` (Next 16 renomeou de `middleware.ts`), sem impacto real já que `p/nodejs`/`p/react`
  cobrem o mesmo código.
- **Pendências da auditoria que ainda faltam** (LGPD, menor risco/mais trabalho): fluxo de exclusão
  de conta (a Política promete 30 dias, produto não tem essa função ainda — gap real), checkbox de
  consentimento explícito no cadastro, banner de cookies (GA/Meta Pixel disparam sem opt-in),
  exportação completa de dados pessoais (só tem export de trades em PDF hoje).
- ~14 HIGH restantes no `npm audit` são dependências transitivas (postcss, sharp, prisma engines,
  uploadthing, mysql2, hono, js-yaml etc.) sem exploração real no código do app — baixa prioridade.

## ✅ 27/09/2026 — RESOLVIDO: login Google quebrado no localhost (`redirect_uri_mismatch`)
Causa: o OAuth Client do Google Cloud ("Cliente Web 1", projeto `traderostraderos` — nome do projeto ficou o antigo,
o rebrand foi só de app/domínio) só tinha as origens/redirects de produção (`trader-os-ashy.vercel.app` e `meutrade.app`),
sem `localhost:3000`. Adicionado via Google Cloud Console (só adição, nada removido):
- Origem JavaScript: `http://localhost:3000`
- URI de redirecionamento: `http://localhost:3000/api/auth/callback/google`
**Testado ao vivo:** login completo com a conta `difoggijuniormarcelo@gmail.com` no `npm run dev` local, chegou no
`/dashboard` sem erro. Login por e-mail/senha não foi tocado (já funcionava).

## ✅ 27/09/2026 — Coluna `drawdownRules` no banco + API/Zod/plan-guard (Drawdown sai do localStorage)
- **Migration aplicada em produção (Neon):** `drawdownRules JSONB` nullable em `trading_accounts`, via `prisma migrate deploy`
  (migration manual `20260927130204_add_drawdown_rules` — o `migrate dev` não rodou por um drift pré-existente no shadow
  database numa migration de julho, sem relação com essa mudança; `migrate deploy` não usa shadow db, então não foi afetado).
  Campo espelhado no `schema.prisma`. Sem risco: coluna aditiva/nullable, sem default, não mexeu em dado existente.
- **Nova rota `GET/PUT /api/accounts/[id]/drawdown-rules`:** autentica, confirma dono da conta (`userId`), valida o body
  com Zod (schema espelha `AccountRules`) e **reforça `enforcePlan` no servidor** antes de salvar — um PUT direto na API
  não consegue "vazar" regra Pro/Starter pra quem não paga, mesmo que o front (que já travava isso) seja contornado.
- **`real-tab.tsx` trocou `localStorage` pela API:** ao abrir a conta, busca as regras salvas no servidor; se não tem nada
  lá ainda, migra automaticamente o que estava salvo no navegador (v1) e já manda pra API — ninguém perde a regra que já
  tinha configurado. `saveStoredRules` (não usada mais) removida de `drawdown-rules.ts`; `loadStoredRules` ficou só pra
  essa migração pontual.
- **Testado:** `tsc --noEmit` + `eslint` limpos nos arquivos tocados; rota sem sessão devolve 401 (GET e PUT); roundtrip
  do JSONB validado direto no banco de produção dentro de uma transação com rollback forçado (não persistiu nada) —
  valores batem 100% (a diferença de ordem das chaves no JSON é normal do Postgres, não é bug).
- **Testado ao vivo também:** login Google local foi consertado na mesma sessão (ver item acima) — confirmei o fluxo
  completo logado, incluindo abrir a conta na seção Drawdown.
- **Commitado** (`c437176`) — falta decidir sobre deploy pra produção.

## 💡 24/09/2026 — Ideia em STANDBY (definido pelo Marcelo): "Importar por imagem"
Marcelo: usuário sobe print do painel da mesa (ex.: Lucid "Account Summary") e o app lê a configuração da conta. Viável (visão do Claude via SDK Anthropic já no projeto).
- **Lê direto do print da Lucid:** plano (LucidFlex 50K), tipo EOD, nº da conta (casa com `brokerName`), saldo, MLL, meta, trading days, limite diário ($1.200), % de consistência atual.
- **Não está no print (perguntar/inferir):** drawdown $ (inferível: saldo de fechamento − MLL), trava do trailing, virada do dia, LIMITE % de consistência.
- **Ganhos:** preencher regras (com confirmação do usuário) + **conferir com a mesa** (MLL do painel × MLL calculado: 48.434 × 48.433,50) + detectar trade faltando (saldo do painel × saldo do app).
- **Cuidados:** não guardar a imagem (só os campos), validar saída com Zod, tratar texto da imagem como dado (prompt injection), sempre confirmar antes de aplicar, rate limit, contar na cota da Vega (Free 0 / Starter 5 / Pro 40), aviso de que print pode ter dado sensível.
- **Depende de:** coluna `drawdownRules` no banco (decisão pendente). Depois: mesmo ponto de entrada pra CSV/PDF.

## ✅ 24/09/2026 (tarde) — Drawdown: tutorial (SectionTour) + botão "Tutorial" + testes de celular da v2
- Tutorial `drawdown` (6 passos: Real/Simular, regras, herói, corredor, placar, quanto cabe arriscar) em `tour-content.ts`; `SectionTour` + `tourId="drawdown"` no Header (botão de replay igual às outras páginas). Sem migration: usa `User.seenTours` existente.
- **Testes mobile da v2 (preview sem login, dados de exemplo):** 390px Real/Pro → sem overflow horizontal (scrollWidth 384); 320px Simular/Free → sem overflow (314); tutorial abre no celular (passo 1 de 6). v1 (Free/Simular 390px) já tinha sido testada antes. **Não testado:** app logado em produção no celular, gráfico com toque real em aparelho, tutorial passo a passo até o fim.
- Detalhe conhecido: select "Trava do trailing" corta o texto em 320–390px (cosmético).

## ✅ 24/09/2026 (tarde) — Drawdown v2: visual PRÓPRIO (não cópia do simulador da aula)
Feedback do Marcelo: linhas/estilo idênticos ao print do Piero → "usar como inspiração, fazer melhor e diferente". Redesenhado:
- **Herói "Quanto ainda posso perder"** (margem da regra em foco, termômetro com zonas Folgado >60% / Atenção 30–60% / Perigo <30% / Quebrou).
- **Gráfico "Corredor de segurança"** (`drawdown-chart.tsx`): área sombreada entre patrimônio e limite da regra em foco (cor da zona), regras em comparação
  como linhas finas, **rótulos diretos** no fim das linhas (sem legenda de tracejado), meta pontilhada, paleta nova + **marcadores por forma** (círculo/quadrado/losango/triângulo).
- **Placar das regras** no lugar dos 4 cards iguais: barra de margem por regra, zona, clique põe em foco, frase "X é a mais apertada: $N a menos que Y".
- **Novo: "Quanto cabe arriscar agora"** (Starter): ativo + stop em pts + % da margem → risco por trade, contratos e stop máx.; respeita o que resta do limite diário.
- Consistência com barra e marca do limite. `rule-style.tsx` = paleta/zonas/marcadores. tsc + eslint limpos, 11 testes ok; testado 1280px (Pro/Real e Simular).
- Pendências: coluna `drawdownRules` no banco (aguarda autorização do Marcelo); calibração com painel da mesa.

## ✅ 24/09/2026 (meio-dia) — Seção "Drawdown" NO AR (`/drawdown`, menu Ferramentas)
- **Abas Real e Simular**, mesmo motor (`drawdown-engine.ts`). Simular: +$100/+$500/−$100/−$500, Fechar posição, Encerrar dia, Desfazer,
  Reiniciar, cenários prontos (Próximo passo/Reproduzir), gráfico com tooltip, 4 cards (limite, margem, falta pra meta, barra, status).
  Real: contas do usuário, regras editáveis, trades reais → passos (`stepsFromTrades`, pior caso: pico antes do fundo), consistência, virada do dia.
- **Cadeados (Free/Starter/Pro):** campo visível e travado; clique/toque abre o `UpgradeModal` do app. Free: saldo/meta/DD + Static/Intraday + Simular manual +
  1 conta Real. Starter: + End of Day + limite diário. Pro: tudo (End of Position, trava, consistência, virada, dias mín., cenários, presets, várias contas).
  ⚠️ Gate é **só no front** por enquanto (calculadora, sem dado sensível); API/servidor entra junto com a coluna no banco.
- **Persistência v1 = localStorage** (por conta, neste navegador). ⚠️ A coluna `drawdownRules JSONB` em `trading_accounts` foi **bloqueada** pelo classificador de
  segurança (ALTER no Neon de produção). Migration pronta pra recriar: `ALTER TABLE "trading_accounts" ADD COLUMN IF NOT EXISTS "drawdownRules" JSONB;`.
  Decisão do Marcelo: rodar/autorizar → depois trocar `loadStoredRules/saveStoredRules` (`drawdown-rules.ts`) por API + Zod + `plan-guard`.
- **Presets (dado, só o verificado):** Lucid Flex 50K (painel do Marcelo) e Apex EOD 25/50/100/150K (tabela do PDF). Trava do trailing em branco de propósito.
- **Validação:** End of Day calculado com os trades reais da LFE = limite **$48.433,50** ≈ MLL do painel da Lucid ($48.434). 11 testes ok (`node scripts/test-drawdown-engine.mts`).
- **Pendências:** coluna no banco; calibração "limite segundo a mesa"; presets de outras mesas (só com regra confirmada); versão pública/SEO; `Aprovada` já no seletor.
- Testado com preview temporário (removido) em 1280px (Pro/Real) e 390px (Free/Simular): sem overflow, cadeado intercepta clique.

## ✅ 24/09/2026 (manhã) — Seletor com "Aprovada" sempre visível + deploy + diagnóstico do localhost
- **Calendário e Analytics:** seletor agora é `Todos / Avaliação / Aprovada / Teste` **sempre** (antes só aparecia o tipo com trade no mês →
  conta aprovada sumia). Tipo sem trade fica esmaecido; escolher um vazio mostra o mês/aviso vazio sem quebrar. `BUCKETS` em `src/lib/accounts.ts`.
- **Calendário:** "Dia negativo (avg)" mostrava `-$0` sem dia negativo → agora `—`.
- **Deploy:** commit `fa03545` (motor de drawdown + seletor) → `vercel deploy --prod` → aliased `meutrade.app`.
- **Localhost:** dev server sobe normal (login 200). Erro era só o **Google OAuth** (`redirect_uri_mismatch`). O login **e-mail/senha funciona no local**
  (usuário Marcelo tem senha). Correção definitiva = adicionar `http://localhost:3000/api/auth/callback/google` (+ origem `http://localhost:3000`)
  no OAuth Client do Google Cloud. ⚠️ O `.env` local aponta pro Neon de PRODUÇÃO (mesmo banco) — cuidado com escrita nos testes.
- **Achado no calendário (não é bug, é regra de dia):** grade agrupa por dia-calendário BR (22/09 +$236, 23/09 +$198, 24/09 +$239 = +$673); a Lucid
  agrupa por *trading day* (virada 18h): 22/09 +$411,50, 23/09 +$22, 24/09 +$239. O trade da noite de 22/09 (−$175,50, ~21h30) cai no dia 23 da Lucid.
  Total bate. Vai virar parâmetro "hora de virada do dia" na seção Drawdown.

## 🚧 24/09/2026 — Seção "Drawdown" (calculadora de drawdown de mesa) — motor pronto, sem tela ainda
Ideia do Marcelo (aula do Théo mostrou um simulador de 4 tipos de drawdown). Decisões:
- **Nome:** "Drawdown" (rota `/drawdown`, subtítulo "Calculadora de drawdown") — "Mesas" confundia com comprar mesa.
- **Genérico, sem amarrar em mesa:** regras = parâmetros (`DrawdownRules`); mesas viram **presets como dado**
  (híbrido: poucos presets verificados + "Personalizada"). Regras guardadas em **coluna JSON validada com Zod** na `TradingAccount`.
  Só regra de dinheiro (drawdown, trava, meta, limite diário, consistência, virada do dia, dias mínimos).
- **4 tipos = 1 regra, muda QUANDO o pico atualiza:** Intraday (a cada tick, com aberto) · End of Position (fecha posição) ·
  End of Day (encerra dia) · Static (nunca). Meta é LUCRO (nível = saldo inicial + meta).
- **2 modos, mesmo motor:** Simular (botões +$100/−$500, cenários prontos, Próximo passo/Reproduzir) e Real (lê os trades da conta;
  MFE como pico intraday = estimado, pior caso). Campo de calibração "limite atual segundo a mesa".
- **Free × Starter × Pro (cadeado, campo visível):** Free = saldo/meta/drawdown + Static e Intraday + Simular manual + 1 conta Real básica.
  Starter = Free + End of Day + limite diário. Pro = tudo (trava, consistência, End of Position, virada/dias mínimos, cenários, replay, presets,
  calibração, todas as contas). Clique/toque no cadeado → aviso "liberado no Pro" + Ver planos. **Bloqueio também no servidor** (`plan-guard.ts`).
- **Feito:** `src/lib/drawdown-engine.ts` (motor puro) + `scripts/test-drawdown-engine.mts` (10 testes ok: cenário "lucro aberto devolvido",
  referência dos cards da aula, trava, limite diário, consistência com os números reais da LucidFlex). tsc limpo. `tsconfig` exclui `scripts/*.mts`.
- **Achado:** o motor bateu com os cards do simulador da aula (equity 51.600 → limites 49.600/48.000, margens 2.000/3.600, barras 59%/72%).
- **Próximo:** tela "Simular" no localhost (checkpoint) → migration da coluna de regras → modo Real → cadeados/planos. Login local segue quebrado (`redirect_uri_mismatch`) → usar página de preview temporária.
- Rodar testes: `node scripts/test-drawdown-engine.mts`

## ✅ 23/09/2026 (noite, v3.1) — Analytics testado e ajustado pra mobile
Testado em 320/390/768px com página de preview temporária (removida) + dados sintéticos: sem overflow
horizontal, tooltip por toque OK, modal vira bottom sheet OK. Ajustes: lista "onde escapou dinheiro" quebra
em 2 linhas, tabela de comportamento com rótulos curtos, contagem por horário visível no cel, eixo X com
labels alternados no cel, "?" com área de toque maior + safe-area no modal, recorte do diagrama MFE/MAE,
plural "dia/dias", espaço faltando no veredito da entrada.

## ✅ 23/09/2026 (noite, v3) — Analytics: gráficos interativos + explicações + diagnósticos + "E se" completo
Pedido do Marcelo: números nos gráficos (hover/toque), modal explicando MFE/MAE/Drawdown, seção Analytics
mais densa (análise de verdade pra melhorar entrada) e "E se" menos vago.
- **Equity Curve + Drawdown:** eixo Y com números + crosshair/tooltip no hover e no toque (`scrub-plot.tsx`,
  compartilhado). Pontos/textos em HTML posicionado em % (SVG `preserveAspectRatio="none"`).
- **Modal "o que é isso?"** (`explain-modal.tsx`): MFE, MAE (com diagrama), captura, drawdown, profit factor,
  expectância, "como funciona o E se". Botão "?" nos KPIs e cabeçalhos.
- **Diagnósticos novos** (`insights.tsx`, cálculos puros em `src/lib/analytics-insights.ts`): entrada (MAE wins vs
  losses), lucro deixado na mesa (MFE vs saída + losses que já estiveram no verde), horário (BR), comportamento
  (pós-loss, reentrada ≤15min, overtrading), dias + distribuição + concentração (melhor dia/trade), banner amostra <30.
- **"E se" reescrito:** stop simulado, alvo, stop+alvo (assume stop primeiro se ambos), parar após N losses/dia,
  máx N trades/dia, sem pior hora, sem pior dia da semana, sem 3 piores losses. Sliders, equity real vs cenário,
  quantos trades melhoram/pioram. "Melhor histórico" só sugerido se supera o real (com dados reais o melhor stop
  rendia MENOS que o real: $1.092 vs $1.469 — o app agora diz isso).
- Validado com os 26 trades reais do Marcelo (base bate: $1.468,70). `tsc` + eslint limpos.
- ⚠️ Não testado visualmente antes do deploy (login localhost quebrado — `redirect_uri_mismatch`). Ajustar ao vivo.

## ✅ 23/09/2026 (noite, v2) — Fix de bug real achado no primeiro deploy da vela
Marcelo testou ao vivo em produção e apontou 2 problemas concretos na primeira
versão da vela:
1. **Bug de sobreposição de texto:** quando o MAE bate exatamente no ponto de
   saída (trade que estoura o stop sem devolver nada — CASO MAIS COMUM),
   a linha do MAE e a linha da Saída caíam na mesma altura e os textos ficavam
   ilegíveis, grudados um no outro. Fix: se MAE/MFE coincide (±4% da altura do
   gráfico) com entrada ou saída, não desenha uma linha própria — vira um
   selinho pequeno colado na linha que já existe.
2. **Vela sem destaque visual:** corpo estreito demais, pavio quase invisível
   (1px cinza). Fix: corpo mais largo (w-20, borda dupla, mais opacidade),
   pavio mais grosso (2px, colorido igual o corpo) com "caps" (bolinhas) nas
   pontas, deixando claro onde o preço bateu o extremo.
`tsc --noEmit` limpo.

## ✅ 23/09/2026 (noite) — Gráfico de Execução vira vela de verdade + link TradingView removido
`src/components/journal/trade-execution-chart.tsx`: o "Gráfico de Execução" do
detalhe do trade (`/journal/[id]`) era um retângulo colorido preenchendo quase
toda a largura — Marcelo reportou como "vela larga e zoada". Redesenhado pra
virar uma vela de verdade: corpo estreito (entrada↔saída, como open/close) +
pavio fino (MFE↔MAE, como high/low de um candle real), centralizados, sem os
blocos de fundo largos que causavam a poluição visual.

Removido o botão/link "TradingView" do card: usava um parâmetro `timestamp` na
URL que o site público do TradingView simplesmente ignora — não existe suporte
deles pra abrir num candle histórico específico via link direto (confirmado
testando ao vivo: abriu o gráfico atual do ativo, não o momento do trade).
Decisão do Marcelo: tirar por enquanto, sem prometer algo que não funciona.
Pra fazer de verdade no futuro, precisa da TradingView Charting Library (cadastro
+ aprovação deles) + uma fonte de dados históricos paga — fica como ideia pro
futuro, não decidido ainda. `tsc --noEmit` limpo.

**Achado à parte:** login no localhost dá erro 400 `redirect_uri_mismatch` do
Google OAuth (o Client ID não tem `http://localhost:3000` nos redirect URIs
autorizados). Não é bug do app nem perda de dado — os trades do Marcelo (24)
seguem intactos no Neon, confirmado via query direta. Não corrigido ainda
(baixa prioridade, só afeta teste local); pra resolver, precisa adicionar
`http://localhost:3000/api/auth/callback/google` nos redirect URIs autorizados
do OAuth Client no Google Cloud Console.

## ✅ 23/09/2026 (tarde) — Toggle por tipo também no Calendário
Mesmo padrão do Analytics: seletor "Todos / Avaliação / Teste" no topo do
`/calendario`, filtrando P&L do mês, win rate, dias operados, melhor/pior dia,
dias lucrativos e a grade inteira do calendário por tipo de conta. Ao trocar de
mês pelas setas (`CalendarNav`), o filtro de tipo agora vai junto na URL — antes
resetaria pra "Todos" a cada navegação de mês. Extraído `bucketOf`/`BUCKET_META`
pra `src/lib/accounts.ts` (já era a 3ª página repetindo a mesma lógica de balde
EVAL/PA/TEST — Analytics também passou a importar dali). `tsc --noEmit` limpo.

## ✅ 23/09/2026 — Fix gráfico Carteira + toggle por tipo no Analytics
1. **Fix equity curve da Carteira** (`src/app/(app)/carteira/page.tsx`): no modo "Por
   tipo", cada linha (Avaliação/Teste) calculava sua própria escala de tempo a partir
   do PRÓPRIO primeiro trade. Um tipo com atividade recente e concentrada num único dia
   (ex: Avaliação, só trades de 22/09) ficava espremido numa fatia mínima de pixels no
   canto do gráfico compartilhado, virando um traço solto e desconexo — feio e confuso.
   Fix: todas as séries agora compartilham o mesmo intervalo de tempo (primeiro trade
   ativo geral até hoje), com lead-in plano no saldo inicial e extensão plana até hoje
   quando o tipo não operou nos últimos dias.
2. **Toggle "Todos / Avaliação / Teste" no Analytics** (`src/app/(app)/analytics/page.tsx`):
   pedido do Marcelo pra poder "surfar" entre tipos de conta na página inteira, não só
   na Carteira. Via query param `?tipo=EVAL|PA|TEST`, filtra o dataset de trades ANTES
   de calcular qualquer métrica — então KPIs, Equity Curve, Drawdown, streaks, MFE/MAE,
   sessão/instrumento/setup e o Simulador "E se" reagem juntos ao filtro escolhido. Só
   mostra no seletor tipos que realmente têm trade; se o filtro ativo zerar os trades,
   mostra mensagem + mantém o seletor visível (não prende o trader sem como voltar).
`tsc --noEmit` limpo nos dois. Testado no localhost pelo Marcelo antes do deploy.

## ✅ 23/09/2026 (cedo) — CORRIGIDO: import CSV NinjaTrader PT-BR zerava P&L negativo
Bug achado em 22/09 (fills que saem no stop importavam como P&L $0,00 em vez do valor
real). Causa raiz: `parseBRNumber` em `src/components/journal/importar-client.tsx` não
removia o espaço entre `-` e o número em `"-$ 117,00"`, e `parseFloat("- 117.00")`
retornava `NaN` → caía no fallback `0`. Fix: remove todo espaço em branco antes de
trocar a vírgula decimal. Validado com os 4 casos de teste do plano e reprocessando o
CSV real de 22/09 fora do app (script isolado, sem login) — os 2 fills do stop agora
saem `-$117,00` e `-$58,50`, P&L total do dia bate em `$236,00`. `tsc --noEmit` limpo.
Detalhe completo em `docs/bug-import-csv-pnl-negativo-zerado.md`. **Pendente:**
`parseNinjaTrader` (EN) e `parseTradovate` não foram tocados — usam formato decimal
diferente (ponto, sem inversão BR) e não têm um CSV real de exemplo em mãos ainda pra
confirmar se sofrem do mesmo problema.

## Última atualização: 22/09/2026 — Checklist de pendências revisado. **Rate limiting na IA: ✅ já implementado** (`src/lib/rate-limit.ts` — Upstash Redis distribuído com fallback in-memory, nunca derruba a request se o Redis falhar) e cobre todos os pontos certos: login (8/5min), registro (8/10min), Vega chat `ask-claude` (20/min), análise de trade IA (15/min), check-in IA (10/min), resumo semanal (5/min; o cron em si é protegido por `CRON_SECRET`, não precisa de rate limit). Pode ser considerado feito. **Semgrep: ✅ já rodou** em 16/09 (baseline p/security-audit+secrets, TypeScript/React/Node/Next.js + Trail of Bits) — mas isso foi ANTES do código novo de 17-18/09 (tours guiados, import CSV, fixes de conta teste abaixo), que ainda não passou por scan. Recomendo rodar de novo quando der.
### Documentado aqui o que faltou registrar de 17-18/09 (trabalho real, só não tinha entrado no progress.md/histórico):
- **Tours guiados contextuais** em todas as páginas principais (Dashboard, Vega IA, Carteira, Journal, Progress, Analytics)
- **Import de CSV do NinjaTrader em português** com detecção automática de multi-conta
- **Seleção múltipla + delete em lote** no Journal
- **Fix de conta teste vazando** em Analytics e Calendário (múltiplos commits de auditoria — toda leitura de trades agora exclui/inclui conta teste de forma consistente)
- **Fix de import de CSV** não atualizava XP nem streaks (journal/dias lucrativos)
- Fix de filtro de data do Journal (travava digitando, ano virava "0006")
- Fix de onboarding reabrindo quando trades reais zeravam; fix de tour repetindo em navegador/dispositivo novo
- OG image dinâmica no link de compartilhamento de trade
- Lembrete de streak de check-in em risco (retenção)

## 17/09/2026 — 🚀 MEUTRADE.APP NO AR, LIBERADO PRA DIVULGAÇÃO. Sessão de hardening + rebrand completo: (1) webhook Asaas forjável corrigido (token rotacionado + validação cruzada com a API do Asaas, histórico git limpo); (2) Semgrep completo — CSP enforce, 34 erros de lint zerados; (3) **Guardian/Apex removidos do produto inteiro** (código, UI, trilha educacional, marketing) — "app do trader, não da Apex", qualquer mesa proprietária pode usar; (4) Termos de Uso + Política de Privacidade criados (LGPD); (5) sync automático NT8/MT5 pausado de propósito via flag reversível (`src/lib/integration-flags.ts`) até a base do produto ficar "redonda"; (6) landing/planos corrigidos pra não prometer sync que está pausado; (7) **2 bugs reais achados testando ao vivo** (não só lendo código) antes de gravar vídeo de divulgação: simulador "E se?" calculava eficiência de saída errado (chegava a -241% com trades perdedores), e input de upload de screenshot vazava por cima do botão em mobile (Tailwind v4 não gerava a classe `sr-only` de uma lib externa). Ambos corrigidos, testados e deployados. Domínio agora é **meutrade.app** (não mais trader-os-ashy.vercel.app). Detalhe completo: `historico/2026-09-17.md`.
## (29/06: PAYWALL PLUGADO EM TODOS OS GATES — ver linha original abaixo) Helper único `src/lib/plan-guard.ts` lê limites do `plans.ts` e devolve 403 padrão (`upgrade:true`+`suggestedPlan`) que o front usa pra abrir o modal. Gates: trades (corrigido BUG do Starter travar em 10 → agora 10/25/∞), setups (0/5/∞), integrações (0/1/∞), Vega check-in (buraco do backend FECHADO, agora Starter+), Vega chat (Pro-only, resposta padrão). Validado: tsc 0 erros + next build OK + teste 15/15 da matriz de limites. Contas (1/1/∞) ficou de fora de propósito (criação implícita compartilhada com sync dos bots). Ver historico/2026-06-29.md
## (28/06: Asaas modo real produção — conta PF, ASAAS_ENV=production, webhook prod, smoke test OK. Ver historico/2026-06-28.md)
## 🚨 GOTCHA: API key começa com `$` → Next expande e zera → escapar `\$` no .env E na Vercel. Token webhook ≥32 chars.
## ⚠️ PENDÊNCIAS: (1) Pix não aparece no checkout → cadastrar chave Pix no painel Asaas; (2) personalizar nome fantasia "TraderOS"+logo (hoje mostra nome/CPF por ser PF). ~~(3) migrar p/ PJ quando tiver CNPJ~~ — resolvido (Marcelo confirmou em 22/09).
## (28/06 manhã: pagamento Asaas implementado + testado sandbox; 25/06: Painel Admin + push cadastro + planos/custos; 20/06: Carteira multi-corretora; 18/06: Web Push)

## 📌 Visão Geral
- **Objetivo:** MeuTrade — plataforma SaaS pro trader brasileiro de qualquer mercado/mesa proprietária (não mais específico de Apex)
- **Stack:** Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Prisma 7 + Neon PostgreSQL + NextAuth v5
- **Status:** NO AR, liberado pra divulgação pública (17/09/2026) — segurança, rebrand e QA validados de ponta a ponta
- **URL Produção:** https://meutrade.app ✅

## ✅ Concluído

### Sessão 1 — 18/05/2026
- [x] Projeto Next.js 16 inicializado (TypeScript, Tailwind v4, shadcn/ui Base UI)
- [x] Prisma 7 configurado com `@prisma/adapter-pg` (breaking change v7)
- [x] Schema Prisma completo: 13 modelos (User, Trade, Setup, CheckIn, Achievement, Streak, etc.)
- [x] NextAuth v5 — Google OAuth + Credentials
- [x] Identidade visual "Terminal" (teal #00C2A8, fundo #080C14)
- [x] Layout autenticado: Sidebar fixa com XP bar + Header com user menu
- [x] Dashboard com métricas, performance chart semanal, streaks, trades recentes
- [x] Página de login (Google + email/senha)
- [x] `proxy.ts` (Next.js 16 breaking change — era middleware.ts)

### Sessão 2 — 19/05/2026
- [x] Neon PostgreSQL conectado + migration inicial aplicada (13 tabelas)
- [x] Google OAuth Client ID/Secret configurados no .env
- [x] **Journal completo:** listagem, filtros, paginação, criação, edição, deleção, detalhe
- [x] PnL automático por ativo (NQ=20, ES=50, MNQ=2, MES=5, etc.)
- [x] Limite Free: 10 trades/mês (verificado server-side)
- [x] XP +10 por trade registrado
- [x] **Check-in Emocional:** 5 métricas, score de risco, XP +5
- [x] **Biblioteca de Setups:** CRUD, stats por setup, gate de plano Trader+

### Sessão 3 — 19/05/2026 (noite)
- [x] **Módulo Progress completo:**
  - Sistema de XP quadrático (nível × 500 XP) com 10 títulos (Aprendiz → Lendário)
  - 12 conquistas com progresso real (trades count, win streak, journal streak, setups)
  - 4 tipos de streak com current/best e barra de progresso
  - Tab Histórico com 8 métricas gerais
- [x] **Guardian completo:**
  - 6 tamanhos de conta Apex (PA 25K a PA 250K) com regras reais
  - Calculadora de trailing drawdown (floor, margem, progresso, semáforo de risco)
  - Consistency Rule checker (detecta violação dos 30% por dia)
  - Scaling Plan (tiers de contratos por lucro acumulado)
- [x] **Página de Cadastro** (`/cadastro`) — email+senha + Google, login automático após cadastro
- [x] **API /api/auth/register** — bcrypt hash + verificação de duplicata
- [x] **Página de Planos** (`/planos`) — Free / Trader R$47 / Pro R$97, "Seu plano" destacado

### Sessão estética — 30/05/2026 (noite) + 31/05/2026
- [x] **IA no Check-in (Vega):** endpoint `/api/checkin/ai-insight`, fallback de 18 respostas pré-escritas, segmentação por plano FREE vs TRADER/PRO
- [x] **Drawdown Chart visual** em /analytics — SVG de área com pior ponto marcado
- [x] **Export PDF do Journal** — rota `/journal/print`, A4 landscape, auto-print, respeita filtros
- [x] **Fix deploy** — cast de `user.plan` para union type resolvido no Vercel
- [x] **Tier 1 Estética (7/7 itens):**
  - StatsCards com accent bar colorida (profit/loss/teal/neutral) + gradient overlay
  - Sidebar active indicator: barra vertical teal 2px à esquerda (estilo Linear)
  - Background com radial gradient fixo (profundidade de tela)
  - Botão Google com ícone "G" oficial colorido (substituiu Globe genérico)
  - Logo do login com drop-shadow teal
  - XP bar mais espessa (h-2) + gradient + glow neon
  - Plan badge maior com borda colorida por plano

### Fix deploy — 01/06/2026
- [x] **Vercel Analytics + Speed Insights** — `@vercel/analytics` e `@vercel/speed-insights` instalados e funcionando em produção
- [x] **Fix lockfile** — `npm error Invalid Version: ` resolvido (campo `version` faltando em dep opcional do lockfile)

### Sessões 15-18/06/2026 — Robustez do sync + alertas
- [x] **Bug auth API Key (15/06):** geração salvava plaintext e validação usava hash SHA-256 → 401 em toda key nova. Centralizada a lógica em `src/lib/apikey.ts` (fonte única) + `scripts/audit-apikeys.mjs`. Keys recriadas e validadas (HTTP 201).
- [x] **AddOn v9 (15/06):** fila sequencial (`BlockingCollection` + worker) com retry 4x/backoff substituindo fire-and-forget → resolve "A task was canceled" em rajada/replay. `public/TraderOSSync.zip` regenerado (o tutorial do app serve a v9). Validado ao vivo na conta do Andersson.
- [x] **Trades de simulação separados (18/06):** conta `Sim101` → label `TEST` no sync, não suja métricas reais. Paginação do journal corrigida.
- [x] **🔔 Alertas de trade in-app (18/06):** quando um trade chega via sync do NinjaTrader, o app gera um alerta em tempo real (foco em quem roda bot na conta).
  - Backend: `POST /api/sync/ninjatrader` cria uma `Notification` tipo `TRADE_ALERT` após salvar o trade (helper `src/lib/trade-alert.ts`, com try/catch — nunca derruba o sync). `content` guarda os dados em JSON (result, pnl, instrumento, direção, qtd, conta, sessão).
  - Sino do header (`notification-bell.tsx`): passou a fazer **polling a cada 30s** + dispara um **toast colorido** (verde/vermelho conforme WIN/LOSS) no canto superior direito quando chega trade novo. `localStorage` evita repetir o toast ao navegar entre páginas.
  - Página `/notificacoes`: card dedicado pro `TRADE_ALERT` (compacto, colorido por resultado, com PnL/instrumento/conta/sessão).
- [x] **🔔 Web Push — alerta no celular/desktop com o app FECHADO (18/06):** igual Instagram/Nômade Trader. Estudado e replicado o padrão do Nômade.
  - Lib `web-push` + VAPID keys (3 env vars na Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`).
  - Tabela nova `PushSubscription` (endpoint único, p256dh, auth, userId) — `prisma db push`.
  - `src/lib/push.ts`: `sendPushToUser` envia pra todos os devices e remove subscriptions mortas (410/404). Nunca lança.
  - `public/sw.js` v2: handlers `push` + `notificationclick` (abre /notificacoes ao tocar).
  - Rotas `/api/push/subscribe` (POST/DELETE) e `/api/push/test`.
  - Componente `PushNotifications` em **Configurações**: botão "Ativar notificações", botão de teste, detecção de iPhone (mostra passo a passo de instalar o PWA — Apple só permite push no app instalado na tela inicial, iOS 16.4+).
  - Trigger: trade do bot chega no sync → cria notificação in-app → dispara o push.
  - ⚠️ iPhone: SÓ funciona com o PWA instalado na tela de início. Android/desktop: navegador normal.

### 💳 Pagamento Asaas — 28/06/2026 (CÓDIGO COMPLETO, falta deploy+config)
- **Gateway:** Asaas via **Link de Pagamento recorrente** (`chargeType=RECURRENT`). A página hospedada do Asaas coleta CPF/forma de pagamento — não guardamos PII. 1 link por usuário/checkout.
- **Fonte única `src/lib/plans.ts`:** preços (Starter R$19,90 / Pro R$97/mês ou R$1.000/ano), labels (enum `TRADER` = "Starter" na UI), limites por plano (trades, setups, Vega, contas, integrações).
- **Cliente `src/lib/asaas.ts`:** sandbox/prod por `ASAAS_ENV`, `createRecurrentPaymentLink`, `deletePaymentLink`, `cancelSubscription`. URL sandbox: `https://api-sandbox.asaas.com/v3`.
- **Checkout `POST /api/asaas/checkout`:** auth → cria link recorrente com `externalReference="userId|PLAN|CYCLE"` → retorna `url` (front redireciona). Plano só sobe quando o webhook confirma.
- **Webhook `POST /api/asaas/webhook`:** autentica via header `asaas-access-token` == `ASAAS_WEBHOOK_TOKEN`. `PAYMENT_RECEIVED/CONFIRMED` → sobe plano + `accessSource=PAID`. `PAYMENT_OVERDUE/DELETED/REFUNDED` → desce p/ FREE, **MAS nunca rebaixa `accessSource=MANUAL`** (comunidade liberada na mão). Idempotente (upsert). Sempre retorna 200. Adicionado a `PUBLIC_API_PREFIXES` no `proxy.ts` (público; checkout continua exigindo sessão).
- **Schema:** `User.accessSource` (PAID/MANUAL/null) + `Subscription.asaasCustomerId/asaasSubscriptionId/billingCycle`. Aplicado via `db push` (colunas nullable, sem perda).
- **Paywall:** modal global `src/components/upgrade-modal.tsx` (montado no layout), helper `openUpgradeModal()` (`src/lib/upgrade.ts`). Disparado no **403 de limite** ao criar trade (`trade-form.tsx`). Leva pra `/planos`.
- **Página `/planos`:** preços novos + toggle mensal/anual no Pro + botões funcionais (chamam checkout e redirecionam). Server (`page.tsx`) + client (`planos-client.tsx`).
- **Testes:** `scripts/test-asaas-webhook.mjs` — E2E (cria user → paga → confere PRO/PAID → atrasa → FREE → MANUAL não rebaixa → limpa). ✅ TODOS PASSARAM. Build de produção ✅. Fluxo Asaas (criar cliente/link) validado via curl no sandbox.
- ⚠️ **FALTA PRA IR AO AR:** (1) deploy Vercel; (2) setar `ASAAS_ENV`/`ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN` na Vercel; (3) painel Asaas → Webhooks → URL `https://DOMINIO/api/asaas/webhook` + token igual ao env; (4) teste de pagamento sandbox real. Depois: trocar `ASAAS_ENV=production` + chave de produção (exige conta real + CNPJ/CPF + dados bancários).

## 🚧 Em progresso
- **Integração NinjaTrader (AddOn):** código reescrito em `integration-section.tsx`, aguardando teste de compilação no NT8 real

### Estética Tier 2 — 31/05/2026 (3/3 entregues)
- [x] **Count-up animation** — StatsCard vira client component, hook useCountUp (easeOut 700ms), props numericValue/formatValue
- [x] **Bottom navigation bar mobile** — 5 itens fixos: Dashboard, Journal, FAB +Trade (teal), Analytics, Guardian. Oculto em lg+
- [x] **Empty states com SVG** — SVG monocromático de chart vazio (Analytics) e livro aberto (Journal/TradeList)

## 🚀 Soft-launch comunidade Nômade Trader — 08/06/2026
- **Decisão:** abrir pra poucos alunos selecionados, **de graça**, só pra validação. Sem pagamento por ora.
- **Auditoria feita:** núcleo 100% funcional e seguro (Journal, Guardian, Analytics, Check-in, Setups, IA Vega/Ask Claude, Sync NinjaTrader, gamificação). Gate de Setups está protegido no backend (`setups/route.ts:63`).
- **Env vars:** confirmadas todas na Vercel ✅ (IA, email e upload funcionam pros alunos).
- **Script de acesso:** `scripts/promote-users.mjs` — promove alunos pra PRO por email (não há checkout). Fluxo: aluno se cadastra → rodar script → aluno faz logout/login (JWT cacheia plano ~1h).
  - Uso: `node scripts/promote-users.mjs aluno@email.com` (suporta `--plan=TRADER` e `--dry`).
- **Trilha de Aprendizado:** ✅ CONSTRUÍDA em 08/06/2026 — 5 módulos, 30 aulas escritas (Fundamentos → Gestão de Risco → Leitura de Mercado → Psicologia → Apex). Conteúdo em `src/lib/trilha-content.ts` (editável). Progresso por aula via localStorage (client-side, sem migration). Rotas: `/trilha` (overview) + `/trilha/[moduleId]` (viewer). Free pra todos os planos.
- **Pendência cosmética restante:** "Simulador E se?" existe (dentro do Analytics) — landing OK.
- **Sem rate limiting:** OK com poucos alunos; revisar antes de abrir IA pra geral.

## 📋 Próximos passos

### Produto
- [x] ~~**Alertas de trade no app**~~ ✅ feito em 18/06 (toast in-app em tempo real via polling do sino)
- [x] ~~**Rate limiting na IA**~~ ✅ confirmado em 22/09 — `src/lib/rate-limit.ts` (Upstash + fallback), cobre login/registro/Vega chat/análise de trade/check-in IA/resumo semanal
- [x] ~~**UploadThing**~~ ✅ token na Vercel, screenshots funcionando
- [x] ~~**Domínio traderos.app**~~ — obsoleto, domínio oficial já é `meutrade.app`
- [x] ~~**Vídeo de divulgação HeyGen**~~ ✅ resolvido (Marcelo confirmou em 22/09)
- [x] ~~**CNPJ / subconta Asaas separada por app**~~ ✅ resolvido (Marcelo confirmou em 22/09)
- [x] ~~**Reativar sync automático NT8**~~ — item fechado como **decisão consciente de continuar pausado**, não como reativação: Marcelo confirmou em 22/09 que ainda não é o momento (vai demorar um pouco pra voltar com essa feature). Código continua `NT8_ENABLED = false` em `src/lib/integration-flags.ts`, de propósito — nada a fazer aqui até ele decidir religar. Ver item "NinjaTrader (AddOn de sync)" abaixo pro que ainda falta quando chegar a hora.
- [ ] **Rodar Semgrep de novo** — última varredura foi 16/09; o código de 17-18/09 (tours, import CSV, fixes de conta teste) ainda não foi escaneado
- [ ] **Stripe** — planos Trader R$97 / Pro R$197, webhook para atualizar user.plan (~8-12h) — hoje o pagamento é via Asaas, então prioridade baixa
- [ ] **NinjaTrader (AddOn de sync)** — código reescrito, aguardando teste de compilação no NT8 → commit + deploy após validar (independente do import de CSV manual, que já funciona)
- [ ] **Email de boas-vindas** — Resend após cadastro (RESEND_API_KEY já está na Vercel — confirmar se o envio está de fato disparando)
- [ ] **Pix no checkout Asaas** — cadastrar chave Pix no painel
- [ ] **Nome fantasia + logo no Asaas** — hoje mostra nome/CPF (PF)

## ⚠️ Decisões técnicas importantes
- **Prisma 7:** URL no `prisma.config.ts`, NÃO no `schema.prisma`
- **Prisma 7:** Requer `@prisma/adapter-pg` como driver adapter
- **shadcn "Nova" preset:** usa Base UI (não Radix) — `asChild` não existe, usar `render` prop
- **Next.js 16:** `proxy.ts` em vez de `middleware.ts`
- **NextAuth v5:** `auth()` server-side, JWT cacheado — mudança de plano exige re-login
- **Guardian:** 100% client-side com `useMemo` — sem chamadas ao banco, zero latência

## 🔧 Variáveis .env (status)
> ✅ Confirmado via `vercel env ls production` em 08/06/2026 — TODAS as 9 vars estão na produção.
```
DATABASE_URL=✅ configurado (Neon PostgreSQL SA-East-1)
AUTH_SECRET=✅ configurado
AUTH_URL=✅ configurado
AUTH_GOOGLE_ID=✅ configurado
AUTH_GOOGLE_SECRET=✅ configurado
UPLOADTHING_TOKEN=✅ na Vercel (add 8d atrás) — screenshots OK
RESEND_API_KEY=✅ na Vercel — email boas-vindas OK
RESEND_FROM_EMAIL=✅ na Vercel
ANTHROPIC_API_KEY=✅ na Vercel — IA Vega / Ask Claude OK
VAPID_PUBLIC_KEY=✅ na Vercel (18/06) — Web Push
VAPID_PRIVATE_KEY=✅ na Vercel (18/06) — Web Push (SECRETO, nunca no git)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=✅ na Vercel (18/06) — Web Push (exposta no client, OK)
# Gateway de pagamento=🔴 NÃO implementado (botão /planos sem onClick). OK por ora: soft-launch é grátis.
```

## 📚 Dependências principais
- next: 16.2.6
- next-auth: 5.0.0-beta.31
- prisma: 7.8.0
- @prisma/adapter-pg: ^7
- bcryptjs: ^3.0.3
- resend: ^6.12.3 (instalado, não ativado)
- tailwindcss: v4
- zod: ^4.4.3

## ✅ 12/10/2026 — AI Partner: sourceLabel S4–S6 + guarda do sal (camada 2c) — só local, sem push
Rótulos na Evidence = palavra do vocabulário v1 ou token `lbl_…`; matriz sal × rótulo × mapa × bundle testada; Lab mostra palavra/token; E5b ganha pista de sal não propagado (só texto). Falsos-negativos restantes do guarda documentados em `data-contract.md` §14.15. Pendências: política de sal por usuário, `rowTrades` no E5b, E6.5 (só desenho).

## ✅ 12/10/2026 — AI Partner: política de sal por usuário (P0–P6) — só local, sem push
Sal gerenciado por usuário (≥ 256 bits, chaveiro versionado em memória), `saltId`/`saltCheck` declarados no bundle, geração fail-closed, E5b lê via provider (saltCheck nunca é portão), 8 cenários no Lab. Achados no caminho: `ensure()` curando em silêncio, `combine()` escondendo bloqueio, heurística "todas as contas divergem" escolhendo severidade. Pendências: armazenamento real do chaveiro (persistência), E6.5 (só desenho), E5c, vocabulário v2.

## 📝 12/10/2026 — E6.5-0: plano e expectativas do contrato do agente (SÓ DESENHO) — só local, sem push
`docs/ai-partner/agent-contract-plano.md` + `scripts/expectations/agent-contract.expected.json`. D1–D10 e ajustes A1 (dois textos de NOT_VERIFIED), A2 (`evidence.explain` pela mesma projeção de rótulo), A3 (N = 2 regerações) aprovados. Nada implementado; sem Vega IA. Próximo: E6.5-1 (documento do contrato).

## 📝 12/10/2026 — E6.5-1: `agent-capabilities.md` (contrato do agente, SÓ DOCUMENTO) — só local, sem push
N = 2 regerações, K = 20, envelope com verify+source+combined, catálogo de 8 capacidades, slots por unidade, 21 frases específicas (códigos conferidos contra o código-fonte), matriz de vereditos, rotação de sal/refEpoch, T0/T1/T2. Propostas em aberto: O-E/O-F/O-G. Próximo: E6.5-2 (só tipos e schemas).

## 📝 12/10/2026 — E6.5-2: tipos e schemas do contrato do agente (SÓ TIPOS) — só local, sem push
`src/lib/agent/{contract,views,phrases}.ts` + `test-agent-contract-types.mts` (11). PromptViews strict (T0 rejeitado em qualquer nível), handle de servidor × visão sem hash, 8 capacidades sem verify/verifySource, catálogo de frases. Corrigido no E6.5-1: exibição com as casas do motor; parada explícita por orçamento. Próximo: E6.5-3 (testes estáticos SG1–SG5 e extensão do guarda do veredito); E6.6 só com aprovação.

## ✅ 12/10/2026 — E6.5 concluído (contrato do agente: só desenho + tipos + testes estáticos) — só local, sem push
`agent-capabilities.md`, `src/lib/agent/{contract,views,phrases}.ts`, `test-agent-contract-{types,static}.mts`. PRÉ-REQUISITO OBRIGATÓRIO do E6.6: `combineVerdict` único + handle rejeitando `combined` inconsistente (o schema aceita hoje; KG1 trava isso). Sem Vega IA, sem implementação de capacidade. Pendências: E6.6 (aprovação própria), armazenamento do arquivo e do chaveiro, E5c, vocabulário v2.
