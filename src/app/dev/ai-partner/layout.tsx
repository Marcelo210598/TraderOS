import { notFound } from "next/navigation"
import { isAiPartnerPreviewEnabled } from "@/lib/ai-partner-ui/guards"

// Guard no SERVIDOR: fora de NODE_ENV=development a prévia não existe (404). Transporte falso, sem backend e sem login.
export default function AiPartnerPreviewLayout({ children }: { children: React.ReactNode }) {
  if (!isAiPartnerPreviewEnabled(process.env)) notFound()
  return <div className="dark font-sans min-h-screen bg-background text-foreground antialiased">{children}</div>
}
