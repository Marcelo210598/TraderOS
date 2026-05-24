import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "authjs.pkce.code_verifier",
  "__Secure-authjs.pkce.code_verifier",
  "authjs.state",
  "__Secure-authjs.state",
  "authjs.nonce",
  "__Secure-authjs.nonce",
]

function buildCookieClear(name: string): string {
  const isSecure = name.startsWith("__Secure-") || name.startsWith("__Host-")
  const parts = [
    `${name}=`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (isSecure) parts.push("Secure")
  return parts.join("; ")
}

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.nextUrl.origin)
  const response = NextResponse.redirect(loginUrl)

  const allNames = new Set<string>()
  for (const name of COOKIE_NAMES) {
    allNames.add(name)
    for (let i = 0; i < 10; i++) allNames.add(`${name}.${i}`)
  }

  const incoming = request.cookies.getAll()
  for (const c of incoming) {
    if (
      c.name.startsWith("authjs.") ||
      c.name.startsWith("__Secure-authjs.") ||
      c.name.startsWith("__Host-authjs.")
    ) {
      allNames.add(c.name)
    }
  }

  for (const name of allNames) {
    response.headers.append("Set-Cookie", buildCookieClear(name))
  }

  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")

  return response
}
