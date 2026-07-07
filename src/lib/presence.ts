import { prisma } from "@/lib/prisma"

// Atualiza User.lastSeenAt no MÁXIMO 1x a cada 3 min por usuário (throttle no proprio WHERE,
// então nao precisa de leitura previa e nao escreve a cada navegacao). Base do "online/ativos".
const THROTTLE_MS = 3 * 60 * 1000

export async function touchLastSeen(userId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - THROTTLE_MS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).user.updateMany({
      where: {
        id: userId,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
      },
      data: { lastSeenAt: new Date() },
    })
  } catch {
    // presença nunca pode derrubar o carregamento da página
  }
}
