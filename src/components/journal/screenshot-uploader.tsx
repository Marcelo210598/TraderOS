"use client"

import { useState } from "react"
import { X, ImagePlus, Loader2 } from "lucide-react"
import { UploadButton } from "@/lib/uploadthing"
import { cn } from "@/lib/utils"

export interface UploadedScreenshot {
  url: string
  key: string
  name: string
  label?: string
}

interface ScreenshotUploaderProps {
  value: UploadedScreenshot[]
  onChange: (screenshots: UploadedScreenshot[]) => void
}

export function ScreenshotUploader({ value, onChange }: ScreenshotUploaderProps) {
  const [uploading, setUploading] = useState(false)

  function remove(key: string) {
    onChange(value.filter((s) => s.key !== key))
  }

  function setLabel(key: string, label: string) {
    onChange(value.map((s) => (s.key === key ? { ...s, label } : s)))
  }

  return (
    <div className="space-y-3">
      {/* Previews */}
      {value.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {value.map((s) => (
            <div key={s.key} className="relative group">
              <img
                src={s.url}
                alt={s.label ?? s.name}
                className="w-full rounded-lg border border-border object-cover aspect-video"
              />
              <button
                type="button"
                onClick={() => remove(s.key)}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-background/80 border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-loss/20 hover:border-loss/40"
              >
                <X className="w-3 h-3 text-foreground" />
              </button>
              <input
                type="text"
                placeholder="Legenda (opcional)"
                value={s.label ?? ""}
                onChange={(e) => setLabel(s.key, e.target.value)}
                className="mt-1.5 w-full px-2 py-1 rounded-md bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {value.length < 4 && (
        <UploadButton
          endpoint="tradeScreenshot"
          onUploadBegin={() => setUploading(true)}
          onClientUploadComplete={(files) => {
            setUploading(false)
            const newScreenshots = files.map((f) => ({
              url: f.ufsUrl ?? f.url,
              key: f.key,
              name: f.name,
            }))
            onChange([...value, ...newScreenshots])
          }}
          onUploadError={() => setUploading(false)}
          appearance={{
            button: cn(
              "w-full ut-readying:cursor-not-allowed ut-uploading:cursor-wait",
              "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border",
              "text-sm text-muted-foreground hover:border-teal/40 hover:text-teal transition-colors bg-transparent",
              "after:hidden"
            ),
            allowedContent: "hidden",
          }}
          content={{
            button: (
              <>
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                {uploading ? "Enviando..." : `Adicionar screenshot (${value.length}/4)`}
              </>
            ),
          }}
        />
      )}
    </div>
  )
}
