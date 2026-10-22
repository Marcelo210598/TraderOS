"use client"

import { useMemo } from "react"
import { AiPartnerScreen } from "@/components/ai-partner/ai-partner-screen"
import { createHttpTransport } from "@/lib/ai-partner-ui/transport"

export function AiPartnerRealScreen() {
  const transport = useMemo(() => createHttpTransport({ fetch: (url, init) => fetch(url, init) }), [])
  return <AiPartnerScreen transport={transport} />
}
