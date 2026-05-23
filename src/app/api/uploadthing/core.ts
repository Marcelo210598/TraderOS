import { createUploadthing, type FileRouter } from "uploadthing/next"
import { auth } from "@/auth"

const f = createUploadthing()

export const ourFileRouter = {
  tradeScreenshot: f({ image: { maxFileSize: "8MB", maxFileCount: 4 } })
    .middleware(async () => {
      const session = await auth()
      if (!session?.user?.id) throw new Error("Não autorizado")
      return { userId: session.user.id }
    })
    .onUploadComplete(async ({ file }) => {
      return { url: file.ufsUrl, key: file.key, name: file.name }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter
