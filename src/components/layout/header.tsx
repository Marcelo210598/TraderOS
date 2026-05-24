"use client"

import { Bell, LogOut, User, ChevronDown } from "lucide-react"
import { signOut } from "next-auth/react"
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
  const initials =
    userName
      ?.split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "T"

  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm flex items-center px-6 gap-4 sticky top-0 z-20">
      <div className="flex-1">
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Bell className="w-4 h-4" />
        </button>

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
            <span className="text-sm text-foreground hidden sm:block max-w-28 truncate">
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
              <a href="/perfil" className="flex items-center gap-2 w-full">
                <User className="w-4 h-4" />
                Meu Perfil
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer gap-2"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="w-4 h-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
