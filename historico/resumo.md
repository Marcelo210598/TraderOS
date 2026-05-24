# TraderOS — Resumo Geral

## O que é
SaaS para traders brasileiros de futuros americanos via prop firms (Apex Trader Funding / NinjaTrader).
Ajuda o trader a manter diário de operações, acompanhar progresso com gamificação, calcular regras da avaliação Apex e conversar com IA especializada.

## Módulos
- **Dashboard** ✅ — métricas da semana, gráfico de performance, trades recentes, streaks
- **Journal** ✅ — diário de trades com filtros, paginação, PnL automático, screenshots (UploadThing), análise IA por trade
- **Check-in Emocional** ✅ — avaliação diária de estado mental (5 métricas, score de risco)
- **Biblioteca de Setups** ✅ — catálogo de estratégias com stats (plano Trader+)
- **Progress** ✅ — XP, level up, 12 conquistas, 4 tipos de streak
- **Guardian** ✅ — calculadora Apex: trailing drawdown, consistency rule, scaling plan
- **Calendário** ✅ — grid mensal com P&L por dia (verde = lucrativo, vermelho = negativo)
- **Vega IA** ✅ — chat com IA especializada em futuros (plano PRO) — renomeado de Ask Claude
- **Planos** ✅ — página de pricing (visual pronta, sem gateway ainda)
- **Cadastro/Login** ✅ — email+senha ou Google OAuth
- **Configurações** ✅ — perfil (atualizar nome), troca de senha, info do plano
- **Trilha de Aprendizado** 🟡 — placeholder "em breve" com 5 módulos planejados
- **Stripe/Pagamentos** ❌ — pendente (próxima grande feature)

## Stack
- Next.js 16.2.6 + TypeScript + Tailwind CSS v4 + shadcn/ui (Base UI)
- Prisma 7 + @prisma/adapter-pg + Neon PostgreSQL (SA-East-1)
- NextAuth v5 beta.31 (Google OAuth + Credentials JWT)
- bcryptjs para hash de senhas
- Resend v6 (email de boas-vindas no cadastro)
- UploadThing v7.7.4 (screenshots do Journal — app ID: de0183n798)
- Anthropic SDK v0.96 (Ask Claude — modelo claude-haiku-4-5-20251001)

## Deploy
- **Repositório:** github.com/Marcelo210598/TraderOS
- **URL produção:** https://trader-os-ashy.vercel.app
- **Projeto Vercel:** trader-os (prj_iZJFGM2AFCg8rgAG3IiVRbqQ5mUl)
- **Org Vercel:** team_eV0i1XLGL1ae6c4VBGyXSdoo

## Conta de teste
```
Email: difoggijuniormarcelo@gmail.com
Senha: Trader@2026
Plano: PRO (atualizado manualmente no DB para testar tudo)
```

## Design
Dark mode obrigatório. Paleta "Terminal":
- Fundo: oklch(0.09 0.022 244) ≈ #080C14
- Accent Teal: oklch(0.72 0.134 179) ≈ #00C2A8
- Accent Indigo: oklch(0.67 0.18 265) ≈ #818CF8
- Profit: oklch(0.70 0.16 162) ≈ #10B981
- Loss: oklch(0.65 0.24 15) ≈ #F43F5E

## Como rodar local
```bash
cd "Desktop/Projetos AI/TraderOS"
npm run dev
# http://localhost:3000
```

## Status geral: ~90% do MVP em produção

## Breaking changes desta stack (IMPORTANTE)
1. **Prisma 7:** `prisma generate` DEVE rodar antes de `next build` (sem isso, todos os tipos ficam `any[]` no Vercel)
2. **Prisma 7:** configuração via `prisma.config.ts`, NÃO no `schema.prisma`. Requer `@prisma/adapter-pg`
3. **shadcn Base UI:** sem `asChild`, usar `render` prop ou `<a>` com classes diretas
4. **Next.js 16:** `middleware.ts` → renomeado internamente; verificar docs
5. **NextAuth v5:** `auth()` server-side (sem `getServerSession`). JWT cacheado — mudar plano exige re-login
6. **Auth dupla query bug:** `authorize()` e `jwt()` NÃO devem cada um fazer `findUnique` — consolidar numa query só
7. **Env vars Vercel:** SEMPRE usar `printf` para criar (nunca `echo`) — `echo` adiciona `\n` que quebra tudo silenciosamente
8. **Google OAuth + credentials:** obrigatório `allowDangerousEmailAccountLinking: true` se mesmo email pode vir de ambos os flows

## Variáveis de ambiente no Vercel (production)
```
DATABASE_URL                ✅
AUTH_SECRET                 ✅
AUTH_URL                    ✅
AUTH_GOOGLE_ID              ✅
AUTH_GOOGLE_SECRET          ✅
UPLOADTHING_TOKEN           ✅
RESEND_API_KEY              ✅
ANTHROPIC_API_KEY           ✅ (adicionada em 23/05)
RESEND_FROM_EMAIL           ❓ verificar
```

## Próximos passos (prioridade)
1. **Confirmar** Vega + logout funcionando em prod (deploy de 2026-05-24 em andamento)
2. **Stripe** — gateway de pagamento + webhook para atualizar `user.plan`
3. **Trilha** — implementar conteúdo real (aulas, quizzes)
4. **Domínio próprio** — traderos.app (mencionado no template de email)

## Histórico de sessões
| Data | O que foi feito |
|------|----------------|
| 2026-05-18 | Setup inicial, schema Prisma, auth, páginas base |
| 2026-05-19 | Guardian, Setups, Progress, conquistas, streaks |
| 2026-05-23 | UploadThing, Resend, Ask Claude, Calendário, Trilha, deploy Vercel; fix login timeout, fix logout, fix Google OAuth loop, fix env vars com \n |
| 2026-05-24 | Logo + favicon oficiais, rename IA → Vega, página /configuracoes, fix logout (signOut client-side), fix Vega modelo depreciado (→ claude-haiku-4-5-20251001), fix UI silent failure Vega |
