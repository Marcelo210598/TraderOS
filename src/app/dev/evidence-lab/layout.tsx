import { notFound } from "next/navigation"
import { isEvidenceLabEnabled } from "@/lib/dev/evidence-lab/guard"

// Guard no SERVIDOR (1 de 4 pontos: proxy, layout, page, construtor de dados). Fora de NODE_ENV=development a rota não existe (404).
export default function EvidenceLabLayout({ children }: { children: React.ReactNode }) {
  if (!isEvidenceLabEnabled()) notFound()
  return <div className="min-h-screen bg-zinc-950 text-zinc-200 antialiased">{children}</div>
}
