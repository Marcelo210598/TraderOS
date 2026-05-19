import type { Metadata } from "next"
import { RegisterForm } from "@/components/auth/register-form"

export const metadata: Metadata = { title: "Criar conta" }

export default function CadastroPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-teal flex items-center justify-center">
            <span className="text-teal-foreground font-bold text-sm font-mono">T</span>
          </div>
          <span className="text-xl font-semibold tracking-tight text-foreground">TraderOS</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Criar conta gratuita</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Journal, progresso e muito mais — sem custo pra começar
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 glow-teal-sm">
        <RegisterForm />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Já tem conta?{" "}
        <a href="/login" className="text-teal hover:underline font-medium">
          Entrar
        </a>
      </p>
    </div>
  )
}
