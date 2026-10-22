import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isAiPartnerPreviewEnabled } from "@/lib/ai-partner-ui/guards"
import { PreviewShell } from "./preview-shell"

export function generateMetadata(): Metadata {
  return isAiPartnerPreviewEnabled(process.env) ? { title: "AI Partner (prévia)", robots: { index: false, follow: false } } : {}
}

export default function AiPartnerPreviewPage() {
  if (!isAiPartnerPreviewEnabled(process.env)) notFound()
  return <PreviewShell />
}
