# TraderOS — Resumo Geral

## O que é
SaaS para traders brasileiros de futuros americanos via prop firms (Apex Trader Funding / NinjaTrader).
Ajuda o trader a manter diário de operações, acompanhar progresso com gamificação e calcular regras da avaliação Apex.

## Módulos
- **Journal** ✅ — diário de trades com filtros, paginação, cálculo de PnL automático
- **Check-in Emocional** ✅ — avaliação diária de estado mental (5 métricas, score de risco)
- **Biblioteca de Setups** ✅ — catálogo de estratégias com stats (plano Trader+)
- **Progress** ✅ — XP, level up, 12 conquistas, 4 tipos de streak
- **Guardian** ✅ — calculadora Apex: trailing drawdown, consistency rule, scaling plan
- **Planos** ✅ — página de pricing (visual pronta, sem gateway ainda)
- **Cadastro** ✅ — email+senha ou Google OAuth
- **Ask Claude** 🔴 — análise IA de trades (plano Pro, pendente API key)
- **Calendário Econômico** 🔴 — pendente
- **Trilha de Aprendizado** 🔴 — pendente

## Stack
- Next.js 16.2.6 + TypeScript + Tailwind CSS v4 + shadcn/ui (Base UI, preset Nova)
- Prisma 7 + @prisma/adapter-pg + Neon PostgreSQL (SA-East-1)
- NextAuth v5 beta.31 (Google OAuth + Credentials)
- bcryptjs para hash de senhas
- Resend (email — não ativado ainda) + UploadThing (screenshots — não ativado ainda)

## Design
Dark mode obrigatório. Paleta "Terminal":
- Fundo: oklch(0.09 0.022 244) ≈ #080C14
- Accent Teal: oklch(0.72 0.134 179) ≈ #00C2A8
- Accent Indigo: oklch(0.67 0.18 265) ≈ #818CF8
- Profit: oklch(0.70 0.16 162) ≈ #10B981
- Loss: oklch(0.65 0.24 15) ≈ #F43F5E

## Como rodar
```bash
cd "Desktop/Projetos AI/TraderOS"
npm run dev
# http://localhost:3000
# Login de teste: difoggijuniormarcelo@gmail.com / trader123 (plano TRADER)
```

## Status geral: ~75% do MVP

## Breaking changes desta stack (IMPORTANTE)
1. **Prisma 7:** URL no `prisma.config.ts`, NÃO no `schema.prisma`. Requer `@prisma/adapter-pg`
2. **shadcn Base UI:** sem `asChild`, usar `render` prop ou `<a>` com classes diretas
3. **Next.js 16:** `middleware.ts` → `proxy.ts` (senão dá warning de deprecação)
4. **NextAuth v5:** `auth()` server-side (sem `getServerSession`). JWT cacheado — mudar plano exige re-login do usuário

## Próximas sessões (prioridade)
1. Gateway de pagamento (Stripe/Abacatepay) + webhook para atualizar `user.plan`
2. UploadThing — configurar `UPLOADTHING_TOKEN` para screenshots no Journal
3. Resend — email de boas-vindas no cadastro
4. Deploy Vercel + variáveis de ambiente em produção
5. Ask Claude (plano Pro) — `ANTHROPIC_API_KEY` + implementar feature

## Variáveis .env pendentes
```
UPLOADTHING_TOKEN=...
RESEND_API_KEY=...
ANTHROPIC_API_KEY=...
# Stripe ou Abacatepay keys (a definir)
```
