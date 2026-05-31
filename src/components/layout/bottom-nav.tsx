"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, BookOpen, BarChart2, Shield, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

const leftItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/journal", icon: BookOpen, label: "Journal" },
]

const rightItems = [
  { href: "/analytics", icon: BarChart2, label: "Analytics" },
  { href: "/guardian", icon: Shield, label: "Guardian" },
]

export function BottomNav() {
  const pathname = usePathname()

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/")
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-sidebar border-t border-sidebar-border">
      <div className="flex items-center h-16 px-4 max-w-lg mx-auto">
        {leftItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2 transition-colors",
              isActive(item.href) ? "text-teal" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        ))}

        {/* FAB central — +Trade */}
        <div className="flex-1 flex items-center justify-center">
          <Link
            href="/journal/novo"
            className="w-12 h-12 rounded-full bg-teal flex items-center justify-center shadow-lg shadow-teal/30 -mt-6 hover:bg-teal/90 transition-colors active:scale-95"
          >
            <Plus className="w-6 h-6 text-white" />
          </Link>
        </div>

        {rightItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2 transition-colors",
              isActive(item.href) ? "text-teal" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
