import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.nextUrl.origin)
  const response = NextResponse.redirect(loginUrl)

  const incoming = request.cookies.getAll()
  for (const c of incoming) {
    if (
      c.name.startsWith("authjs.") ||
      c.name.startsWith("__Secure-authjs.") ||
      c.name.startsWith("__Host-authjs.")
    ) {
      const isSecure = c.name.startsWith("__Secure-") || c.name.startsWith("__Host-")
      response.headers.append(
        "Set-Cookie",
        `${c.name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`
      )
    }
  }

  return response
}
