import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

/**
 * Main Layout Loading
 *
 * Shows immediately when navigating to any page under (main) layout.
 * Matches the standard loading pattern used across the app.
 */
export default function Loading() {
    return (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
            <SuperCheckLoading size="lg" message="Loading the page..." />
        </div>
    );
}
