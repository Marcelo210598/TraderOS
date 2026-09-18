import { prisma } from "@/lib/prisma"

// Busca os tours (SectionTour) que o usuário já viu, pra decidir server-side
// se mostra ou não — usado por toda página que renderiza um SectionTour.
export async function hasSeenTour(userId: string, id: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { seenTours: true },
  })
  return user?.seenTours.includes(id) ?? false
}
