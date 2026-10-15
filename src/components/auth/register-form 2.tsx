"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, Globe } from "lucide-react"
import { trackGoogleAdsLead } from "@/lib/gtag"

export function RegisterForm() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password !== confirm) {
      setError("As senhas não conferem")
      return
    }
    if (password.length < 8) {
      setError("Senha deve ter pelo menos 8 caracteres")
      return
    }

    setLoading(true)

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Erro ao criar conta")
      setLoading(false)
      return
    }

    // Retargeting: cadastro confirmado (só cobre o fluxo email/senha — o Google OAuth
    // conta como Lead no GA4/Meta via servidor, mas não tem um clique client-side pra
    // disparar a conversão do Google Ads).
    trackGoogleAdsLead()

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      router.push("/login")
      return
    }

    router.push("/dashboard")
  }

  async function handleGoogle() {
    setLoading(true)
    await signIn("google", { callbackUrl: "/dashboard" })
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        className="w-full gap-2 bg-surface-elevated border-border hover:bg-muted"
        onClick={handleGoogle}
        disabled={loading}
      >
        <Globe className="w-4 h-4" />
        Continuar com Google
      </Button>

      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">ou</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Nome completo
          </label>
          <input
            id="reg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
            required
            className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            required
            className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Senha
          </label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            required
            className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-confirm" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Confirmar senha
          </label>
          <input
            id="reg-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repita a senha"
            required
            className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>

        {error && (
          <p className="text-xs text-loss bg-loss/10 border border-loss/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
          disabled={loading}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar conta gratuita"}
        </Button>
      </form>

      <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
        Ao criar sua conta você concorda com os termos de uso e política de privacidade.
      </p>
    </div>
  )
}
