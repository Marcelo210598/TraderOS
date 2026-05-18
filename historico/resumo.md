# TraderOS — Resumo Geral

## O que é
SaaS para traders brasileiros de futuros americanos via prop firms (Apex Trader Funding/NinjaTrader).

## Módulos
- **Journal** — diário de trades com screenshots e análise IA
- **Progress** — gamificação (XP, conquistas, streaks)
- **Guardian** — calculadora de regras Apex (trailing drawdown, consistency rule, scaling)
- Módulos secundários: check-in emocional, plano pré-sessão, biblioteca de setups, calendário econômico, trilha de aprendizado, Ask Claude

## Stack
- Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui (Base UI Nova preset)
- Prisma 7 + @prisma/adapter-pg + Neon PostgreSQL
- NextAuth v5 (Google + credentials)
- Resend (email) + UploadThing (screenshots) + Claude API (plano Pro)

## Design
Dark mode obrigatório. Paleta "Terminal":
- Fundo: #080C14 | Accent Teal: #00C2A8 | Indigo: #818CF8
- Profit: #10B981 | Loss: #F43F5E

## Como rodar
```bash
cd "Desktop/Projetos AI/TraderOS"
cp .env.example .env  # preencher vars
npm run dev
```

## Breaking changes relevantes desta stack
1. **Prisma 7:** URL no `prisma.config.ts`, não no `schema.prisma`. Usar `@prisma/adapter-pg`
2. **shadcn Base UI:** sem `asChild`, usar `render` prop ou `<a>` direto
3. **Next.js 16:** `middleware.ts` → `proxy.ts`
4. **NextAuth v5:** `auth()` server-side, sem `getServerSession`
