"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, Globe } from "lucide-react"

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError("Email ou senha incorretos")
      setLoading(false)
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
      {/* Google */}
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

      {/* Credenciais */}
      <form onSubmit={handleCredentials} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            required
            className="w-full px-3 py-2 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Senha
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
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
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
        </Button>
      </form>

      <div className="text-right">
        <a href="/recuperar-senha" className="text-xs text-muted-foreground hover:text-teal transition-colors">
          Esqueci minha senha
        </a>
      </div>
    </div>
  )
}
