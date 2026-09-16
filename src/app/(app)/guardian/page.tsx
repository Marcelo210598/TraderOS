import { redirect } from "next/navigation"

// Guardian foi descontinuado (era uma calculadora específica das regras da Apex
// Trader Funding). Redirect pra não quebrar bookmarks/links antigos.
export default function GuardianPage() {
  redirect("/dashboard")
}
