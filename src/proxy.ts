import { auth } from "@/auth"
import { NextResponse } from "next/server"

const PUBLIC_ROUTES = ["/login", "/cadastro", "/blog", "/", "/share", "/opengraph-image", "/twitter-image"]
const AUTH_ROUTES = ["/login", "/cadastro"]
// Rotas de API que não precisam de sessão (têm auth própria ou são públicas)
// /api/asaas/webhook é público (autentica via token do Asaas); o checkout exige sessão.
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/sync", "/api/uploadthing", "/api/asaas/webhook"]

export default auth((req) => {
  const { nextUrl, auth: session } = req
  const isLoggedIn = !!session?.user

  // opengraph-image/twitter-image do Next.js viram rotas sem extensão (ex: /opengraph-image),
  // então o matcher abaixo não os exclui como faz com robots.txt/sitemap.xml — precisam
  // estar na allowlist explicitamente, senão o crawler do WhatsApp/FB é redirecionado pro /login.
  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => nextUrl.pathname === route || nextUrl.pathname.startsWith("/blog") || nextUrl.pathname.startsWith("/share")
  )
  const isAuthRoute = AUTH_ROUTES.some((route) => nextUrl.pathname.startsWith(route))
  const isApiRoute = nextUrl.pathname.startsWith("/api/")
  const isPublicApiRoute = PUBLIC_API_PREFIXES.some((prefix) => nextUrl.pathname.startsWith(prefix))

  if (isAuthRoute && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl))
  }

  if (!isLoggedIn) {
    if (isApiRoute) {
      // APIs públicas (sync, auth, uploadthing) passam sem sessão
      if (isPublicApiRoute) return NextResponse.next()
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }
    if (!isPublicRoute) {
      return NextResponse.redirect(new URL("/login", nextUrl))
    }
  }

  return NextResponse.next()
})

export const config = {
  // Cobre tudo exceto assets estáticos — incluindo /api
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
