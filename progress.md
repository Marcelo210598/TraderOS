# TraderOS — Progresso

## Última atualização: 02/06/2026 — Reescrita integração NinjaTrader (Indicator → AddOn)

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

## 🚧 Em progresso
- **Integração NinjaTrader (AddOn):** código reescrito em `integration-section.tsx`, aguardando teste de compilação no NT8 real

### Estética Tier 2 — 31/05/2026 (3/3 entregues)
- [x] **Count-up animation** — StatsCard vira client component, hook useCountUp (easeOut 700ms), props numericValue/formatValue
- [x] **Bottom navigation bar mobile** — 5 itens fixos: Dashboard, Journal, FAB +Trade (teal), Analytics, Guardian. Oculto em lg+
- [x] **Empty states com SVG** — SVG monocromático de chart vazio (Analytics) e livro aberto (Journal/TradeList)

## 📋 Próximos passos

### Produto
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
```
DATABASE_URL=✅ configurado (Neon PostgreSQL SA-East-1)
AUTH_SECRET=✅ configurado
AUTH_GOOGLE_ID=✅ configurado
AUTH_GOOGLE_SECRET=✅ configurado
UPLOADTHING_TOKEN=🔴 pendente
RESEND_API_KEY=🔴 pendente
ANTHROPIC_API_KEY=🔴 pendente
# Gateway de pagamento=🔴 pendente (definir Stripe ou Abacatepay)
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
