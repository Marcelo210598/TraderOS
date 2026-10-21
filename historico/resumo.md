# TraderOS — Resumo Geral

## O que é
**MeuTrade** — SaaS para qualquer trader brasileiro (futuros, forex, ações — qualquer mesa proprietária, não só Apex). Ajuda o trader a manter diário de operações, entender seu padrão emocional/comportamental e conversar com IA especializada.
> ⚠️ 17/09/2026: produto desvinculado de propósito da marca "Apex" — não é mais ferramenta de prop firm específica, é app do trader. Guardian (calculadora/trailing drawdown Apex) foi **removido** (ver historico/2026-09-17.md).

## Módulos
- **Dashboard** ✅ — métricas da semana, gráfico de performance, trades recentes, streaks
- **Journal** ✅ — diário de trades, filtros, paginação, PnL automático, screenshots, badge de conta (TEST/PA), importação CSV
- **Check-in Emocional** ✅ — PRE correlaciona estado emocional × histórico de performance (60 dias); POST detecta tags comportamentais (revenge/FOMO/etc) nos trades do dia e cita o impacto em P&L
- **Biblioteca de Setups** ✅ — catálogo de estratégias com stats (plano Starter+), toggle Cards/Tabela com profit factor, avg P&L, ordenação
- **Progress** ✅ — XP, level up, 12 conquistas, 4 tipos de streak
- **Calendário** ✅ — grid mensal com P&L por dia (verde = lucrativo, vermelho = negativo)
- **Analytics** ✅ — equity curve, drawdown, MFE/MAE agregado, gráfico de execução por trade (`journal/[id]`), Simulador "E se?" (cenário MFE + sem N piores losses)
- **Drawdown** ✅ (24/09, persistência 27/09/2026) — `/drawdown`: calculadora de drawdown genérica (Intraday/End of Day/End of Position/Static), abas Real (trades da conta) e Simular, margem com zonas, corredor de segurança, placar, "quanto cabe arriscar", consistência, tutorial e cadeados Free/Starter/Pro. Regras persistidas no banco (`TradingAccount.drawdownRules`) via `GET/PUT /api/accounts/[id]/drawdown-rules` (Zod + `enforcePlan` no servidor), migrou automático quem tinha regra no localStorage. Detalhe: `historico/2026-09-24.md` + `historico/2026-09-27.md`
- **Mesas Proprietárias** ✅ (28/09/2026, NO AR) — seção pública `/mesas` (hub com cards + educativo) e `/mesas/[mesa]`: **Lucid** (4 planos), **Funded Futures Family** (5 planos) e **Apex** (2 trilhas). Comparativo lado a lado com tamanhos em dourado, quiz "Qual plano combina comigo?", regras gerais, vantagens/atenção, contato do Piero (parceiro; Marcelo não recebe nada). Dados em `src/lib/mesas/` (um arquivo por mesa, modelo genérico), levantamentos em `docs/mesas-proprietarias/`. Cron semanal (`/api/cron/mesas-check`) vigia Lucid e FFF e avisa os admins por push; Apex é conferida à mão (Cloudflare) com lembrete mensal. Detalhe: `historico/2026-09-28.md`
- **AI Partner (fundação, não é feature de usuário ainda)** 🚧 (01–10/10/2026, SÓ LOCAL, sem push) — pipeline de ingestão NT8 → ciclos de posição → métricas determinísticas → **Evidence E1–E4** (identidade SHA-256, `explainTrade`, `explainMetric`, privacidade por `accountRef`). Código em `src/lib/{domain,ingest,metrics,evidence,infra}/`, testes `npm run test:domain`. **E5.0–E5.3 `verifyEvidence` (V0–V4 + ordem da sequência) e Evidence Lab (`/dev/evidence-lab`) prontos** — 5.274 bundles reais sem falso positivo. **E5b `verifyEvidenceSource` (proveniência contra o CSV original) pronto.** Próximo: revisão do E5b e decisão sobre E6/G6 e a integração do agente. **Contexto reproduzível das importações e aba Origem (E5b) no Lab prontos; plano E6/G6 aguardando aprovação** (`docs/ai-partner/E6-G6-plano.md`). **12/10: plano E6/G6 APROVADO e E6.0 (`exitReason` por trade + `strategyRef`) E6.1 (`exitBreakdown` por perna) E6.2 (ranking/contribuição/comparação) E6.3 (Evidence dos derivados + V6), E5b para derivados e E6.4 (aba Derivados no Evidence Lab) implementados, commits locais; E6.5 só após a revisão do Marcelo.** **12/10 (tarde/noite): sourceLabel S0–S6 e política de sal por usuário P0–P6 concluídos (locais); E5b×rowTrades corrigido.** **E6.5 (contrato do agente) concluído como desenho+tipos+testes estáticos.** Retomar por `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-12f.md` (E6.6 só com aprovação e começando por `combineVerdict`). Detalhe: `historico/2026-10-12.md` **Atualização 14/10/2026:** camada do agente (E6.6-0 → 7, 7a, 7a', 2c) com `test:domain` 984 ✓; review adversarial do Gemini a cada passo; backup privado em `ce767a3`; retomar por `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-14.md`.
- **AI Partner — E6.6 (capacidades do agente) ✅ FECHADO em 15/10/2026 (SÓ LOCAL + backup privado `882fbae`; origin intocado)** — 8 capacidades puras em `src/lib/agent-capabilities/` (`metrics.query/groups/compare`, `exit.breakdown/analysis`, `rank.groups`, `evidence.explain`, `evidence.refresh`) + validador/render/ledger em `src/lib/agent/`; o modelo só cita slots, números vêm do motor. `test:domain` 1083 ✓. Não ligado a UI/banco/LLM; próximo grande passo = E7 (persistência). Retomar por `docs/ai-partner/MEUTRADE-CHECKPOINT-2026-10-15.md`.
- **AI Partner — 16/10/2026 (SÓ LOCAL + backup privado `b51284f`; origin intocado)** — `strategy` (A2), estresse 50×10, RF9, D6-1 e **E7-0/E7-1** (`RawFileStorage` em `src/lib/infra/raw-file-storage*.ts`); `test:domain` 1122 ✓. Próximo: E7-2 `SaltProvider` cifrado. Detalhe: `historico/2026-10-16.md`.
- **AI Partner — 18/10/2026 (SÓ LOCAL + backup privado; origin intocado)** — **E7-2** `SaltProvider` persistente cifrado (`src/lib/infra/cipher.ts` AES-256-GCM + `salt-store.ts`; `SALT_MASTER_KEY`) e **E7-3** estado da conversa persistente (`src/lib/infra/conversation-store.ts`: log de deltas atômicos, CAS por link exclusivo, replay por época, alias só cresce, limites 500/256 KiB/2 MiB); `test:domain` 1122 → **1166 ✓**. Próximo: E7-4 `bundleOf`. Retomar por `historico/2026-10-18.md` e `docs/ai-partner/agent-answer-plano.md` §36–§37.
- **AI Partner — 19/10/2026 (backup `0f0070d`; origin intocado)** — **E7-4** pin de dataset por spec + `ImportSourceStore` + `registerImport`/`makeContext` (`src/lib/infra/dataset*.ts`, `import-source-store.ts`); `test:domain` 1166 → **1195 ✓**. Próximo: E7-5 (regenerador + `onBundle` + cache). Retomar por `historico/2026-10-19.md`.
- **AI Partner — 19/10/2026 (E7-5, backup `b7a5409`; origin intocado)** — gancho `onBundle`, `infra/bundle-cache.ts` (LRU 64 MiB + single-flight) e `infra/regenerate.ts` (`regenerateBundle`/`prepareBundle`/`regeneratedFor`); `test:domain` 1195 → **1232 ✓**. Próximo: orquestrador do turno. Retomar por `historico/2026-10-19.md` e `agent-answer-plano.md` §39.
- **AI Partner — 19/10/2026 (E7-6, backup `884160b`; origin intocado)** — `infra/turn-session.ts`: executor determinístico do turno SEM LLM (`openTurn/call/validate/commit`, um commit atômico, explain fora do ledger); `test:domain` 1232 → **1258 ✓**. Roteiro E7-0…E7-6 concluído; pendências listadas em `historico/2026-10-19.md`. Retomar por `agent-answer-plano.md` §40.
- **AI Partner — 20/10/2026 (E7-11…E7-14, backup; origin intocado)** — R2 SigV4 próprio (E7-11), cota por plano Free/Starter/Pro (E7-12), adaptadores e migração Prisma aplicada em produção sem mexer no legado (E7-13), rotas `/api/ai-partner/imports` testadas offline e ao vivo no R2+Neon (E7-14); `test:domain` **1357 ✓**. Próximo: Portão D (ligar em produção) e E7-15 (loop do chat).
- **Vega IA** ✅ — chat contextual com dados reais dos últimos 90 dias do trader (plano PRO); sabe win rate, setups, sessões, P&L
- **Notificações** ✅ — sino no header com badge; resumo semanal gerado pelo Claude toda sábado 9h BRT (plano TRADER/PRO)
- **Contas/Labels** ✅ — separação AUTOMÁTICA por tipo (Teste/Avaliação/Aprovada) pelo nome da corretora + por conta real (brokerName); filtro por conta no journal; badge de tipo na Carteira; bulk reassign em /journal/contas
- **Painel de Uso (Admin)** ✅ — /admin/uso: users totais, online/ativos (lastSeenAt), planos, engajamento
- **Retargeting Meta** ✅ — Pixel MeuTrade (1705413327409397) + eventos (PageView/ViewContent/InitiateCheckout/Lead/Purchase) + Conversions API. Falta: criar conta de anúncios no business MeuTrade + públicos (esperar pixel encher ~3-5 dias)
- **Planos** ✅ — Free / Starter R$19,90 / Pro R$97 (ou R$1.000/ano), checkout Asaas em produção
- **Cadastro/Login** ✅ — email+senha ou Google OAuth
- **Configurações** ✅ — perfil (atualizar nome), troca de senha, info do plano, integrações
- **Trilha de Aprendizado** ✅ — 5 módulos completos (módulo 5 generalizado pra "Mesas Proprietárias" em 17/09, sem citar Apex)
- **Termos de Uso / Política de Privacidade** ✅ — `/termos` e `/privacidade`, LGPD-compliant (17/09, reforçado 27/09/2026: exclusão de conta self-service, consentimento explícito no cadastro, banner de cookies)
- **Sync automático (NT8/MT5)** 🔴 PAUSADO DE PROPÓSITO em 17/09/2026 — flag reversível em `src/lib/integration-flags.ts`, reativa aos poucos com testes quando decidir
- **Pagamentos** ✅ — Asaas (não Stripe), checkout recorrente em produção

## Stack
- Next.js 16.3.6 + TypeScript + Tailwind CSS v4 + shadcn/ui (Base UI)
- Prisma 7 + @prisma/adapter-pg + Neon PostgreSQL (SA-East-1)
- NextAuth v5 beta.32 + @auth/prisma-adapter 2.11.3 (Google OAuth + Credentials JWT) — atualizado 27/09/2026, fechou 2 CVEs críticos do Auth.js
- bcryptjs para hash de senhas
- Resend v6 (email de boas-vindas no cadastro)
- UploadThing v7.7.4 (screenshots do Journal — app ID: de0183n798)
- Anthropic SDK v0.96 (Vega — modelo claude-haiku-4-5-20251001)
- Vercel Cron (sábados 12h UTC → resumo semanal)

## Deploy
- **Repositório:** github.com/Marcelo210598/TraderOS
- **URL produção:** https://meutrade.app
- **Projeto Vercel:** trader-os (prj_iZJFGM2AFCg8rgAG3IiVRbqQ5mUl)
- **Org Vercel:** team_eV0i1XLGL1ae6c4VBGyXSdoo
- **Deploy:** SEMPRE `vercel deploy --prod` na raiz do projeto após push (nunca confiar no webhook do GitHub) — só confirma quando o CLI retorna `Aliased: https://meutrade.app`

## Segurança & LGPD (27/09/2026)
- `npm audit`: 0 críticos (era 4 — `next` e `next-auth`/`@auth/core` atualizados). ~14 HIGH restantes
  são dependências transitivas sem exploração real no app (baixa prioridade).
- Semgrep rodou de novo (baseline + TS/React/Node/Next + Trail of Bits): 0 findings.
- LGPD: exclusão de conta self-service (Configurações → Zona de perigo), consentimento explícito
  no cadastro (`User.termsAcceptedAt`), banner de cookies (Meta Pixel/GA só com aceite).
- Detalhe completo da auditoria + correções: `historico/2026-09-27.md`.

## Conta de teste
```
Email: difoggijuniormarcelo@gmail.com
Plano: PRO (atualizado manualmente no DB para testar tudo)
```

## Design
Dark mode obrigatório. Paleta "Terminal":
- Fundo: oklch(0.09 0.022 244) ≈ #080C14
- Accent Teal: oklch(0.72 0.134 179) ≈ #00C2A8
- Profit: oklch(0.70 0.16 162) ≈ #10B981
- Loss: oklch(0.65 0.24 15) ≈ #F43F5E

## Como rodar local
```bash
cd "Desktop/Projetos AI/TraderOS"
npm run dev
# http://localhost:3000
```

## Status geral: Fase 1 e Fase 2 100% concluídas ✅

## Breaking changes desta stack (IMPORTANTE)
1. **Prisma 7:** `prisma generate` DEVE rodar antes de `next build` — no Vercel já está configurado
2. **Prisma 7:** `url` do banco vai em `prisma.config.ts`, NÃO no `schema.prisma` (causa P1012)
3. **Prisma 7 + sandbox:** `prisma generate` não roda no sandbox Claude Code → usar `(prisma as any).modelName` para modelos novos até o Vercel rebuild
4. **Migrações manuais:** SQL manual + endpoint temporário `GET /api/admin/apply-*?secret=...` → deletar após confirmação
5. **NextAuth v5:** `auth()` server-side. JWT cacheado — mudar plano exige re-login
6. **Env vars Vercel:** SEMPRE usar `printf` para criar (nunca `echo`) — `echo` adiciona `\n` silenciosamente
7. **Google OAuth + credentials:** obrigatório `allowDangerousEmailAccountLinking: true`

## Variáveis de ambiente no Vercel (production)
```
DATABASE_URL                ✅
AUTH_SECRET                 ✅
AUTH_URL                    ✅
AUTH_GOOGLE_ID              ✅
AUTH_GOOGLE_SECRET          ✅
UPLOADTHING_TOKEN           ✅
RESEND_API_KEY              ✅
ANTHROPIC_API_KEY           ✅
CRON_SECRET                 ✅ (Vercel gera automaticamente com os crons)
RESEND_FROM_EMAIL           ❓ verificar
```

## Módulos atualizados (24/05 — segunda sessão)
- **MFE/MAE** ✅ — campos no trade form, API, detalhe, % de captura
- **Gamificação auditada** ✅ — `src/lib/gamification.ts`, achievements com key como ID
- **PWA** ✅ — manifest.ts, service worker, PwaRegister
- **Onboarding** ✅ — modal 5 passos, localStorage, dashboard
- **Multi-conta Guardian** ✅ — view=multi com grid compacto de todas as PAs
- **Analytics avançados** ✅ — drawdown, streaks, MFE/MAE agregado, banner streak atual
- **CSV import multi-plataforma** ✅ — NinjaTrader, Tradovate, auto-detect

## Próximos passos (para 10/10 sem pagamento)
1. **Tags customizáveis** nos trades — ~3-4h
2. **Drawdown chart visual** no Analytics — ~1-2h
3. **Export PDF** do journal — ~2-3h
4. **Domínio traderos.app** — 15min DNS
5. **Stripe/MercadoPago** — quando decidir monetizar

## Nota competitiva atual: **9.5/10**
Vega IA agora é o maior diferencial vs Trademetria (80k users, R$49,90/mês Pro). TraderOS tem 4 features exclusivas que eles não têm: check-in emocional correlacionado, simulador "E se", gráfico de execução e desafios por regra operacional.

## Estética Tier 1 — 31/05/2026 (7 itens entregues)
- StatsCards com accent bar colorida + gradient overlay
- Sidebar active indicator (barra vertical teal)
- Radial gradient no background
- Ícone Google real no login
- Drop-shadow teal no logo
- XP bar mais espessa com glow neon
- Plan badge com borda colorida por plano

## Estética Tier 2 — 31/05/2026 ✅ ENTREGUE
- Count-up animation nos StatsCards
- Bottom nav mobile (5 ítens)
- Empty states com SVG

## Analytics em produção — 01/06/2026 ✅
- `@vercel/analytics` + `@vercel/speed-insights` funcionando
- Fix: `package-lock.json` tinha campo `version` vazio em dep opcional (`@unrs/resolver-binding-openharmony-arm64`)

## Histórico de sessões
| Data | O que foi feito |
|------|----------------|
| 2026-05-18 | Setup inicial, schema Prisma, auth, páginas base |
| 2026-05-19 | Guardian, Setups, Progress, conquistas, streaks |
| 2026-05-23 | UploadThing, Resend, Vega IA, Calendário, Trilha, deploy Vercel; fix login/logout/OAuth |
| 2026-05-24 (manhã) | Logo + favicon, rename → Vega, /configuracoes, fix logout, fix Vega modelo |
| 2026-05-24 (tarde) | accountLabel (TEST/PA), CSV import, bulk label, Guardian real, Setup performance table, Vega contextual (90 dias), notificações in-app + cron sábado |
| 2026-05-24 (noite) | MFE/MAE, gamificação auditada, PWA, onboarding, multi-conta Guardian, analytics avançados, CSV multi-plataforma (NinjaTrader+Tradovate) |
| 2026-05-28 | Tags customizáveis, integração NinjaTrader (API Keys + endpoint sync), NinjaScript v6 |
| 2026-05-30 | Vega no check-in (TRADER/PRO), fallback 18 respostas, drawdown chart SVG, export PDF journal, fix deploy |
| 2026-05-31 | Estética Tier 1 completa: 7 melhorias visuais (StatsCards, sidebar, background, login, XP bar, badge) |
| 2026-06-01 | Fix deploy: Vercel Analytics ativo — lockfile corrompido (version vazia em dep opcional) |
| 2026-06-02 | Pesquisa NinjaTrader: diagnóstico dos 2 bugs (Indicator instável + IsEntry/IsExit falho). Reescrita completa como **AddOn** com round-trip, config por arquivo, log, FileSystemWatcher. Tutorial atualizado. Aguarda teste de compilação. |
| 2026-06-04 | **Vega IA enriquecida** (análise de trade → Sonnet + histórico setup; checkin → 7 dias + streaks + tags comportamentais; chat → MFE/MAE/DOW/tags/notas). **4 features novas**: Gráfico de Execução (pts relativos), Simulador "E se" (MFE/piores losses), Desafios com regras operacionais (tabela Neon), Compartilhar trade (link público `/share/[token]`). |
| 2026-09-16/17 | **Sessão grande de hardening + rebrand + QA pré-divulgação.** Webhook Asaas forjável corrigido (token rotacionado + validação cruzada com a API); Semgrep completo (CSP enforce, 34 lint errors zerados); checkout com domínio errado (paliativo); **Guardian/Apex removidos do produto inteiro** (código, UI, trilha, marketing); Termos/Privacidade criados; sync NT8/MT5 pausado via flag; landing/planos corrigidos pra não prometer sync pausado; **2 bugs reais achados testando ao vivo** antes de gravar vídeo de divulgação (eficiência do "E se?" dando -241%, upload de screenshot vazando input nativo em mobile por falta de `sr-only` no CSS do Tailwind v4) — ambos corrigidos e deployados. Detalhe completo em `historico/2026-09-17.md`. |
| 2026-09-17 (noite)/18 | **Tours guiados + import CSV + fixes de conta teste** (não documentado na hora, registrado retroativamente em 22/09). Tours guiados contextuais em todas as páginas principais; import de CSV do NinjaTrader em PT com detecção multi-conta; seleção múltipla + delete em lote no Journal; correções de conta teste vazando em Analytics/Calendário; fix de filtro de data; fix de import de CSV não atualizando XP/streaks; OG image dinâmica no compartilhamento de trade; lembrete de streak de check-in em risco. 20 commits, todos deployados. |
| 2026-09-22 | **Auditoria de pendências (sem código).** Confirmado: rate limiting na IA já implementado corretamente (Upstash + fallback, cobre todos os endpoints certos); Semgrep já rodou em 16/09 (recomendado rodar de novo pro código pós-16/09). Marcelo confirmou resolvidos: vídeo HeyGen, CNPJ/subconta Asaas, domínio (obsoleto, é meutrade.app). Sync NT8: decisão consciente de continuar pausado, não é pendência. `progress.md` e este resumo atualizados. |
| 2026-09-23 | **Sessão grande — 5 entregas, todas em produção.** (1) Fix import CSV PT-BR zerando P&L negativo (`parseBRNumber` não removia espaço em `"-$ 117,00"` → `NaN` → fallback `0`); commit `30e44cd`. (2) Fix equity curve da Carteira "por tipo" — linha de tipo com atividade concentrada num dia ficava espremida numa fatia mínima de pixels; todas as séries passaram a compartilhar o mesmo intervalo de tempo; commit `7bb29b8`. (3) Toggle "Todos/Avaliação/Teste" novo no Analytics, filtrando a página inteira; junto do item 2. (4) Mesmo toggle no Calendário + `bucketOf`/`BUCKET_META` centralizados em `src/lib/accounts.ts`; commit `aaee6d5`. (5) Redesign do Gráfico de Execução do trade (vela de verdade em vez de bloco largo "zoado"), remoção do link TradingView (parâmetro `timestamp` que o site deles ignora — integração real fica pro futuro), e fix de bug de sobreposição de texto achado no teste ao vivo (MAE = saída, caso mais comum); commits `0771a42` + `d94d09f`. Achado à parte: login no localhost quebrado por `redirect_uri_mismatch` do Google OAuth (não é bug do app, dados intactos no Neon) — por isso o fluxo do dia virou testar direto em produção. Detalhe completo em `historico/2026-09-23.md`. |
| 2026-09-23 (noite) | **Analytics v3.** Gráficos interativos (hover/toque, eixo Y), modais explicando MFE/MAE/Drawdown/PF/Expectância, 5 diagnósticos novos (entrada, lucro na mesa, horário, comportamento, dias/distribuição), simulador "E se" com 8 cenários + sliders, responsivo testado 320-768px. Cálculos em `src/lib/analytics-insights.ts`. Commits `500d9b3` + `3e18bac`. Detalhe em `historico/2026-09-23.md`. |
| 2026-09-28 | **Seção Mesas Proprietárias completa e no ar** (3 mesas: Lucid, FFF, Apex). Hub em destaque, comparativos, quizzes, educativo, regras gerais, menu lateral, cron semanal Lucid+FFF (139 itens) e lembrete mensal pra Apex (manual, Cloudflare). Modelo de dados generalizado (Lucid idêntica à produção). Commits `e8271be`, `a2a167e`, `06ac5c7` + Apex. Detalhe em `historico/2026-09-28.md`. |

## 29/09/2026 — Mesas prop: 5 no ar
Lucid, FFF, Apex, Tradeify e Bulenox em `/mesas`. Cron vigia Lucid, FFF e Bulenox (JSON); Apex, Tradeify e preços da Bulenox = conferência manual com lembrete mensal. Detalhe: `historico/2026-09-29.md`.
- **AI Partner — 19/10/2026 (E7-7, backup `acddf47`; origin intocado)** — `infra/user-purge.ts`: exclusão em cascata LGPD (`purgeUserData`, `deleteImportFile`, `deleteConversation`), `BundleCache.purgeUser` com geração; `test:domain` 1258 → **1275 ✓**. Retomar por `historico/2026-10-19.md` e `agent-answer-plano.md` §41.
- **AI Partner — 20/10/2026 (E7-13 Portão C, origin intocado)** — testes ao vivo do Prisma em branch real do Neon (LV1–LV6); pooler + direta, cascata FK, CAS, bytes/datas exatos, LGPD purge e latências medidas; 1343 ✓ offline mantidos; PENDÊNCIA: rotação de senha neondb_owner e token R2 antes da produção. Próximo: Portão D (produção só com OK explícito + snapshot).
- **AI Partner — 21/10/2026 (E7-15b B+C, origin intocado)** — cota mensal do chat (`ai_chat_usage`, reserva atômica + lease 90 s, fail-closed), 15/100/300 por mês UTC; offline 29 testes, ao vivo 33 no Neon (V1–V4), mutações ok; produção sem a tabela. Próximo: Portão D (migração em produção, só com OK).
- **AI Partner — 21/10/2026 (E7-15b Portão D)** — `ai_chat_usage` CRIADA EM PRODUÇÃO (backup `backup-pre-chat-usage`, ensaio ok, legado intacto, app 200/401). Próximo: E7-15c (Groq + rota do chat).
- **AI Partner — 21/10/2026 (E7-15c)** — cliente Groq + rota do chat (código no backup, nada em produção); Free = 3 turnos/mês + pool global 300/mês; ferramentas -86% de peso; conta Groq no nível base (8K tokens/min) ⇒ só demo; liberar exige plano Developer. Próximo: E7-15d (teste ao vivo) e E7-15e (tela).
- **AI Partner — 21/10/2026 (medição E7-16 + emenda do período; E7-17 aberto)** — laço novo medido ao vivo: 6/6, ~1.504 tokens/turno; período dos dados vai no prompt; bug pré-existente do motor em `metrics.compare` PERIOD de 4 métricas de sequência/rebaixamento (E7-17, não investigado). Próximo: tela E7-15e.
- **AI Partner — 21/10/2026 (E7-15d + E7-16)** — medição ao vivo mostrou que o modelo escolhe bem a ferramenta mas falha ao escrever a resposta; E7-16: o servidor monta a resposta (`composer.ts`), modelo só devolve `tool_calls` (1 chamada + 1 reparo), 6 ferramentas, prompt 2.211 caracteres; 1470 ✓ (commit `5a1982a`, backup; origin `eb8a28a`; nada em produção). Falta medir ao vivo o laço novo e a tela E7-15e.
- **AI Partner — 21/10/2026 (E7-15a, origin intocado)** — laço do chat com modelo falso (`chat-turn.ts`, prompt, 8 ferramentas, tetos de tokens/chamadas, `stopForBudget`); 1381 ✓, 26/26 mutações; Groq `qwen/qwen3.8-27b`, limites/mês 15/100/300 (provisórios), sem Pro grátis; token R2 antigo excluído. Próximo: E7-15b cota (tabela própria).
- **AI Partner — 20/10/2026 (E7-14, origin intocado)** — fiação da ingestão: rotas de upload (`/api/ai-partner/imports`) com tratadores puros, teto 4 MiB, cota por plano, sal criado na 1ª importação, CSRF, rate limit fail-open e montador de deps de produção; 1357 ✓; nada deployado. Próximo: Portão D (ligar em produção: SALT_MASTER_KEY com cópia em cofre e token R2 novo na Vercel).
- **AI Partner — 20/10/2026 (E7-14 NO AR, origin intocado)** — rota de upload em produção (meutrade.app, 401 sem login); chave mestra no Chaveiro + Vercel; .vercelignore agora exclui .env*; pendente: teste logado, revogar token R2 antigo, 2ª cópia da chave.
- **AI Partner — 20/10/2026 (E7-13 Portão D, origin intocado)** — migração aditiva aplicada em PRODUÇÃO (4 tabelas `ai_*`, vazias; legado intacto); ensaio em cópia e branch de backup feitos antes. Próximo: E7-14 fiação (rota de upload + cota + R2 + adaptadores Prisma).
- **AI Partner — 20/10/2026 (E7-13 Portão B, origin intocado)** — adaptadores Prisma (sal/importação/conversa) + schema/migração aditivos + trava do banco de teste; 1343 ✓; NENHUM banco tocado. Próximo: portão C (branch descartável do Neon, URL só no .env.local); produção só com OK separado.
- **AI Partner — 20/10/2026 (E7-12, origin intocado)** — cota de arquivos por plano (Free 2/5 MiB, Starter 20/50 MiB, Pro 100/250 MiB), 1337 ✓; falta a fiação à rota/UI e decidir se o Free usa o AI Partner.
- **AI Partner — 20/10/2026 (E7-11, origin intocado)** — cliente R2 (SigV4 próprio, CAS via If-None-Match, validado ao vivo); 1323 ✓; PENDENTE: revogar/recriar o token (chaves vazaram em print); próximo E7-12 (cota por plano) e fiação.
- **AI Partner — 20/10/2026 (E7-10, origin intocado)** — RawFileStorage sobre ObjectStore com gzip (sem nuvem ainda); 1314 ✓; próximo E7-11 (R2, exige conta) e E7-12 (cota por plano).
- **AI Partner — 20/10/2026 (E7-9, backup `f58008a`; origin intocado)** — mensagens da conversa no mesmo delta (user literal ≤4.000; assistant = answer + rendered + citations derivadas; 200 msgs/64 KiB); 1306 ✓.
- **AI Partner — 20/10/2026 (E7-8, backup `81c9fbe`; origin intocado)** — citabilidade do `evidence.explain`: ref derivado por página (`explainPageRef` em `evidence/hash.ts`), entry no ledger do turno, D-X7 em `evidence-refresh.ts`; `test:domain` 1275 → **1290 ✓**. Retomar por `historico/2026-10-20.md` e `agent-answer-plano.md` §42.
