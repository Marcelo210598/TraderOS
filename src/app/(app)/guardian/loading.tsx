export default function Loading() {
  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="h-14 border-b border-border flex items-center px-6 shrink-0">
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex-1 p-4 lg:p-6 max-w-3xl mx-auto w-full space-y-8">
        <div className="flex gap-2">
          <div className="h-8 w-28 bg-muted rounded-lg animate-pulse" />
          <div className="h-8 w-32 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="h-48 bg-card border border-border rounded-xl animate-pulse" />
        <div className="h-64 bg-card border border-border rounded-xl animate-pulse" />
        <div className="h-32 bg-card border border-border rounded-xl animate-pulse" />
      </div>
    </div>
  )
}
