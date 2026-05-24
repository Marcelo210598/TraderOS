import { cookies } from "next/headers"
import { redirect } from "next/navigation"

const COOKIES_TO_CLEAR = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
]

export default async function LogoutPage() {
  const store = await cookies()
  for (const name of COOKIES_TO_CLEAR) {
    store.delete(name)
  }
  redirect("/login")
}
