"use client"

import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus, LucideIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

type AnimateFormat = "integer" | "decimal2" | "currency" | "currency-profit" | "currency-loss"

interface StatsCardProps {
  title: string
  value: string
  change?: number
  changeLabel?: string
  icon: LucideIcon
  variant?: "default" | "profit" | "loss" | "neutral"
  suffix?: string
  className?: string
  numericValue?: number
  animateFormat?: AnimateFormat
}

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

function useCountUp(target: number | undefined, duration = 700) {
  const [current, setCurrent] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (target === undefined || target === 0) {
      setCurrent(0)
      return
    }
    let startTime: number | null = null
    const animate = (now: number) => {
      if (startTime === null) startTime = now
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(target * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return current
}

export function StatsCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  variant = "default",
  suffix,
  className,
  numericValue,
  animateFormat,
}: StatsCardProps) {
  const animated = useCountUp(numericValue)
  const displayValue =
    numericValue !== undefined && animateFormat ? applyFormat(animated, animateFormat) : value

  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0

  return (
    <div
      className={cn(
        "relative bg-card border border-border rounded-xl p-4 flex flex-col gap-3 transition-all duration-150 overflow-hidden",
        "hover:border-border/60 hover:shadow-md hover:shadow-black/20",
        variant === "profit" && "border-profit/20 hover:border-profit/30",
        variant === "loss" && "border-loss/20 hover:border-loss/30",
        className
      )}
    >
      {/* Accent bar esquerda */}
      <div
        className={cn(
          "absolute left-0 top-3 bottom-3 w-[3px] rounded-full",
          variant === "profit" && "bg-profit",
          variant === "loss" && "bg-loss",
          variant === "neutral" && "bg-muted-foreground/40",
          variant === "default" && "bg-teal"
        )}
      />
      {/* Gradient overlay sutil */}
      <div
        className={cn(
          "absolute inset-0 opacity-[0.04] rounded-xl pointer-events-none",
          variant === "profit" && "bg-gradient-to-br from-profit to-transparent",
          variant === "loss" && "bg-gradient-to-br from-loss to-transparent",
          (variant === "default" || !variant) && "bg-gradient-to-br from-teal to-transparent",
          variant === "neutral" && "bg-transparent"
        )}
      />
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            variant === "profit"
              ? "bg-profit/10"
              : variant === "loss"
              ? "bg-loss/10"
              : variant === "neutral"
              ? "bg-muted"
              : "bg-accent"
          )}
        >
          <Icon
            className={cn(
              "w-4 h-4",
              variant === "profit"
                ? "text-profit"
                : variant === "loss"
                ? "text-loss"
                : variant === "neutral"
                ? "text-muted-foreground"
                : "text-teal"
            )}
          />
        </div>
      </div>

      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold font-mono text-foreground">{displayValue}</span>
          {suffix && <span className="text-sm text-muted-foreground font-mono">{suffix}</span>}
        </div>

        {change !== undefined && (
          <div
            className={cn(
              "flex items-center gap-1 mt-1 text-xs font-medium",
              isPositive ? "text-profit" : isNegative ? "text-loss" : "text-muted-foreground"
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : isNegative ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            <span>
              {isPositive ? "+" : ""}
              {change.toFixed(1)}%{changeLabel ? ` ${changeLabel}` : " vs mês anterior"}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
