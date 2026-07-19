import { NextRequest, NextResponse } from "next/server"

// Coletor de violações do CSP (modo Report-Only). O navegador faz POST aqui quando
// um recurso VIOLARIA a política — nada é bloqueado, só registramos pra calibrar antes
// de ligar o enforce. Logamos um resumo enxuto (aparece nos logs da Vercel).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    // Formato report-uri: { "csp-report": {...} }. Formato report-to: array de reports.
    const r = body?.["csp-report"] ?? body?.[0]?.body ?? body
    if (r) {
      const blocked = r["blocked-uri"] ?? r.blockedURL ?? "?"
      const directive = r["violated-directive"] ?? r.effectiveDirective ?? "?"
      const doc = r["document-uri"] ?? r.documentURL ?? "?"
      console.warn(`[CSP] violado ${directive} | bloqueado: ${String(blocked).slice(0, 200)} | em: ${String(doc).slice(0, 200)}`)
    }
  } catch {
    // ignora corpo malformado — não deve derrubar nada
  }
  // 204: recebido, sem conteúdo. Navegador não espera resposta útil.
  return new NextResponse(null, { status: 204 })
}
