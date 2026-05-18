import type { Metadata } from "next"
import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Entrar",
}

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Logo e tagline */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-teal flex items-center justify-center">
            <span className="text-teal-foreground font-bold text-sm font-mono">T</span>
          </div>
          <span className="text-xl font-semibold tracking-tight text-foreground">TraderOS</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Bem-vindo de volta</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acesse sua plataforma de trading
        </p>
      </div>

      {/* Formulário */}
      <div className="bg-card border border-border rounded-xl p-6 glow-teal-sm">
        <LoginForm />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Novo por aqui?{" "}
        <a href="/cadastro" className="text-teal hover:underline font-medium">
          Criar conta gratuita
        </a>
      </p>
    </div>
  )
}
