import { handleImportDelete } from "@/lib/infra/ai-partner-imports"
import { aiPartnerCtx } from "../../_ctx"

export async function DELETE(req: Request, { params }: { params: Promise<{ sha: string }> }) {
  const { sha } = await params
  return handleImportDelete(await aiPartnerCtx(), req, sha)
}
