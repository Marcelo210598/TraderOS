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
- **Vega IA** ✅ — chat contextual com dados reais dos últimos 90 dias do trader (plano PRO); sabe win rate, setups, sessões, P&L
- **Notificações** ✅ — sino no header com badge; resumo semanal gerado pelo Claude toda sábado 9h BRT (plano TRADER/PRO)
- **Contas/Labels** ✅ — separação AUTOMÁTICA por tipo (Teste/Avaliação/Aprovada) pelo nome da corretora + por conta real (brokerName); filtro por conta no journal; badge de tipo na Carteira; bulk reassign em /journal/contas
- **Painel de Uso (Admin)** ✅ — /admin/uso: users totais, online/ativos (lastSeenAt), planos, engajamento
- **Retargeting Meta** ✅ — Pixel MeuTrade (1705413327409397) + eventos (PageView/ViewContent/InitiateCheckout/Lead/Purchase) + Conversions API. Falta: criar conta de anúncios no business MeuTrade + públicos (esperar pixel encher ~3-5 dias)
- **Planos** ✅ — Free / Starter R$19,90 / Pro R$97 (ou R$1.000/ano), checkout Asaas em produção
- **Cadastro/Login** ✅ — email+senha ou Google OAuth
- **Configurações** ✅ — perfil (atualizar nome), troca de senha, info do plano, integrações
- **Trilha de Aprendizado** ✅ — 5 módulos completos (módulo 5 generalizado pra "Mesas Proprietárias" em 17/09, sem citar Apex)
- **Termos de Uso / Política de Privacidade** ✅ — `/termos` e `/privacidade`, LGPD-compliant (17/09/2026)
- **Sync automático (NT8/MT5)** 🔴 PAUSADO DE PROPÓSITO em 17/09/2026 — flag reversível em `src/lib/integration-flags.ts`, reativa aos poucos com testes quando decidir
- **Pagamentos** ✅ — Asaas (não Stripe), checkout recorrente em produção

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
- **URL produção:** https://meutrade.app
- **Projeto Vercel:** trader-os (prj_iZJFGM2AFCg8rgAG3IiVRbqQ5mUl)
- **Org Vercel:** team_eV0i1XLGL1ae6c4VBGyXSdoo
- **Deploy:** SEMPRE `vercel deploy --prod` na raiz do projeto após push (nunca confiar no webhook do GitHub) — só confirma quando o CLI retorna `Aliased: https://meutrade.app`

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
| 2026-09-23 | **Fix: import CSV NinjaTrader PT-BR zerava P&L negativo** (bug achado na noite de 22/09). Causa: `parseBRNumber` não removia o espaço entre `-` e o número em `"-$ 117,00"` → `parseFloat` retornava `NaN` → fallback `0`. Corrigido, validado com script isolado (4 casos de teste + reprocessamento do CSV real, sem tocar em conta nenhuma) e depois confirmado ao vivo em produção pelo Marcelo: os 2 fills do stop saem `-$117.00`/`-$58.50` certinho. Deploy: commit `30e44cd`, `vercel deploy --prod` → `Aliased: https://meutrade.app`. Pendente: `parseNinjaTrader` (EN) e `parseTradovate` não foram tocados (formato decimal diferente, sem CSV real de exemplo pra confirmar se têm o mesmo bug). |
