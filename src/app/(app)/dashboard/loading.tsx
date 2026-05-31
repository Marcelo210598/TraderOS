export default function Loading() {
  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="h-14 border-b border-border flex items-center px-6 shrink-0">
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex-1 p-4 lg:p-8 space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-6 w-48 bg-muted rounded animate-pulse" />
            <div className="h-3.5 w-36 bg-muted/60 rounded animate-pulse" />
          </div>
          <div className="h-9 w-28 bg-muted rounded-xl animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-20 bg-card border border-border rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 h-52 bg-card border border-border rounded-xl animate-pulse" />
          <div className="h-52 bg-card border border-border rounded-xl animate-pulse" />
        </div>
        <div className="h-40 bg-card border border-border rounded-xl animate-pulse" />
      </div>
    </div>
  )
}
