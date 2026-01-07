import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

export default function Loading() {
    return (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
            <SuperCheckLoading size="lg" message="Loading requirements..." />
        </div>
    );
}
