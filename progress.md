# TraderOS — Progresso

## ✅ 24/09/2026 (manhã) — Seletor com "Aprovada" sempre visível + deploy + diagnóstico do localhost
- **Calendário e Analytics:** seletor agora é `Todos / Avaliação / Aprovada / Teste` **sempre** (antes só aparecia o tipo com trade no mês →
  conta aprovada sumia). Tipo sem trade fica esmaecido; escolher um vazio mostra o mês/aviso vazio sem quebrar. `BUCKETS` em `src/lib/accounts.ts`.
- **Calendário:** "Dia negativo (avg)" mostrava `-$0` sem dia negativo → agora `—`.
- **Deploy:** commit `fa03545` (motor de drawdown + seletor) → `vercel deploy --prod` → aliased `meutrade.app`.
- **Localhost:** dev server sobe normal (login 200). Erro era só o **Google OAuth** (`redirect_uri_mismatch`). O login **e-mail/senha funciona no local**
  (usuário Marcelo tem senha). Correção definitiva = adicionar `http://localhost:3000/api/auth/callback/google` (+ origem `http://localhost:3000`)
  no OAuth Client do Google Cloud. ⚠️ O `.env` local aponta pro Neon de PRODUÇÃO (mesmo banco) — cuidado com escrita nos testes.
- **Achado no calendário (não é bug, é regra de dia):** grade agrupa por dia-calendário BR (22/09 +$236, 23/09 +$198, 24/09 +$239 = +$673); a Lucid
  agrupa por *trading day* (virada 18h): 22/09 +$411,50, 23/09 +$22, 24/09 +$239. O trade da noite de 22/09 (−$175,50, ~21h30) cai no dia 23 da Lucid.
  Total bate. Vai virar parâmetro "hora de virada do dia" na seção Drawdown.

## 🚧 24/09/2026 — Seção "Drawdown" (calculadora de drawdown de mesa) — motor pronto, sem tela ainda
Ideia do Marcelo (aula do Théo mostrou um simulador de 4 tipos de drawdown). Decisões:
- **Nome:** "Drawdown" (rota `/drawdown`, subtítulo "Calculadora de drawdown") — "Mesas" confundia com comprar mesa.
- **Genérico, sem amarrar em mesa:** regras = parâmetros (`DrawdownRules`); mesas viram **presets como dado**
  (híbrido: poucos presets verificados + "Personalizada"). Regras guardadas em **coluna JSON validada com Zod** na `TradingAccount`.
  Só regra de dinheiro (drawdown, trava, meta, limite diário, consistência, virada do dia, dias mínimos).
- **4 tipos = 1 regra, muda QUANDO o pico atualiza:** Intraday (a cada tick, com aberto) · End of Position (fecha posição) ·
  End of Day (encerra dia) · Static (nunca). Meta é LUCRO (nível = saldo inicial + meta).
- **2 modos, mesmo motor:** Simular (botões +$100/−$500, cenários prontos, Próximo passo/Reproduzir) e Real (lê os trades da conta;
  MFE como pico intraday = estimado, pior caso). Campo de calibração "limite atual segundo a mesa".
- **Free × Starter × Pro (cadeado, campo visível):** Free = saldo/meta/drawdown + Static e Intraday + Simular manual + 1 conta Real básica.
  Starter = Free + End of Day + limite diário. Pro = tudo (trava, consistência, End of Position, virada/dias mínimos, cenários, replay, presets,
  calibração, todas as contas). Clique/toque no cadeado → aviso "liberado no Pro" + Ver planos. **Bloqueio também no servidor** (`plan-guard.ts`).
- **Feito:** `src/lib/drawdown-engine.ts` (motor puro) + `scripts/test-drawdown-engine.mts` (10 testes ok: cenário "lucro aberto devolvido",
  referência dos cards da aula, trava, limite diário, consistência com os números reais da LucidFlex). tsc limpo. `tsconfig` exclui `scripts/*.mts`.
