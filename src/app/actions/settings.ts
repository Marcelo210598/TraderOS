"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hash, compare } from "bcryptjs"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const profileSchema = z.object({
  name: z.string().min(2).max(60),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
})

export async function updateProfile(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Não autenticado" }

  const parsed = profileSchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) return { error: "Nome inválido (mín. 2 caracteres)" }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  })

  revalidatePath("/configuracoes")
  return { success: true }
}

export async function updatePassword(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: "Não autenticado" }

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  })
  if (!parsed.success) return { error: "Senhas inválidas (mín. 8 caracteres)" }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })

  if (!user?.password) return { error: "Conta criada via Google — sem senha para alterar" }

  const match = await compare(parsed.data.currentPassword, user.password)
  if (!match) return { error: "Senha atual incorreta" }

  const hashed = await hash(parsed.data.newPassword, 12)
  await prisma.user.update({
    where: { id: session.user.id },
    data: { password: hashed },
  })

  return { success: true }
}
