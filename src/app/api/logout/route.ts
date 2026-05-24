import { NextRequest, NextResponse } from "next/server"
import { signOut } from "@/auth"

export async function GET(request: NextRequest) {
  await signOut({ redirect: false })
  const loginUrl = new URL("/login", request.nextUrl.origin)
  return NextResponse.redirect(loginUrl)
}
