import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formata um valor em dólar com sinal explícito: +$440 / -$223 / $0 */
export function signedUsd(n: number, decimals = 0): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : ""
  return `${sign}$${Math.abs(n).toFixed(decimals)}`
}
