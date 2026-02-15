import { redirect } from "next/navigation";
import { getRequirementDetailsPath } from "@/lib/requirements/url";

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

/**
 * Redirect old detail page to new sheet-based view
 */
export default async function RequirementDetailPage({ params }: PageProps) {
    const { id } = await params;
    redirect(getRequirementDetailsPath(id));
}
