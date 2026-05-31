# Snapshot — 24/05/2026 (segunda sessão)

## 🎯 O que foi feito hoje

### Fase 3 — Nice to Have (todas concluídas nesta sessão)

- **MFE/MAE tracking** — campos opcionais `mfe` e `mae` adicionados ao schema (migration SQL via Neon HTTP API), form de trade, API GET/POST/PUT, detalhe do trade com % de captura do potencial, página de edição
- **Auditoria de gamificação** — `src/lib/gamification.ts` criado com `giveXp`, `updateJournalStreak`, `updateProfitableDaysStreak`, `updateCheckInStreak`, `checkAndAwardAchievements`. APIs de trades, setups e check-in atualizadas. Achievements usam `key` como ID no Prisma para corrigir mismatch com AchievementsGrid
- **PWA instalável** — `src/app/manifest.ts` (Next.js route), `public/sw.js` (network-first, cache fallback), `src/components/pwa-register.tsx`, meta tags apple, layout.tsx atualizado
- **Onboarding modal** — `src/components/onboarding/onboarding-modal.tsx` com 5 passos (Welcome, Journal, Guardian, Vega, Pronto!), localStorage `traderos_onboarding_v1`, fade 180ms, dots clicáveis, dismiss via overlay ou "Pular introdução". Integrado no dashboard com `isNewUser = recentTradesRaw.length === 0`
- **Multi-conta Guardian** — toggle "Conta única" / "Todas as contas" no `/guardian`. Nova view `?view=multi` mostra grid 2 colunas com cards compactos (status badge, barra progresso, margem drawdown, dias, consistência). Clicar navega para detalhe. Lógica `simulate` extraída para `src/lib/guardian.ts`
- **Analytics avançados** — adicionados ao `/analytics`: Max Drawdown, Drawdown Atual, Max Win Streak, Max Loss Streak, banner de streak atual (🔥/🧊), seção MFE/MAE com Avg MFE, Avg MAE, Taxa de Captura (alerta se < 50%)
- **CSV Import turbinado** — `importar-client.tsx` reescrito com seletor de plataforma (TraderOS / NinjaTrader / Tradovate), auto-detecção por headers, parser NinjaTrader (MAE/MFE, inferência de sessão por horário, strip de expiry do contrato), parser Tradovate, suporte a separador tab e vírgula. API de import aceita mfe/mae agora

## 📝 Decisões técnicas importantes

- **Neon HTTP API** continua sendo o método de migração — `prisma db push` falha silenciosamente no ambiente local com Node 22
- **`(prisma as any)`** padrão mantido para modelos com campos novos até o Vercel rebuild regenerar os tipos
- **`src/lib/guardian.ts`** — módulo compartilhado para evitar duplicação entre ChallengeStatus e MultiAccountGrid
- **Gamification via `key` como ID de Achievement** — `prisma.achievement.upsert({ where: { id: ach.key } })` garante que `earnedIds.has(ach.key)` funciona corretamente no AchievementsGrid

## ⚠️ Problemas encontrados e soluções

- **TypeScript Decimal vs number** em `editar/page.tsx`: `trade.mfe` é `Decimal | null` pós-Prisma-generate no Vercel, mas `Partial<Trade>` espera `number | null`. Fix: `(trade as any).mfe != null ? Number((trade as any).mfe) : null`
- **Build falhou** no primeiro deploy de MFE/MAE por esse erro de tipos. Segundo commit resolveu
- **MFE/MAE colunas não existiam** no banco — site ficou offline por alguns minutos. Fix via Neon HTTP API (`ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe DECIMAL(10,2)`)

## 🔧 Arquivos criados ou modificados

### Novos
- `src/lib/guardian.ts` — simulate, ACCOUNTS, AccountConfig, DayData
- `src/lib/gamification.ts` — giveXp, updateJournalStreak, updateProfitableDaysStreak, updateCheckInStreak, checkAndAwardAchievements
- `src/components/guardian/multi-account-grid.tsx`
- `src/components/onboarding/onboarding-modal.tsx`
- `src/components/pwa-register.tsx`
- `src/app/manifest.ts`
- `public/sw.js`
- `prisma/migrations/20260524000003_add_mfe_mae/migration.sql`

### Modificados
- `prisma/schema.prisma` — mfe/mae no Trade
- `src/lib/types.ts` — mfe/mae na interface Trade
- `src/components/journal/trade-form.tsx` — campos MFE/MAE
- `src/app/api/trades/route.ts` — gamificação + mfe/mae
- `src/app/api/trades/[id]/route.ts` — mfe/mae
- `src/app/api/trades/import/route.ts` — mfe/mae
- `src/app/api/setups/route.ts` — gamificação
- `src/app/api/checkin/route.ts` — gamificação
- `src/app/(app)/journal/[id]/page.tsx` — MFE/MAE cards
- `src/app/(app)/journal/[id]/editar/page.tsx` — conversão Decimal→number
- `src/app/(app)/guardian/page.tsx` — multi-conta
- `src/app/(app)/analytics/page.tsx` — drawdown/streaks/MFE-MAE
- `src/app/(app)/dashboard/page.tsx` — OnboardingModal
- `src/app/layout.tsx` — manifest, PwaRegister, viewport
- `src/components/journal/importar-client.tsx` — multi-plataforma

## 📊 Estado atual do projeto

**Nota competitiva: 8.7/10**

Fase 1 ✅ 100% | Fase 2 ✅ 100% | Fase 3 ✅ (exceto pagamentos e Trade Replay)

App pronto para ter clientes pagantes — falta só gateway de pagamento.

## 🚧 Próxima sessão — pendências para chegar em 10/10

1. **Tags customizáveis** nos trades (análise qualitativa) — ~3-4h
2. **Drawdown chart visual** no Analytics (complementar o número atual) — ~1-2h
3. **Export PDF** do journal filtrado — ~2-3h
4. **Domínio traderos.app** — 15min de DNS + config no Vercel
5. **Stripe/MercadoPago** — gateway + webhook `user.plan` (quando decidir monetizar)

## 💡 Observações importantes

- URL produção: https://trader-os-ashy.vercel.app
- Deploy: `source ~/.nvm/nvm.sh && nvm use 22 && npx vercel deploy --prod` (dentro da pasta do projeto)
- Migrações de schema: Neon HTTP API com `Neon-Connection-String` header
- Conta de teste (PRO): difoggijuniormarcelo@gmail.com
