import { Button } from "@/components/ui/button";

/** Error panel for list pages, so a failed load is not mistaken for an empty project. */
export function ListErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error?: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
      <h3 className="font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Please try again."}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** Shown when a list hit the API cap and older rows are not loaded (no pagination exists). */
export function ListCapNote({ count, cap }: { count: number; cap: number }) {
  if (count < cap) return null;
  return (
    <p className="px-2 pt-2 text-xs text-muted-foreground" role="status">
      Showing the latest {cap}. Older items are not loaded; search and filters only cover these.
    </p>
  );
}
