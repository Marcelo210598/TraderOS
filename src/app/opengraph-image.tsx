import { ogImageSize, ogImageContentType, renderOgImage } from "@/lib/og-image"

export const alt = "MeuTrade — O app do trader brasileiro"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage()
}
