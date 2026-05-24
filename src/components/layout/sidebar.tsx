"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  Shield,
  Calendar,
  BarChart3,
  GraduationCap,
  MessageSquare,
  Settings,
  ChevronRight,
  Zap,
  LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

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
      { href: "/journal", icon: BookOpen, label: "Journal" },
      { href: "/progress", icon: TrendingUp, label: "Progress" },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { href: "/guardian", icon: Shield, label: "Guardian", planRequired: "TRADER" },
      { href: "/setups", icon: BarChart3, label: "Setups", planRequired: "TRADER" },
      { href: "/calendario", icon: Calendar, label: "Calendário" },
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
  userName?: string
  userImage?: string
  userXp?: number
  userLevel?: number
}

export function Sidebar({ userPlan = "FREE", userLevel = 1, userXp = 0 }: SidebarProps) {
  const pathname = usePathname()
  const xpToNextLevel = userLevel * 500
  const xpProgress = Math.min((userXp / xpToNextLevel) * 100, 100)

  function isLocked(planRequired?: string): boolean {
    if (!planRequired) return false
    if (planRequired === "PRO" && userPlan !== "PRO") return true
    if (planRequired === "TRADER" && userPlan === "FREE") return true
    return false
  }

  return (
    <aside className="flex flex-col w-60 h-screen bg-sidebar border-r border-sidebar-border fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 h-14 border-b border-sidebar-border shrink-0">
        <Image src="/icon-32.png" alt="TraderOS" width={28} height={28} className="shrink-0" />
        <span className="text-sm font-semibold tracking-tight text-foreground">TraderOS</span>
        {userPlan !== "FREE" && (
          <Badge
            variant="outline"
            className={cn(
              "ml-auto text-[10px] px-1.5 py-0 h-4 font-mono font-bold border-0",
              userPlan === "PRO"
                ? "bg-secondary/20 text-secondary"
                : "bg-teal/15 text-teal"
            )}
          >
            {userPlan}
          </Badge>
        )}
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
                  <li key={item.href}>
                    <Link
                      href={locked ? "/planos" : item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group",
                        isActive
                          ? "bg-sidebar-accent text-teal font-medium"
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
                      {isActive && <ChevronRight className="w-3 h-3 text-teal shrink-0" />}
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
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-teal rounded-full transition-all duration-500"
              style={{ width: `${xpProgress}%` }}
            />
          </div>
        </div>

        <Link
          href="/configuracoes"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span>Configurações</span>
        </Link>
      </div>
    </aside>
  )
}
