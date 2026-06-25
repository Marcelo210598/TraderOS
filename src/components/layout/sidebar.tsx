"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  Wallet,
  Calendar,
  BarChart3,
  BarChart2,
  GraduationCap,
  Trophy,
  MessageSquare,
  Settings,
  ClipboardList,
  ChevronRight,
  Zap,
  X,
  ShieldCheck,
  LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useSidebar } from "./sidebar-context"

interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  planRequired?: "TRADER" | "PRO"
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/carteira", icon: Wallet, label: "Carteira" },
      { href: "/journal", icon: BookOpen, label: "Journal" },
      { href: "/progress", icon: TrendingUp, label: "Progress" },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { href: "/analytics", icon: BarChart2, label: "Analytics" },
      { href: "/setups", icon: BarChart3, label: "Setups", planRequired: "TRADER" },
      { href: "/planner", icon: ClipboardList, label: "Planner" },
      { href: "/calendario", icon: Calendar, label: "Calendário" },
      { href: "/desafios", icon: Trophy, label: "Desafios" },
    ],
  },
  {
    label: "Aprendizado",
    items: [
      { href: "/trilha", icon: GraduationCap, label: "Trilha" },
      { href: "/ask-claude", icon: MessageSquare, label: "Vega IA", planRequired: "PRO" },
    ],
  },
]

interface SidebarProps {
  userPlan?: string
  userRole?: string
  userName?: string
  userImage?: string
  userXp?: number
  userLevel?: number
}

export function Sidebar({ userPlan = "FREE", userRole = "USER", userLevel = 1, userXp = 0 }: SidebarProps) {
  const pathname = usePathname()
  const { mobileOpen, closeMobile } = useSidebar()
  const xpToNextLevel = userLevel * 500
  const xpProgress = Math.min((userXp / xpToNextLevel) * 100, 100)

  function isLocked(planRequired?: string): boolean {
    if (!planRequired) return false
    if (planRequired === "PRO" && userPlan !== "PRO") return true
    if (planRequired === "TRADER" && userPlan === "FREE") return true
    return false
  }

  return (
    <>
      {/* Overlay mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={closeMobile}
        />
      )}

      <aside
        className={cn(
          "flex flex-col w-60 h-screen bg-sidebar border-r border-sidebar-border fixed left-0 top-0 z-30 transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo + fechar mobile */}
        <div className="flex items-center gap-2 px-3 h-14 border-b border-sidebar-border shrink-0">
          <Image src="/icon-32.png" alt="TraderOS" width={28} height={28} className="shrink-0" />
          <span className="text-sm font-semibold tracking-tight text-foreground">TraderOS</span>
          <Badge
            variant="outline"
            className={cn(
              "ml-auto text-[11px] px-2 py-0.5 h-5 font-mono font-bold rounded-md border",
              userPlan === "PRO"
                ? "bg-secondary/20 text-secondary border-secondary/30"
                : userPlan === "TRADER"
                ? "bg-teal/15 text-teal border-teal/30"
                : "bg-muted text-muted-foreground border-border"
            )}
          >
            {userPlan}
          </Badge>
          <button
            onClick={closeMobile}
            className="lg:hidden ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/")
                  const locked = isLocked(item.planRequired)

                  return (
                    <li key={item.href} className="relative">
                      {isActive && (
                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-teal" />
                      )}
                      <Link
                        href={locked ? "/planos" : item.href}
                        onClick={closeMobile}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group",
                          isActive
                            ? "bg-sidebar-accent text-teal font-semibold"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                          locked && "opacity-50"
                        )}
                      >
                        <item.icon
                          className={cn(
                            "w-4 h-4 shrink-0 transition-colors",
                            isActive
                              ? "text-teal"
                              : "text-muted-foreground group-hover:text-foreground"
                          )}
                        />
                        <span className="flex-1">{item.label}</span>
                        {locked && <Zap className="w-3 h-3 text-yellow-500 shrink-0" />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* XP Bar + Configurações */}
        <div className="border-t border-sidebar-border px-3 py-3 space-y-3 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-mono">Nível {userLevel}</span>
              <span className="text-teal font-mono font-medium">
                {userXp}/{xpToNextLevel} XP
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${xpProgress}%`,
                  background: "linear-gradient(90deg, oklch(0.65 0.12 179), oklch(0.72 0.134 179))",
                  boxShadow: "0 0 6px oklch(0.72 0.134 179 / 0.5)",
                }}
              />
            </div>
          </div>

          {userRole === "ADMIN" && (
            <Link
              href="/admin"
              onClick={closeMobile}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-secondary/90 hover:text-secondary hover:bg-sidebar-accent/50 transition-all"
            >
              <ShieldCheck className="w-4 h-4 text-secondary" />
              <span>Admin</span>
            </Link>
          )}

          <Link
            href="/configuracoes"
            onClick={closeMobile}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all"
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span>Configurações</span>
          </Link>
        </div>
      </aside>
    </>
  )
}
