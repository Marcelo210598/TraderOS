import { handleImportPost, handleImportsGet } from "@/lib/infra/ai-partner-imports"
import { aiPartnerCtx } from "../_ctx"

export async function POST(req: Request) {
  return handleImportPost(await aiPartnerCtx(), req)
}

export async function GET(req: Request) {
  return handleImportsGet(await aiPartnerCtx(), req)
}
