import { auth } from "@/auth"
import { NextResponse } from "next/server"

const PUBLIC_ROUTES = ["/login", "/cadastro", "/blog", "/"]
const AUTH_ROUTES = ["/login", "/cadastro"]

export default auth((req) => {
  const { nextUrl, auth: session } = req
  const isLoggedIn = !!session?.user

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => nextUrl.pathname === route || nextUrl.pathname.startsWith("/blog")
  )
  const isAuthRoute = AUTH_ROUTES.some((route) => nextUrl.pathname.startsWith(route))

  if (isAuthRoute && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl))
  }

  if (!isPublicRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
