import { CheckIcon } from "@/components/logo/supercheck-logo";

/** Static consent shell: the URL carries a login code, so keep third-party widgets out. */
export default function DeviceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <CheckIcon className="size-6" aria-hidden="true" />
        <span className="text-sm font-semibold">Supercheck</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-6 pt-2 sm:pb-14">{children}</main>
    </div>
  );
}
