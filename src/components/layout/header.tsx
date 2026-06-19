"use client"

import { LogOut, Settings, ChevronDown, Menu } from "lucide-react"
import { NotificationBell } from "./notification-bell"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useSidebar } from "./sidebar-context"

interface HeaderProps {
  title: string
  subtitle?: string
  userName?: string | null
  userEmail?: string | null
  userImage?: string | null
  userPlan?: string
}

export function Header({
  title,
  subtitle,
  userName,
  userEmail,
  userImage,
  userPlan = "FREE",
}: HeaderProps) {
  const { toggleMobile } = useSidebar()

  const initials =
    userName
      ?.split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "T"

  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm flex items-center px-4 gap-3 sticky top-0 z-20">
      {/* Hamburguer — só mobile */}
      <button
        onClick={toggleMobile}
        className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        aria-label="Abrir menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-foreground truncate">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors outline-none"
          >
            <Avatar className="w-6 h-6">
              <AvatarImage src={userImage ?? undefined} />
              <AvatarFallback className="bg-teal text-teal-foreground text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-foreground hidden sm:block max-w-24 truncate">
              {userName ?? "Trader"}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] px-1 py-0 h-4 font-mono font-bold border-0 hidden sm:flex",
                userPlan === "PRO"
                  ? "bg-secondary/20 text-secondary"
                  : userPlan === "TRADER"
                  ? "bg-teal/15 text-teal"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {userPlan}
            </Badge>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48 bg-card border-border">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium text-foreground truncate">{userName}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem className="cursor-pointer text-muted-foreground hover:text-foreground gap-2">
              <a href="/configuracoes" className="flex items-center gap-2 w-full">
                <Settings className="w-4 h-4" />
                Configurações
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <a
          href="/api/logout"
          title="Sair"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </a>
      </div>
    </header>
  )
}
