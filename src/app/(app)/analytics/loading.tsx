export default function Loading() {
  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="h-14 border-b border-border flex items-center px-6 shrink-0">
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex-1 p-4 lg:p-6 space-y-5 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-52 bg-card border border-border rounded-xl animate-pulse" />
        <div className="h-40 bg-card border border-border rounded-xl animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
