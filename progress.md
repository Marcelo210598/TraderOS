# TraderOS — Progresso

## Última atualização: 18/05/2026

## 📌 Visão Geral
- **Objetivo:** Plataforma SaaS para traders brasileiros de futuros americanos (prop firms / Apex)
- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui (Base UI) + Prisma 7 + Neon PostgreSQL + NextAuth v5
- **Status:** MVP em desenvolvimento — estrutura base completa

## ✅ Concluído (Sessão 1 — 18/05/2026)
- [x] Projeto Next.js 16 inicializado com TypeScript e Tailwind v4
- [x] shadcn/ui configurado (preset Nova, Base UI)
- [x] Prisma 7 configurado com adapter `@prisma/adapter-pg` (breaking change v7)
- [x] Schema Prisma completo: User, Account, Session, Trade, TradeTag, TradeScreenshot, Setup, CheckIn, TradePlan, Achievement, UserAchievement, Streak, Subscription
- [x] NextAuth v5 beta — Google OAuth + Credentials
- [x] Identidade visual TraderOS "Terminal" implementada:
  - Fundo: oklch(0.09) — azul-preto profundo
  - Accent Teal: #00C2A8 (diferente de outros projetos)
  - Accent Indigo: #818CF8
  - Profit: #10B981 | Loss: #F43F5E
- [x] Layout autenticado: Sidebar fixa + Header com user menu
- [x] Dashboard com métricas (mock), performance chart, streaks, trades recentes
- [x] Página de login completa (Google + email/senha)
- [x] Páginas placeholder: Journal, Progress, Guardian
- [x] Build de produção limpo (zero erros, zero warnings)
- [x] proxy.ts (anteriormente middleware.ts — breaking change Next.js 16)

## 🚧 Em progresso
- Nenhum no momento

## 📋 Próximos passos — Sessão 2
### Módulo Journal (prioridade alta)
- [ ] Listagem de trades com filtros (data, instrumento, resultado, setup)
- [ ] Formulário de criação de trade (todos os campos do schema)
- [ ] Upload de screenshots via UploadThing
- [ ] Detalhe do trade com análise IA (plano Pro)

### Módulo Progress
- [ ] Sistema de XP e level up
- [ ] Conquistas (Achievements) com critérios
- [ ] Streaks visuais interativos
- [ ] Histórico de métricas longitudinal

### Módulo Guardian
- [ ] Calculadora trailing drawdown Apex
- [ ] Consistency Rule checker
- [ ] Scaling plan calculator
- [ ] Alertas de risco

### Infra
- [ ] Configurar banco Neon PostgreSQL e rodar migrations
- [ ] Configurar variáveis de ambiente em produção (Vercel)
- [ ] Página de cadastro (/cadastro)
- [ ] Email de boas-vindas via Resend
- [ ] Página de planos (/planos)

## ⚠️ Decisões técnicas importantes
- **Prisma 7** usa `prisma.config.ts` para URL do DB (não mais no schema.prisma)
- **Prisma 7** requer driver adapter — usamos `@prisma/adapter-pg`
- **shadcn "Nova" preset** usa Base UI (não Radix) — `asChild` substituído por `render` prop
- **Next.js 16** renomeou `middleware.ts` → `proxy.ts`
- **NextAuth v5** usa `auth()` em vez de `getServerSession()`

## 🔧 Configurações necessárias (.env)
- DATABASE_URL (Neon PostgreSQL)
- AUTH_SECRET (openssl rand -base64 32)
- AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET
- RESEND_API_KEY
- UPLOADTHING_TOKEN
- ANTHROPIC_API_KEY

## 📚 Dependências principais
- next: 16.2.6
- next-auth: 5.0.0-beta.31
- prisma: 7.8.0
- @prisma/adapter-pg: ^7
- @anthropic-ai/sdk: latest
- tailwindcss: v4
- shadcn (Base UI / Nova preset)
