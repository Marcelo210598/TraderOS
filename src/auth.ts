import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { notifyAdminsNewSignup } from "@/lib/admin"
import { sendCapiEvent } from "@/lib/fbcapi"
import { sendGa4Event } from "@/lib/ga4"
import { compare } from "bcryptjs"
import { hit, clientIp } from "@/lib/rate-limit"
import { z } from "zod"

const credentialsSchema = z.object({
  // normaliza o email (trim + minusculo) p/ casar com o banco independente do case digitado
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
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
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        // Rate limit anti brute-force: no máx 8 tentativas por email+IP a cada 5 min.
        // Retorna antes do bcrypt.compare — economiza CPU e trava ataque de senha.
        const ip = clientIp(request)
        const rl = hit(`login:${parsed.data.email}:${ip}`, 8, 300)
        if (!rl.ok) return null

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
  events: {
    // Dispara quando o adapter cria um usuário novo (cadastro via Google).
    // O cadastro por email/senha é avisado direto na rota /api/auth/register.
    async createUser({ user }) {
      await notifyAdminsNewSignup({ email: user.email, name: user.name }).catch(() => null)
      // Retargeting: mede quanto do tráfego IG/FB vira cadastro (Lead).
      await sendCapiEvent({ eventName: "Lead", email: user.email }).catch(() => null)
      await sendGa4Event({ eventName: "generate_lead", userKey: user.id ?? user.email ?? "" }).catch(() => null)
    },
  },
})