- **Achado:** o motor bateu com os cards do simulador da aula (equity 51.600 → limites 49.600/48.000, margens 2.000/3.600, barras 59%/72%).
- **Próximo:** tela "Simular" no localhost (checkpoint) → migration da coluna de regras → modo Real → cadeados/planos. Login local segue quebrado (`redirect_uri_mismatch`) → usar página de preview temporária.
- Rodar testes: `node scripts/test-drawdown-engine.mts`

## ✅ 23/09/2026 (noite, v3.1) — Analytics testado e ajustado pra mobile
Testado em 320/390/768px com página de preview temporária (removida) + dados sintéticos: sem overflow
horizontal, tooltip por toque OK, modal vira bottom sheet OK. Ajustes: lista "onde escapou dinheiro" quebra
em 2 linhas, tabela de comportamento com rótulos curtos, contagem por horário visível no cel, eixo X com
labels alternados no cel, "?" com área de toque maior + safe-area no modal, recorte do diagrama MFE/MAE,
plural "dia/dias", espaço faltando no veredito da entrada.

## ✅ 23/09/2026 (noite, v3) — Analytics: gráficos interativos + explicações + diagnósticos + "E se" completo
Pedido do Marcelo: números nos gráficos (hover/toque), modal explicando MFE/MAE/Drawdown, seção Analytics
mais densa (análise de verdade pra melhorar entrada) e "E se" menos vago.
- **Equity Curve + Drawdown:** eixo Y com números + crosshair/tooltip no hover e no toque (`scrub-plot.tsx`,
  compartilhado). Pontos/textos em HTML posicionado em % (SVG `preserveAspectRatio="none"`).
- **Modal "o que é isso?"** (`explain-modal.tsx`): MFE, MAE (com diagrama), captura, drawdown, profit factor,
  expectância, "como funciona o E se". Botão "?" nos KPIs e cabeçalhos.
- **Diagnósticos novos** (`insights.tsx`, cálculos puros em `src/lib/analytics-insights.ts`): entrada (MAE wins vs
  losses), lucro deixado na mesa (MFE vs saída + losses que já estiveram no verde), horário (BR), comportamento
  (pós-loss, reentrada ≤15min, overtrading), dias + distribuição + concentração (melhor dia/trade), banner amostra <30.
- **"E se" reescrito:** stop simulado, alvo, stop+alvo (assume stop primeiro se ambos), parar após N losses/dia,
  máx N trades/dia, sem pior hora, sem pior dia da semana, sem 3 piores losses. Sliders, equity real vs cenário,
  quantos trades melhoram/pioram. "Melhor histórico" só sugerido se supera o real (com dados reais o melhor stop
  rendia MENOS que o real: $1.092 vs $1.469 — o app agora diz isso).
- Validado com os 26 trades reais do Marcelo (base bate: $1.468,70). `tsc` + eslint limpos.
- ⚠️ Não testado visualmente antes do deploy (login localhost quebrado — `redirect_uri_mismatch`). Ajustar ao vivo.

## ✅ 23/09/2026 (noite, v2) — Fix de bug real achado no primeiro deploy da vela
Marcelo testou ao vivo em produção e apontou 2 problemas concretos na primeira
versão da vela:
1. **Bug de sobreposição de texto:** quando o MAE bate exatamente no ponto de
   saída (trade que estoura o stop sem devolver nada — CASO MAIS COMUM),
   a linha do MAE e a linha da Saída caíam na mesma altura e os textos ficavam
   ilegíveis, grudados um no outro. Fix: se MAE/MFE coincide (±4% da altura do
   gráfico) com entrada ou saída, não desenha uma linha própria — vira um
   selinho pequeno colado na linha que já existe.
2. **Vela sem destaque visual:** corpo estreito demais, pavio quase invisível
   (1px cinza). Fix: corpo mais largo (w-20, borda dupla, mais opacidade),
   pavio mais grosso (2px, colorido igual o corpo) com "caps" (bolinhas) nas
   pontas, deixando claro onde o preço bateu o extremo.
`tsc --noEmit` limpo.

## ✅ 23/09/2026 (noite) — Gráfico de Execução vira vela de verdade + link TradingView removido
`src/components/journal/trade-execution-chart.tsx`: o "Gráfico de Execução" do
detalhe do trade (`/journal/[id]`) era um retângulo colorido preenchendo quase
toda a largura — Marcelo reportou como "vela larga e zoada". Redesenhado pra
virar uma vela de verdade: corpo estreito (entrada↔saída, como open/close) +
pavio fino (MFE↔MAE, como high/low de um candle real), centralizados, sem os
blocos de fundo largos que causavam a poluição visual.

