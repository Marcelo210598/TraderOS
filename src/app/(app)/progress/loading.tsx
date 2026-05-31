export default function Loading() {
  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="h-14 border-b border-border flex items-center px-6 shrink-0">
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex-1 p-4 lg:p-6 max-w-3xl mx-auto w-full space-y-5">
        <div className="h-32 bg-card border border-border rounded-xl animate-pulse" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
