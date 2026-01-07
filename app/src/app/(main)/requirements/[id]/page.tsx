import { redirect } from "next/navigation";

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
    redirect(`/requirements?id=${id}`);
}
