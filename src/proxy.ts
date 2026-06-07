import { auth } from "@/auth"
import { NextResponse } from "next/server"

const PUBLIC_ROUTES = ["/login", "/cadastro", "/blog", "/", "/share"]
const AUTH_ROUTES = ["/login", "/cadastro"]
// Rotas de API que não precisam de sessão (têm auth própria ou são públicas)
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/sync", "/api/uploadthing"]

export default auth((req) => {
  const { nextUrl, auth: session } = req
  const isLoggedIn = !!session?.user

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
