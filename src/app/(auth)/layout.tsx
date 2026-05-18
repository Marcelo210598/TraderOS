export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Grade de fundo estilo terminal */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.72 0.134 179) 1px, transparent 1px), linear-gradient(90deg, oklch(0.72 0.134 179) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Glow radial central */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-teal opacity-[0.04] blur-3xl" />
      </div>
      <div className="relative z-10 w-full max-w-md px-4">
        {children}
      </div>
    </div>
  )
}
