export default function Loading() {
  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="h-14 border-b border-border flex items-center px-6 shrink-0">
        <div className="h-4 w-16 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex-1 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 bg-muted rounded animate-pulse" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 w-20 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-10 bg-card border border-border rounded-xl animate-pulse" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
