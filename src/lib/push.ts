import webpush from "web-push"
import { prisma } from "@/lib/prisma"

interface StoredSub {
  id?: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  [key: string]: string | undefined
}

let configured = false
function configure() {
  if (configured) return
  // .trim() defende contra newlines acidentais nas env vars
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys ausentes")
  }
  webpush.setVapidDetails("mailto:difoggijuniormarcelo@gmail.com", publicKey, privateKey)
  configured = true
}

/**
 * Envia uma push notification para UM device. Retorna { ok, status } — nunca lança.
 * status 410/404 = subscription morta (deve ser removida).
 */
export async function sendPushNotification(
  sub: StoredSub,
  payload: PushPayload
): Promise<{ ok: boolean; status: number }> {
  try {
    configure()
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 }
    )
    return { ok: true, status: res.statusCode }
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "statusCode" in err
        ? (err as { statusCode: number }).statusCode
        : 500
    console.error("[sendPushNotification]", status, err instanceof Error ? err.message : err)
    return { ok: false, status }
  }
}

/**
 * Envia push para TODOS os devices de um usuário. Remove subscriptions mortas (410/404).
 * Nunca lança — feita para ser chamada de dentro de fluxos críticos (ex: sync de trade).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; devices: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs = (await (prisma as any).pushSubscription.findMany({ where: { userId } })) as StoredSub[]
  if (subs.length === 0) return { sent: 0, devices: 0 }

  let sent = 0
  await Promise.all(
    subs.map(async (sub) => {
      const res = await sendPushNotification(sub, payload)
      if (res.ok) sent++
      else if ((res.status === 410 || res.status === 404) && sub.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      }
    })
  )
  return { sent, devices: subs.length }
}
