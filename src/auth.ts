import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { compare } from "bcryptjs"
import { z } from "zod"

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            password: true,
            plan: true,
            role: true,
            xp: true,
            level: true,
          },
        })

        if (!user || !user.password) return null

        const passwordMatch = await compare(parsed.data.password, user.password)
        if (!passwordMatch) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          plan: user.plan,
          role: user.role,
          xp: user.xp,
          level: user.level,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Primeiro login — popula token com dados do usuário
        token.id = user.id ?? ""
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = user as any
        if (u.plan !== undefined) {
          token.plan = u.plan
          token.role = u.role
          token.xp = u.xp
          token.level = u.level
        } else {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id as string },
            select: { plan: true, role: true, xp: true, level: true },
          })
          if (dbUser) {
            token.plan = dbUser.plan
            token.role = dbUser.role
            token.xp = dbUser.xp
            token.level = dbUser.level
          }
        }
        token.planUpdatedAt = Math.floor(Date.now() / 1000)
      } else {
        // Requests subsequentes — atualiza plano do DB a cada 1h
        // Garante que downgrade/upgrade de plano reflete em até 60 minutos
        const ONE_HOUR = 3600
        const now = Math.floor(Date.now() / 1000)
        const lastUpdate = (token.planUpdatedAt as number) ?? 0
        if (now - lastUpdate > ONE_HOUR && token.id) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { plan: true, role: true, xp: true, level: true },
          })
          if (dbUser) {
            token.plan = dbUser.plan
            token.role = dbUser.role
            token.xp = dbUser.xp
            token.level = dbUser.level
          }
          token.planUpdatedAt = now
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.plan = token.plan as string
        session.user.role = token.role as string
        session.user.xp = token.xp as number
        session.user.level = token.level as number
      }
      return session
    },
  },
})
