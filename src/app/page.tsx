import { redirect } from "next/navigation"
import { auth } from "@/auth"
import Link from "next/link"
import {
  Check,
  X,
  Zap,
  Brain,
  Trophy,
  BarChart3,
  ArrowRight,
  TrendingUp,
  Activity,
  Target,
} from "lucide-react"

export default async function Home() {
  const session = await auth()
  if (session?.user) redirect("/dashboard")

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Radial glow de fundo */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.55 0.18 185 / 0.12), transparent)",
        }}
      />

      {/* ─── NAV ─────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-teal">Trader</span>OS
            </span>
            <span className="hidden sm:inline-block text-[10px] font-mono bg-teal/10 text-teal border border-teal/20 px-1.5 py-0.5 rounded">
              BETA
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Funcionalidades</a>
            <a href="#compare" className="hover:text-foreground transition-colors">Comparativo</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Planos</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="flex items-center gap-1.5 px-4 py-2 bg-teal text-[#080C14] rounded-lg text-sm font-semibold hover:bg-teal/90 transition-colors"
            >
              Começar grátis
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ─── HERO ────────────────────────────────────────────────── */}
      <section className="relative pt-40 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-teal/20 bg-teal/5 text-teal text-xs font-medium mb-8">
            <Zap className="w-3 h-3" />
            O app do trader brasileiro — futuros, forex e ações
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1] mb-6">
            O sistema operacional<br />
            <span className="text-teal">para traders sérios</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
            Journal inteligente com IA, sincronização automática da sua corretora,
            análise emocional e gamificação. Tudo que você precisa para operar
            com consistência e evoluir como trader.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/cadastro"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-teal text-[#080C14] rounded-xl text-base font-bold hover:bg-teal/90 transition-colors shadow-lg shadow-teal/20"
            >
              Criar conta grátis
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-8 py-4 border border-border rounded-xl text-base font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              Já tenho conta
            </Link>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Grátis para sempre até 10 trades/mês. Sem cartão de crédito.
          </p>
        </div>

        {/* Dashboard mockup */}
        <div className="max-w-5xl mx-auto mt-16 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background z-10 pointer-events-none" style={{ top: "60%" }} />
          <div className="rounded-2xl border border-border/60 bg-surface overflow-hidden shadow-2xl shadow-black/60">
            {/* Barra de título fake */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-surface-elevated">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-loss/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-profit/60" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-4 py-1 rounded bg-muted/30 text-xs text-muted-foreground font-mono">
                  traderos.app/dashboard
                </div>
              </div>
            </div>
            {/* Stats cards mock */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "P&L do Mês", value: "+$4.820", color: "text-profit", border: "border-profit/20 bg-profit/5" },
                  { label: "Win Rate", value: "68%", color: "text-teal", border: "border-teal/20 bg-teal/5" },
                  { label: "Trades", value: "47", color: "text-foreground", border: "border-border bg-muted/20" },
                  { label: "Streak", value: "🔥 9 dias", color: "text-orange-400", border: "border-orange-400/20 bg-orange-400/5" },
                ].map((s) => (
                  <div key={s.label} className={`rounded-xl border p-4 ${s.border}`}>
                    <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                    <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              {/* Gráfico mock */}
              <div className="rounded-xl border border-border bg-muted/10 p-4 h-32 flex items-end gap-1 overflow-hidden">
                {[40, 65, 35, 80, 55, 90, 70, 85, 60, 95, 75, 100, 80, 92, 78].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${h}%`,
                      background: h > 70
                        ? "oklch(0.65 0.18 160 / 0.6)"
                        : h < 50
                        ? "oklch(0.55 0.2 25 / 0.5)"
                        : "oklch(0.55 0.18 244 / 0.4)",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Tudo que um trader profissional precisa
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Do check-in emocional antes da sessão até a análise de performance com IA — em uma só plataforma.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group relative p-6 rounded-2xl border border-border bg-surface hover:border-teal/30 transition-all duration-300 hover:bg-surface-elevated"
              >
                <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-teal/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-11 h-11 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center text-teal mb-4">
                  {f.icon}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                {f.badge && (
                  <span className="mt-3 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                    {f.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── COMPARISON ──────────────────────────────────────────── */}
      <section id="compare" className="py-24 px-6 bg-surface/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Por que TraderOS?
            </h2>
            <p className="text-muted-foreground text-lg">
              Compare com outras ferramentas de journal no mercado.
            </p>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden bg-surface">
            {/* Header */}
            <div className="grid grid-cols-3 border-b border-border">
              <div className="p-5 text-sm font-medium text-muted-foreground">Funcionalidade</div>
              <div className="p-5 text-center border-l border-border">
                <p className="text-sm font-bold text-foreground">TraderOS</p>
                <p className="text-xs text-teal font-medium">a partir de grátis</p>
              </div>
              <div className="p-5 text-center border-l border-border">
                <p className="text-sm font-medium text-muted-foreground">Outras ferramentas</p>
                <p className="text-xs text-muted-foreground">a partir de R$29/mês</p>
              </div>
            </div>

            {/* Rows */}
            {COMPARISON.map((row, i) => (
              <div
                key={row.feature}
                className={`grid grid-cols-3 border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/5"}`}
              >
                <div className="p-4 text-sm text-muted-foreground flex items-center">{row.feature}</div>
                <div className="p-4 border-l border-border/50 flex items-center justify-center">
                  {row.traderos === true ? (
                    <Check className="w-4 h-4 text-profit" />
                  ) : row.traderos === false ? (
                    <X className="w-4 h-4 text-loss/60" />
                  ) : (
                    <span className="text-xs text-teal font-medium text-center">{row.traderos}</span>
                  )}
                </div>
                <div className="p-4 border-l border-border/50 flex items-center justify-center">
                  {row.others === true ? (
                    <Check className="w-4 h-4 text-muted-foreground" />
                  ) : row.others === false ? (
                    <X className="w-4 h-4 text-muted-foreground/40" />
                  ) : (
                    <span className="text-xs text-muted-foreground text-center">{row.others}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Preço simples, sem surpresas
            </h2>
            <p className="text-muted-foreground text-lg">
              Comece grátis e faça upgrade quando fizer sentido.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-7 flex flex-col ${
                  plan.highlight
                    ? "border-teal/40 bg-teal/5"
                    : "border-border bg-surface"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full bg-teal text-[#080C14] text-xs font-bold">
                      Mais popular
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{plan.name}</p>
                  <div className="flex items-baseline gap-1">
                    {plan.price === "Grátis" ? (
                      <span className="text-3xl font-bold text-foreground">Grátis</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                        <span className="text-sm text-muted-foreground">/mês</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5">{plan.desc}</p>
                </div>

                <ul className="space-y-2.5 flex-1 mb-7">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-profit shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/cadastro"
                  className={`w-full py-3 rounded-xl text-sm font-semibold text-center transition-colors ${
                    plan.highlight
                      ? "bg-teal text-[#080C14] hover:bg-teal/90"
                      : "border border-border text-foreground hover:bg-muted/30"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ───────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal/10 border border-teal/20 text-teal mb-6">
            <TrendingUp className="w-7 h-7" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Pronto para operar com mais consistência?
          </h2>
          <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
            Junte-se a traders que usam o TraderOS para rastrear performance,
            controlar emoções e evoluir de verdade — opere o que você quiser.
          </p>
          <Link
            href="/cadastro"
            className="inline-flex items-center gap-2 px-8 py-4 bg-teal text-[#080C14] rounded-xl text-base font-bold hover:bg-teal/90 transition-colors shadow-lg shadow-teal/20"
          >
            Criar conta grátis
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            Sem cartão de crédito. Sem compromisso.
          </p>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer className="border-t border-border py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">
              <span className="text-teal">Trader</span>OS
            </span>
            <span className="text-xs text-muted-foreground">© 2026</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">Entrar</Link>
            <Link href="/cadastro" className="hover:text-foreground transition-colors">Criar conta</Link>
            <a href="mailto:traderos.oficial@gmail.com" className="hover:text-foreground transition-colors">Contato</a>
            <a
              href="https://instagram.com/traderos.oficial"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-teal hover:underline"
            >
              📲 Siga @traderos.oficial
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Data ────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Brain className="w-5 h-5" />,
    title: "Vega IA — Análise Inteligente",
    desc: "IA que analisa seus trades com contexto real: win rate por setup, eficiência de saída vs média, correlação de tags comportamentais e mais.",
    badge: "Claude Sonnet",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Sincronização automática",
    desc: "Conecte NinjaTrader ou MetaTrader 5 e seus trades caem no journal sozinhos, com alerta no celular a cada operação.",
    badge: "NinjaTrader + MT5",
  },
  {
    icon: <BarChart3 className="w-5 h-5" />,
    title: "Gráfico de Execução",
    desc: "Visualize onde o preço foi a seu favor (MFE) e contra (MAE) em cada trade. Identifique padrões de saída antecipada.",
  },
  {
    icon: <Activity className="w-5 h-5" />,
    title: "Simulador 'E se?'",
    desc: "Compare seu resultado real com cenários alternativos: saída no MFE, sem os 3 piores losses. Quanto você deixou na mesa?",
  },
  {
    icon: <Target className="w-5 h-5" />,
    title: "Check-in Emocional",
    desc: "Avalie seu estado mental antes de operar. A IA detecta padrões de revenge trade, FOMO e correlaciona com seu P&L real.",
  },
  {
    icon: <Trophy className="w-5 h-5" />,
    title: "Gamificação & Desafios",
    desc: "XP por trade registrado, conquistas, streaks e desafios personalizados com regras similares às das prop firms.",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Sync com NinjaTrader 8",
    desc: "Instale o AddOn uma vez e seus trades aparecem automaticamente no Journal. Sem copiar dados, sem importar CSV.",
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    title: "Analytics Avançado",
    desc: "Métricas por setup, por dia da semana, drawdown chart visual, export PDF e análise de consistência ao longo do tempo.",
  },
  {
    icon: <Activity className="w-5 h-5" />,
    title: "Compartilhar Trades",
    desc: "Gere um link público do seu trade com gráfico de execução e análise Vega. Mostre para a comunidade sem expor dados sensíveis.",
  },
]

const COMPARISON = [
  { feature: "Journal de trades", traderos: true, others: true },
  { feature: "IA integrada para análise", traderos: true, others: false },
  { feature: "Análise por trade com LLM", traderos: true, others: false },
  { feature: "Check-in emocional + correlação", traderos: true, others: false },
  { feature: "Gráfico de execução (MFE/MAE)", traderos: true, others: false },
  { feature: "Simulador 'E se?'", traderos: true, others: false },
  { feature: "Desafios personalizados", traderos: true, others: false },
  { feature: "Gamificação (XP, conquistas, streaks)", traderos: true, others: false },
  { feature: "Sync automático (NinjaTrader + MT5)", traderos: true, others: "Parcial" },
  { feature: "Screenshots no Journal", traderos: true, others: "Parcial" },
  { feature: "Export PDF", traderos: true, others: "Parcial" },
  { feature: "Plano gratuito", traderos: true, others: false },
]

const PLANS = [
  {
    name: "Free",
    price: "Grátis",
    desc: "Para quem está começando",
    highlight: false,
    cta: "Começar grátis",
    features: [
      "Até 10 trades por mês",
      "Journal com PnL automático",
      "Sync com a corretora",
      "Check-in emocional básico",
      "Dashboard de métricas",
    ],
  },
  {
    name: "Trader",
    price: "R$97",
    desc: "Para quem opera ativamente",
    highlight: true,
    cta: "Assinar Trader",
    features: [
      "Trades ilimitados",
      "Vega IA no check-in e chat",
      "Biblioteca de setups ilimitada",
      "Analytics avançado",
      "Sync NinjaTrader 8",
      "Screenshots no Journal",
      "Desafios personalizados",
      "Export PDF",
    ],
  },
  {
    name: "Pro",
    price: "R$197",
    desc: "Para quem leva trading a sério",
    highlight: false,
    cta: "Assinar Pro",
    features: [
      "Tudo do Trader",
      "Análise por trade com Claude Sonnet",
      "Simulador 'E se?' avançado",
      "Gráfico de execução detalhado",
      "Compartilhamento de trades",
      "Histórico de 90 dias no chat IA",
      "Suporte prioritário",
    ],
  },
]
