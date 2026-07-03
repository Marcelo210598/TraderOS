import type { Metadata } from "next"
import Image from "next/image"
import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Entrar",
}

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Logo e tagline */}
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Image
            src="/logo.png"
            alt="MeuTrade"
            width={180}
            height={180}
            priority
            style={{ filter: "drop-shadow(0 0 24px oklch(0.72 0.134 179 / 0.45))" }}
          />
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
