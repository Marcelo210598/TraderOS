# TraderOS — Resumo Geral

## O que é
SaaS para traders brasileiros de futuros americanos via prop firms (Apex Trader Funding / NinjaTrader).
Ajuda o trader a manter diário de operações, acompanhar progresso com gamificação, calcular regras da avaliação Apex e conversar com IA especializada.

## Módulos
- **Dashboard** ✅ — métricas da semana, gráfico de performance, trades recentes, streaks
- **Journal** ✅ — diário de trades, filtros, paginação, PnL automático, screenshots, badge de conta (TEST/PA), importação CSV
- **Check-in Emocional** ✅ — avaliação diária de estado mental (5 métricas, score de risco)
- **Biblioteca de Setups** ✅ — catálogo de estratégias com stats (plano Trader+), toggle Cards/Tabela com profit factor, avg P&L, ordenação
- **Progress** ✅ — XP, level up, 12 conquistas, 4 tipos de streak
- **Guardian** ✅ — trailing drawdown EOD com dados reais do Journal, consistency rule, seletor de conta PA25K–PA250K
- **Calendário** ✅ — grid mensal com P&L por dia (verde = lucrativo, vermelho = negativo)
- **Vega IA** ✅ — chat contextual com dados reais dos últimos 90 dias do trader (plano PRO); sabe win rate, setups, sessões, P&L
- **Notificações** ✅ — sino no header com badge; resumo semanal gerado pelo Claude toda sábado 9h BRT (plano TRADER/PRO)
- **Contas/Labels** ✅ — marcar trades como TEST, PA25K–PA250K; bulk reassign em /journal/contas
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
- Anthropic SDK v0.96 (Vega — modelo claude-haiku-4-5-20251001)
- Vercel Cron (sábados 12h UTC → resumo semanal)

## Deploy
- **Repositório:** github.com/Marcelo210598/TraderOS
- **URL produção:** https://trader-os-ashy.vercel.app
- **Projeto Vercel:** trader-os (prj_iZJFGM2AFCg8rgAG3IiVRbqQ5mUl)
- **Org Vercel:** team_eV0i1XLGL1ae6c4VBGyXSdoo

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

## Nota competitiva atual: **9.2/10**
Pronto para ter clientes pagantes. App bate concorrentes ($30-50/mês USD) em PT-BR, gamificação, IA e especificidade Apex. Estética Tier 1 entregue — visual polido e profissional.

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