Removido o botão/link "TradingView" do card: usava um parâmetro `timestamp` na
URL que o site público do TradingView simplesmente ignora — não existe suporte
deles pra abrir num candle histórico específico via link direto (confirmado
testando ao vivo: abriu o gráfico atual do ativo, não o momento do trade).
Decisão do Marcelo: tirar por enquanto, sem prometer algo que não funciona.
Pra fazer de verdade no futuro, precisa da TradingView Charting Library (cadastro
+ aprovação deles) + uma fonte de dados históricos paga — fica como ideia pro
futuro, não decidido ainda. `tsc --noEmit` limpo.

**Achado à parte:** login no localhost dá erro 400 `redirect_uri_mismatch` do
Google OAuth (o Client ID não tem `http://localhost:3000` nos redirect URIs
autorizados). Não é bug do app nem perda de dado — os trades do Marcelo (24)
seguem intactos no Neon, confirmado via query direta. Não corrigido ainda
(baixa prioridade, só afeta teste local); pra resolver, precisa adicionar
`http://localhost:3000/api/auth/callback/google` nos redirect URIs autorizados
do OAuth Client no Google Cloud Console.

## ✅ 23/09/2026 (tarde) — Toggle por tipo também no Calendário
Mesmo padrão do Analytics: seletor "Todos / Avaliação / Teste" no topo do
`/calendario`, filtrando P&L do mês, win rate, dias operados, melhor/pior dia,
dias lucrativos e a grade inteira do calendário por tipo de conta. Ao trocar de
mês pelas setas (`CalendarNav`), o filtro de tipo agora vai junto na URL — antes
resetaria pra "Todos" a cada navegação de mês. Extraído `bucketOf`/`BUCKET_META`
pra `src/lib/accounts.ts` (já era a 3ª página repetindo a mesma lógica de balde
EVAL/PA/TEST — Analytics também passou a importar dali). `tsc --noEmit` limpo.

## ✅ 23/09/2026 — Fix gráfico Carteira + toggle por tipo no Analytics
1. **Fix equity curve da Carteira** (`src/app/(app)/carteira/page.tsx`): no modo "Por
   tipo", cada linha (Avaliação/Teste) calculava sua própria escala de tempo a partir
   do PRÓPRIO primeiro trade. Um tipo com atividade recente e concentrada num único dia
   (ex: Avaliação, só trades de 22/09) ficava espremido numa fatia mínima de pixels no
   canto do gráfico compartilhado, virando um traço solto e desconexo — feio e confuso.
   Fix: todas as séries agora compartilham o mesmo intervalo de tempo (primeiro trade
   ativo geral até hoje), com lead-in plano no saldo inicial e extensão plana até hoje
   quando o tipo não operou nos últimos dias.
2. **Toggle "Todos / Avaliação / Teste" no Analytics** (`src/app/(app)/analytics/page.tsx`):
   pedido do Marcelo pra poder "surfar" entre tipos de conta na página inteira, não só
   na Carteira. Via query param `?tipo=EVAL|PA|TEST`, filtra o dataset de trades ANTES
   de calcular qualquer métrica — então KPIs, Equity Curve, Drawdown, streaks, MFE/MAE,
   sessão/instrumento/setup e o Simulador "E se" reagem juntos ao filtro escolhido. Só
   mostra no seletor tipos que realmente têm trade; se o filtro ativo zerar os trades,
   mostra mensagem + mantém o seletor visível (não prende o trader sem como voltar).
`tsc --noEmit` limpo nos dois. Testado no localhost pelo Marcelo antes do deploy.

