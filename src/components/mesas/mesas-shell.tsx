import Link from "next/link"
import { auth } from "@/auth"

// Casca pública da seção "Mesas Proprietárias" (conteúdo aberto, sem login).
export async function MesasShell({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const logado = !!session?.user

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <Link href="/" className="font-bold text-sm">
              Meu<span className="text-teal">Trade</span>
            </Link>
            <Link href="/mesas" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              Mesas Proprietárias
            </Link>
            <Link href="/mesas/comparar" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              Comparar
            </Link>
          </div>
          {logado ? (
            <Link href="/dashboard" className="text-xs font-medium text-teal hover:underline underline-offset-2">
              Ir pro app →
            </Link>
          ) : (
            <div className="flex items-center gap-4 text-xs">
              <Link href="/login" className="text-muted-foreground hover:text-foreground transition-colors">
                Entrar
              </Link>
              <Link href="/cadastro" className="font-medium text-teal hover:underline underline-offset-2">
                Criar conta grátis
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">{children}</main>

      <footer className="border-t border-border py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© 2026 MeuTrade · Conteúdo educacional, não é recomendação de investimento.</span>
          <div className="flex items-center gap-4">
            <Link href="/termos" className="hover:text-foreground transition-colors">Termos de Uso</Link>
            <Link href="/privacidade" className="hover:text-foreground transition-colors">Privacidade</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
