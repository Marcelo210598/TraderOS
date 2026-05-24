import type { Metadata } from "next"
import Image from "next/image"
import { RegisterForm } from "@/components/auth/register-form"

export const metadata: Metadata = { title: "Criar conta" }

export default function CadastroPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Image src="/logo.png" alt="TraderOS" width={180} height={180} priority />
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
