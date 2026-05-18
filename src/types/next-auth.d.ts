import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      plan: string
      role: string
      xp: number
      level: number
    }
  }

  interface User {
    plan?: string
    role?: string
    xp?: number
    level?: number
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    plan: string
    role: string
    xp: number
    level: number
  }
}
