# MeuTrade — CHECKPOINT 2026-10-14 (E6.6-7a, 7a', 2c + review adversarial do Gemini)

> **Substitui o `-10-13` como ponto de retomada** (o 10-13 continua valendo para o histórico E6.6-0 → E6.6-7). Português brasileiro, direto. Repo **público** `Marcelo210598/TraderOS` (`origin`) **nunca recebeu push**: sem dados reais, sem deploy, banco, Prisma de produção ou UI. Backup **privado** `TraderOS-backup`, branch `backup/ai-partner-2026-10-13`.

## ESTADO EXATO
- **No backup (privado):** até `ce767a3` (E6.6-7a').
- **SÓ LOCAL:** `ba63147` (expectativa 2c), `e7ba31f` (E6.6-2c) e os commits de documentação deste checkpoint. **Push só com OK do Marcelo** (ele delegou aprovação às outras IAs em 14/10, mas o push segue sendo pedido a ele).
- `origin/main` público: `eb8a28a` (intocado). ~100 commits locais à frente.
- **Suíte:** `npm run test:domain` **984 ✓** (exit 0) · `tsc --noEmit` 0 · ESLint limpo. Baseline de 771 linhas (commit `69805ba`) idêntico; as 979 linhas anteriores ao 2c idênticas (+5; 1 título mudou de propósito: T1, 627 → 722).
- **Aprovado pelo Marcelo (14/10):** E6.6-7, `52a1303` (salt.ts), E6.6-7a e E6.6-7a' ("se o Gemini aprovou, eu aprovo"). **E6.6-2c: commitado, AGUARDANDO review do Gemini (rodada 3) e OK.**

## O QUE FOI FEITO EM 14/10
| Passo | Commits | Entrega |
|---|---|---|
| Ambiente | — | `node_modules` tinha sumido (limpeza do iCloud): `npm ci --cache <tmp>` + `npx prisma generate`. `~/.npm` tem arquivos de root (EACCES) |
| Review do Gemini | `PROMPT-REVIEW-GEMINI.md` | prompt de papel (só leitura, formato de achado ACHADO/SUSPEITA). Rodadas 1 e 2 feitas, rodada 3 pronta |
| E6.6-7a | `16c16ba`, `5ea5a82` | X13 (`rBasis` muda `evidenceRef`), X14 (`DIVERGENT` por valor ponta a ponta), X15 (literais à mão da fixture CY). 6 mutações |
| E6.6-7a' | `783cd90`, `ce767a3` | X14b (`DIVERGENT` por quantidade), X15b (coverage/sampleFlag), **X15c** (cobertura parcial; nasceu de mutação N4 que escapou), G15b (`minSample` em groups) |
| E6.6-2c | `ba63147`, `e7ba31f` | `ADVICE` 83 → 178 termos: imperativos de mercado barrados (verbos unívocos soltos; homônimos só em locução). H2–H6, 11 mutações, 10 falsos negativos pinados |

**Review do Gemini — placar (eu confirmo cada achado na prática antes de agir):** rodada 1: 6 de 7 confirmados (o #1 ALTO = ordens de mercado passavam no validador). Rodada 2: 3 de 4 confirmados e **1 REFUTADO** (disse que `minSample` em `metrics.groups` não era detectado; a mutação é pega por `sampleFlag`). Regra: o "aprovado" de uma IA não substitui reprodução.

**Erros meus de hoje (registrados nos §18–§20 do plano):** esqueci o `rBasis` no E6.6-7; asserção tautológica no 1º X14; mutação N4 escapou por fixture toda completa; expectativa do 2c commitada com 1 falso negativo que não era; contagem errada no 1º H6.

## DECISÕES DO DIA (Marcelo, direto ou delegadas)
- **#2 `undefined` em args = `ARGS_INVALID`** (toda chamada envia `{}`); corrigir o texto do X9 em `e66_7` e registrar no `_meta.history`.
- **#6 `buckets[].unit` vira slot citável**, com regra formal (palavra fixa em `format.ts`, folha em `slot-path.ts`, teste do slot). **Palavra de `LEG`: "pernas" (sugestão minha, ainda sem confirmação explícita) e `TRADE`: "trades".**
- **#1 (feito no 2c):** verbos unívocos soltos; `venda/entre/corte/saia` (e `compra/vende/feche/realize/segure/fique/opere`) só em locução composta; `entre comprado/vendido` fora de propósito; falsos negativos declarados.
- Ordem aprovada: 7a → 7a' → 2c → **7b** → E6.6-8…

## 🚧 PASSOS RESTANTES (cada um só com aprovação; um commit local por passo; parar a cada um)
1. **Rodada 3 do Gemini sobre o 2c** (mensagem pronta em `docs/ai-partner/GEMINI-RODADA-3-E6.6-2c.md`; colar no Antigravity, trazer o relatório; eu reproduzo cada achado). Foco: burla (ordens que ainda passam e NÃO estão nos 10 FN) e falso positivo (análise legítima barrada pelos 95 termos).
2. **Push** de `ba63147`, `e7ba31f` e dos docs: `git push backup HEAD:refs/heads/backup/ai-partner-2026-10-13` (fast-forward, **nunca** `origin`, nunca force). Conferir antes que `backup` é PRIVATE.
3. **E6.6-7b** (expectativa primeiro): #2 (texto do X9 + history + teste de `undefined` ⇒ `ARGS_INVALID` já existe) e #6 (`buckets[].unit`: `ENUM_WORDS`/format.ts, folha `buckets[].unit` no `LEAVES["exit.breakdown@1"]` e em `exit.analysis@1` via `...buckets`, teste de render do slot, mutação).
4. **Decisão do Marcelo — falso positivo PREEXISTENTE `analise`:** o termo (imperativo) rejeita o **substantivo** "análise" ("Esta análise mostra…", "A análise está nos slots" ⇒ `OPERATIONAL_ADVICE`). Reproduzido, **não tratado**. Pedir aval antes de mexer; checar se há OUTROS termos antigos do `ADVICE` com o mesmo problema (substantivo × imperativo).
5. **E6.6-8** `metrics.compare@1` (deltas já têm `reason` nas views) → **E6.6-9** `rank.groups@1` → **E6.6-10** `exit.analysis@1` → **E6.6-11** `evidence.explain@1` (implementar **PD-3**: código `DATA_NOT_PROVIDED` no catálogo + testes de distinção do vocabulário de verificação) → **E6.6-12** `evidence.refresh@1` + fechamento (guardas globais, docs, CHANGELOG) + **teste ponta a ponta de `VERIFIED_PARTIAL`** (hoje 0 ocorrências nas 3 capacidades; precisa de fixture parcial real).
6. **Pendências abertas herdadas:** **E6.6-5-A** (resolvedor de alias de ENTRADA: filtros/where por conta/estratégia/setup/timeframe seguem `ARGS_INVALID`); **D6-1** (groupBy strategyVersion/setup/timeframe excluídos); **limitação de desempenho** (até 50×10 `explainMetric` no `metrics.groups`); `L_SALT_*` só testado com reports montados à mão; Q11 1ª metade só alcançável com bundles persistidos (E7); 8 falsos negativos léxicos do e66_2b + 3 falsos positivos aceitos + os 10 FN do 2c.
7. **Fora de escopo (continua):** LLM/Vega IA, persistência, UI, banco de produção, Prisma/migration, `origin` público.

## 🧹 HIGIENE DO AMBIENTE (não é do projeto)
- `sudo chown -R 501:20 ~/.npm` (cache global do npm com arquivos de root; hoje contornado com `--cache`). Rodar com `! sudo chown -R 501:20 ~/.npm`.
- `node_modules` está dentro do iCloud (`Desktop/`): inflou a nuvem de novo. Opção: renomear para `node_modules.nosync` + symlink.
- Duplicatas do iCloud soltas (não nossas): `src/components/auth/register-form 2.tsx`, `docs/mesas-proprietarias/fontes/fff-urls 2.txt`. A primeira pode quebrar o `tsc` se for incluída.
- `npm audit`: 34 vulnerabilidades (1 crítica, 25 altas) no `npm ci` de hoje; **não investigado** (fora do escopo desta fase).

## Leitura rápida para retomar
1. Este arquivo e `docs/ai-partner/agent-answer-plano.md` **§18, §19, §20** (resultados de hoje).
2. `scripts/expectations/agent-answer.expected.json`: blocos `e66_7a`, `e66_7a2`, `e66_2c` e o `_meta.history` (mais recente no topo).
3. `src/lib/agent/` (puro; só `lexicon.ts` mudou hoje) e `src/lib/agent-capabilities/` (único que importa `evidence/` e `metrics/`).
4. **Método (repetir sempre):** expectativa escrita e commitada ANTES do código → ver o teste FALHAR → mutações (escape vira teste ou equivalente declarada) → baseline comparado linha a linha → parar a cada passo → relatório com erros próprios admitidos.
5. **Fluxo do review:** colar `PROMPT-REVIEW-GEMINI.md` (papel) uma vez e, a cada passo, a mensagem "PASSO A REVISAR" no Antigravity; ele só lê; eu confirmo/refuto cada achado com mutação temporária (backup por cópia se houver mudança não commitada; `git checkout` só em arquivo limpo).
