# TraderOS — Progresso

## Última atualização: 28/06/2026 — 💳 PAGAMENTO ASAAS IMPLEMENTADO (checkout 3 planos + webhook + paywall). Falta só DEPLOY + configurar webhook no painel Asaas. Ver historico/2026-06-28.md
## (25/06: Painel Admin de acesso + push de novo cadastro + planos/custos definidos; 20/06: Carteira multi-corretora; 18/06: Web Push)
## 🚧 PRÓXIMO: deploy Vercel + setar env vars Asaas + configurar webhook (URL+token) no painel sandbox + teste de pagamento real ponta a ponta

## 📌 Visão Geral
- **Objetivo:** Plataforma SaaS para traders brasileiros de futuros americanos (prop firms / Apex)
- **Stack:** Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Prisma 7 + Neon PostgreSQL + NextAuth v5
- **Status:** ~90% do MVP — núcleo funcional completo + estética Tier 1/2 + Analytics em produção
- **URL Produção:** trader-os-ashy.vercel.app ✅

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
- [ ] **Rate limiting na IA** — antes de abrir o app pro público geral (hoje OK: poucos alunos)
- [ ] **UploadThing** — screenshots no Journal (UPLOADTHING_TOKEN pendente)
- [ ] **Domínio traderos.app** (~15min, mais pra frente)
- [ ] **Stripe** — planos Trader R$97 / Pro R$197, webhook para atualizar user.plan (~8-12h)
- [ ] **NinjaTrader** — código reescrito como AddOn ✅, aguardando teste de compilação no NT8 → commit + deploy após validar
- [ ] **UploadThing** — screenshots no Journal (UPLOADTHING_TOKEN pendente)
- [ ] **Email de boas-vindas** — Resend após cadastro (RESEND_API_KEY pendente)

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