## ✅ 23/09/2026 (cedo) — CORRIGIDO: import CSV NinjaTrader PT-BR zerava P&L negativo
Bug achado em 22/09 (fills que saem no stop importavam como P&L $0,00 em vez do valor
real). Causa raiz: `parseBRNumber` em `src/components/journal/importar-client.tsx` não
removia o espaço entre `-` e o número em `"-$ 117,00"`, e `parseFloat("- 117.00")`
retornava `NaN` → caía no fallback `0`. Fix: remove todo espaço em branco antes de
trocar a vírgula decimal. Validado com os 4 casos de teste do plano e reprocessando o
CSV real de 22/09 fora do app (script isolado, sem login) — os 2 fills do stop agora
saem `-$117,00` e `-$58,50`, P&L total do dia bate em `$236,00`. `tsc --noEmit` limpo.
Detalhe completo em `docs/bug-import-csv-pnl-negativo-zerado.md`. **Pendente:**
`parseNinjaTrader` (EN) e `parseTradovate` não foram tocados — usam formato decimal
diferente (ponto, sem inversão BR) e não têm um CSV real de exemplo em mãos ainda pra
confirmar se sofrem do mesmo problema.

## Última atualização: 22/09/2026 — Checklist de pendências revisado. **Rate limiting na IA: ✅ já implementado** (`src/lib/rate-limit.ts` — Upstash Redis distribuído com fallback in-memory, nunca derruba a request se o Redis falhar) e cobre todos os pontos certos: login (8/5min), registro (8/10min), Vega chat `ask-claude` (20/min), análise de trade IA (15/min), check-in IA (10/min), resumo semanal (5/min; o cron em si é protegido por `CRON_SECRET`, não precisa de rate limit). Pode ser considerado feito. **Semgrep: ✅ já rodou** em 16/09 (baseline p/security-audit+secrets, TypeScript/React/Node/Next.js + Trail of Bits) — mas isso foi ANTES do código novo de 17-18/09 (tours guiados, import CSV, fixes de conta teste abaixo), que ainda não passou por scan. Recomendo rodar de novo quando der.
### Documentado aqui o que faltou registrar de 17-18/09 (trabalho real, só não tinha entrado no progress.md/histórico):
- **Tours guiados contextuais** em todas as páginas principais (Dashboard, Vega IA, Carteira, Journal, Progress, Analytics)
- **Import de CSV do NinjaTrader em português** com detecção automática de multi-conta
- **Seleção múltipla + delete em lote** no Journal
- **Fix de conta teste vazando** em Analytics e Calendário (múltiplos commits de auditoria — toda leitura de trades agora exclui/inclui conta teste de forma consistente)
- **Fix de import de CSV** não atualizava XP nem streaks (journal/dias lucrativos)
- Fix de filtro de data do Journal (travava digitando, ano virava "0006")
- Fix de onboarding reabrindo quando trades reais zeravam; fix de tour repetindo em navegador/dispositivo novo
- OG image dinâmica no link de compartilhamento de trade
- Lembrete de streak de check-in em risco (retenção)

