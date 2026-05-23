import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { AskClaudeChat } from "@/components/ask-claude/ask-claude-chat"

export const metadata: Metadata = { title: "Ask Claude" }

export default async function AskClaudePage() {
  const session = await auth()
  const user = session!.user

  if (user.plan !== "PRO") redirect("/planos")

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <Header
        title="Ask Claude"
        subtitle="Seu analista de trading com IA"
        userName={user.name}
        userEmail={user.email}
        userImage={user.image}
        userPlan={user.plan ?? "FREE"}
      />
      <AskClaudeChat />
    </div>
  )
}
