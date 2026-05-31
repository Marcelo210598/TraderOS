"use client"

import { useEffect, useRef, useState } from "react"

type AnimateFormat = "integer" | "decimal2" | "currency" | "currency-profit" | "currency-loss"

function applyFormat(n: number, fmt: AnimateFormat): string {
  switch (fmt) {
    case "currency-profit": return `+$${n.toFixed(0)}`
    case "currency-loss":   return `-$${n.toFixed(0)}`
    case "currency":        return `$${n.toFixed(0)}`
    case "decimal2":        return n.toFixed(2)
    case "integer":
    default:                return Math.round(n).toString()
  }
}

interface Props {
  numericValue: number
  animateFormat: AnimateFormat
  className?: string
}

export function AnimatedValue({ numericValue, animateFormat, className }: Props) {
  const [current, setCurrent] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (numericValue === 0) { setCurrent(0); return }
    let startTime: number | null = null
    const duration = 700
    const animate = (now: number) => {
      if (startTime === null) startTime = now
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(numericValue * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [numericValue])

  return <span className={className}>{applyFormat(current, animateFormat)}</span>
}