## 17/09/2026 — 🚀 MEUTRADE.APP NO AR, LIBERADO PRA DIVULGAÇÃO. Sessão de hardening + rebrand completo: (1) webhook Asaas forjável corrigido (token rotacionado + validação cruzada com a API do Asaas, histórico git limpo); (2) Semgrep completo — CSP enforce, 34 erros de lint zerados; (3) **Guardian/Apex removidos do produto inteiro** (código, UI, trilha educacional, marketing) — "app do trader, não da Apex", qualquer mesa proprietária pode usar; (4) Termos de Uso + Política de Privacidade criados (LGPD); (5) sync automático NT8/MT5 pausado de propósito via flag reversível (`src/lib/integration-flags.ts`) até a base do produto ficar "redonda"; (6) landing/planos corrigidos pra não prometer sync que está pausado; (7) **2 bugs reais achados testando ao vivo** (não só lendo código) antes de gravar vídeo de divulgação: simulador "E se?" calculava eficiência de saída errado (chegava a -241% com trades perdedores), e input de upload de screenshot vazava por cima do botão em mobile (Tailwind v4 não gerava a classe `sr-only` de uma lib externa). Ambos corrigidos, testados e deployados. Domínio agora é **meutrade.app** (não mais trader-os-ashy.vercel.app). Detalhe completo: `historico/2026-09-17.md`.
## (29/06: PAYWALL PLUGADO EM TODOS OS GATES — ver linha original abaixo) Helper único `src/lib/plan-guard.ts` lê limites do `plans.ts` e devolve 403 padrão (`upgrade:true`+`suggestedPlan`) que o front usa pra abrir o modal. Gates: trades (corrigido BUG do Starter travar em 10 → agora 10/25/∞), setups (0/5/∞), integrações (0/1/∞), Vega check-in (buraco do backend FECHADO, agora Starter+), Vega chat (Pro-only, resposta padrão). Validado: tsc 0 erros + next build OK + teste 15/15 da matriz de limites. Contas (1/1/∞) ficou de fora de propósito (criação implícita compartilhada com sync dos bots). Ver historico/2026-06-29.md
## (28/06: Asaas modo real produção — conta PF, ASAAS_ENV=production, webhook prod, smoke test OK. Ver historico/2026-06-28.md)
## 🚨 GOTCHA: API key começa com `$` → Next expande e zera → escapar `\$` no .env E na Vercel. Token webhook ≥32 chars.
## ⚠️ PENDÊNCIAS: (1) Pix não aparece no checkout → cadastrar chave Pix no painel Asaas; (2) personalizar nome fantasia "TraderOS"+logo (hoje mostra nome/CPF por ser PF). ~~(3) migrar p/ PJ quando tiver CNPJ~~ — resolvido (Marcelo confirmou em 22/09).
## (28/06 manhã: pagamento Asaas implementado + testado sandbox; 25/06: Painel Admin + push cadastro + planos/custos; 20/06: Carteira multi-corretora; 18/06: Web Push)

## 📌 Visão Geral
- **Objetivo:** MeuTrade — plataforma SaaS pro trader brasileiro de qualquer mercado/mesa proprietária (não mais específico de Apex)
- **Stack:** Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Prisma 7 + Neon PostgreSQL + NextAuth v5
- **Status:** NO AR, liberado pra divulgação pública (17/09/2026) — segurança, rebrand e QA validados de ponta a ponta
- **URL Produção:** https://meutrade.app ✅

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
- [x] ~~**Rate limiting na IA**~~ ✅ confirmado em 22/09 — `src/lib/rate-limit.ts` (Upstash + fallback), cobre login/registro/Vega chat/análise de trade/check-in IA/resumo semanal
- [x] ~~**UploadThing**~~ ✅ token na Vercel, screenshots funcionando
- [x] ~~**Domínio traderos.app**~~ — obsoleto, domínio oficial já é `meutrade.app`
- [x] ~~**Vídeo de divulgação HeyGen**~~ ✅ resolvido (Marcelo confirmou em 22/09)
- [x] ~~**CNPJ / subconta Asaas separada por app**~~ ✅ resolvido (Marcelo confirmou em 22/09)
- [x] ~~**Reativar sync automático NT8**~~ — item fechado como **decisão consciente de continuar pausado**, não como reativação: Marcelo confirmou em 22/09 que ainda não é o momento (vai demorar um pouco pra voltar com essa feature). Código continua `NT8_ENABLED = false` em `src/lib/integration-flags.ts`, de propósito — nada a fazer aqui até ele decidir religar. Ver item "NinjaTrader (AddOn de sync)" abaixo pro que ainda falta quando chegar a hora.
- [ ] **Rodar Semgrep de novo** — última varredura foi 16/09; o código de 17-18/09 (tours, import CSV, fixes de conta teste) ainda não foi escaneado
- [ ] **Stripe** — planos Trader R$97 / Pro R$197, webhook para atualizar user.plan (~8-12h) — hoje o pagamento é via Asaas, então prioridade baixa
- [ ] **NinjaTrader (AddOn de sync)** — código reescrito, aguardando teste de compilação no NT8 → commit + deploy após validar (independente do import de CSV manual, que já funciona)
- [ ] **Email de boas-vindas** — Resend após cadastro (RESEND_API_KEY já está na Vercel — confirmar se o envio está de fato disparando)
- [ ] **Pix no checkout Asaas** — cadastrar chave Pix no painel
- [ ] **Nome fantasia + logo no Asaas** — hoje mostra nome/CPF (PF)

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
