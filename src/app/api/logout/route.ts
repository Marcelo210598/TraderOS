import { NextRequest, NextResponse } from "next/server"

const COOKIES_TO_CLEAR = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
]

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.nextUrl.origin)
  const response = NextResponse.redirect(loginUrl)

  for (const name of COOKIES_TO_CLEAR) {
    response.cookies.set({ name, value: "", expires: new Date(0), path: "/" })
  }

  return response
}
