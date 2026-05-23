import type { Metadata } from "next"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { Lock, CheckCircle2, Circle, BookOpen, Target, TrendingUp, Brain, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Trilha" }

const modules = [
  {
    id: 1,
    title: "Fundamentos do Trading",
    description: "Entenda os conceitos básicos antes de operar",
    icon: BookOpen,
    lessons: 6,
    status: "coming_soon",
    color: "text-teal",
    bg: "bg-teal/10",
  },
  {
    id: 2,
    title: "Gestão de Risco",
    description: "Stop loss, position sizing e proteção de capital",
    icon: Shield,
    lessons: 5,
    status: "coming_soon",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    id: 3,
    title: "Leitura de Mercado",
    description: "Order flow, market structure e price action",
    icon: TrendingUp,
    lessons: 8,
    status: "coming_soon",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
  },
  {
    id: 4,
    title: "Psicologia do Trader",
    description: "Disciplina, controle emocional e rotina vencedora",
    icon: Brain,
    lessons: 4,
    status: "coming_soon",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
  },
  {
    id: 5,
    title: "Apex Trader Funding",
    description: "Regras, estratégias e como passar a avaliação",
    icon: Target,
    lessons: 7,
    status: "coming_soon",
    color: "text-pink-400",
    bg: "bg-pink-400/10",
  },
]

export default async function TrilhaPage() {
  const session = await auth()
  const user = session!.user

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Trilha de Aprendizado"
        subtitle="Evolua do básico ao avançado no seu ritmo"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-4">
        {/* Banner em breve */}
        <div className="bg-teal/5 border border-teal/20 rounded-xl p-4 flex items-start gap-3">
          <span className="text-2xl">🚀</span>
          <div>
            <p className="text-sm font-semibold text-foreground">Em breve</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              A trilha de aprendizado está sendo construída. Em breve você terá aulas, quizzes e exercícios práticos direto aqui.
            </p>
          </div>
        </div>

        {/* Módulos */}
        <div className="space-y-3">
          {modules.map((mod, index) => {
            const Icon = mod.icon
            return (
              <div
                key={mod.id}
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 opacity-60 cursor-not-allowed"
              >
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", mod.bg)}>
                  <Icon className={cn("w-5 h-5", mod.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      Módulo {mod.id}: {mod.title}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">{mod.lessons} aulas</p>
                </div>
                <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
