import { handleChatPost } from "@/lib/infra/ai-partner-chat"
import { aiPartnerChatCtx } from "../_ctx"

// O turno tem prazo de 50 s e a reserva de cota (lease) dura 90 s: a rota precisa terminar antes dos dois.
export const maxDuration = 60

export async function POST(req: Request) {
  return handleChatPost(await aiPartnerChatCtx(), req)
}
