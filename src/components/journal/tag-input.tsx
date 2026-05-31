"use client"

import { useState, useRef } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  placeholder?: string
  className?: string
}

export function TagInput({ value, onChange, suggestions = [], placeholder = "Adicionar tag...", className }: TagInputProps) {
  const [input, setInput] = useState("")
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  )

  function addTag(tag: string) {
    const clean = tag.trim().toLowerCase()
    if (!clean || value.includes(clean)) {
      setInput("")
      return
    }
    onChange([...value, clean])
    setInput("")
    setOpen(false)
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      if (input.trim()) addTag(input)
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  const showDropdown = open && (
    filtered.length > 0 ||
    (input.trim().length > 0 && !value.includes(input.trim().toLowerCase()) && !suggestions.includes(input.trim().toLowerCase()))
  )

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5 px-3 py-2 rounded-lg bg-input border border-border min-h-[40px] cursor-text focus-within:ring-1 focus-within:ring-ring transition-all",
        className
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 text-xs bg-teal/10 border border-teal/30 text-teal px-2 py-0.5 rounded-md font-mono"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
            className="hover:text-loss transition-colors ml-0.5"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      <div className="relative flex-1 min-w-[100px]">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length === 0 ? placeholder : ""}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none py-0.5"
        />

        {showDropdown && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
            {input.trim().length > 0 &&
              !value.includes(input.trim().toLowerCase()) &&
              !suggestions.includes(input.trim().toLowerCase()) && (
              <button
                type="button"
                onMouseDown={() => addTag(input)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">Criar:</span>
                <span className="font-mono text-teal">{input.trim().toLowerCase()}</span>
              </button>
            )}
            {filtered.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={() => addTag(s)}
                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors font-mono"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
