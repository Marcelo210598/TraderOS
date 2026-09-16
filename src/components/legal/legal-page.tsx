import Link from "next/link"

interface Props {
  title: string
  updatedAt: string
  children: React.ReactNode
}

export function LegalPage({ title, updatedAt, children }: Props) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-bold text-sm">
            Meu<span className="text-teal">Trade</span>
          </Link>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Voltar ao site
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-1">{title}</h1>
        <p className="text-xs text-muted-foreground mb-10">Última atualização: {updatedAt}</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground/90 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_p+p]:mt-3 [&_a]:text-teal [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-foreground">
          {children}
        </div>
      </main>

      <footer className="border-t border-border py-8">
        <div className="max-w-3xl mx-auto px-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>© 2026 MeuTrade</span>
          <div className="flex items-center gap-4">
            <Link href="/termos" className="hover:text-foreground transition-colors">Termos de Uso</Link>
            <Link href="/privacidade" className="hover:text-foreground transition-colors">Privacidade</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
