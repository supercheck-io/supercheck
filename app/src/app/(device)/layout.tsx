import { CheckIcon } from "@/components/logo/supercheck-logo";

/**
 * Branded shell for the CLI consent pages. It is intentionally static: no session lookup,
 * no third-party widgets and no dashboard chrome, because the page URL carries a login code.
 */
export default function DeviceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-b from-background via-background to-muted/30">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-emerald-500/[0.03] blur-3xl" />
        <div className="absolute top-1/3 -left-32 h-[400px] w-[400px] rounded-full bg-emerald-500/[0.02] blur-3xl" />
      </div>
      <header className="relative border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex items-center gap-2 px-4 py-4">
          <CheckIcon className="h-7 w-7" />
          <span className="text-lg font-semibold">Supercheck</span>
        </div>
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 py-10">{children}</main>
      <footer className="relative border-t bg-muted/30">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Supercheck. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
