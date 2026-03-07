import { SupercheckLogo } from "@/components/logo/supercheck-logo";
import { cn } from "@/lib/utils";

type StatusPageBrandingProps = {
  poweredByLabel: string;
  className?: string;
};

export function StatusPageBranding({
  poweredByLabel,
  className,
}: StatusPageBrandingProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400",
        className
      )}
    >
      <span>{poweredByLabel}</span>
      <a
        href="https://supercheck.io"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Powered by Supercheck"
        className="inline-flex items-center gap-2 font-medium text-gray-700 transition-colors hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
      >
        <SupercheckLogo className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <span>Supercheck</span>
      </a>
    </div>
  );
}