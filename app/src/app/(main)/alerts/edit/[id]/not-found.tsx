import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
      <h2 className="text-2xl font-bold mb-4">Notification Provider Not Found</h2>
      <p className="text-muted-foreground mb-6">
        The notification provider you&apos;re looking for doesn&apos;t exist or has been deleted.
      </p>
      <Button asChild>
        <Link href="/alerts">Return to Alerts</Link>
      </Button>
    </div>
  );
} 