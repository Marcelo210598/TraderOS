import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { isAiPartnerPageEnabled, isAiPartnerUserAllowed } from "@/lib/ai-partner-ui/guards"
import { AiPartnerRealScreen } from "./screen"

export const metadata: Metadata = { title: "AI Partner", robots: { index: false, follow: false } }

// Escondida (D-U1): sem AI_PARTNER_UI=1 no servidor a rota responde 404 e não aparece no menu.
export default async function AiPartnerPage() {
  if (!isAiPartnerPageEnabled(process.env)) notFound()
  const session = await auth()
  const user = session!.user
  // E7-18: além da flag, só os e-mails da lista (AI_PARTNER_ALLOWED_EMAILS) veem a tela; os demais recebem 404.
  if (!isAiPartnerUserAllowed(process.env, user.email)) notFound()
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header title="AI Partner" subtitle="Pergunte sobre os seus trades" userName={user.name} userEmail={user.email} userImage={user.image} userPlan={user.plan ?? "FREE"} />
      <AiPartnerRealScreen />
    </div>
  )
}
