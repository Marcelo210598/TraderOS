"use client"

import { useEffect, useState } from "react"
import { Bell } from "lucide-react"
import { cn } from "@/lib/utils"

export function NotificationBell() {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => { if (typeof d.unreadCount === "number") setUnread(d.unreadCount) })
      .catch(() => {})
  }, [])

  return (
    <a
      href="/notificacoes"
      className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Notificações"
    >
      <Bell className="w-4 h-4" />
      {unread > 0 && (
        <span className={cn(
          "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-teal text-teal-foreground",
          "text-[9px] font-bold flex items-center justify-center px-0.5 leading-none"
        )}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </a>
  )
}
