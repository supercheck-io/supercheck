"use client";

import { useRouter } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { REQUIREMENTS_PATH } from "@/lib/requirements/url";

export default function CreateRequirementPage() {
    const router = useRouter();

    const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Requirements", href: "/requirements" },
        { label: "New Requirement", isCurrentPage: true },
    ];

    return (
        <div>
            <PageBreadcrumbs items={breadcrumbs} />
            <RequirementForm
                mode="create"
                onCancel={() => router.push(REQUIREMENTS_PATH)}
            />
        </div>
    );
}
