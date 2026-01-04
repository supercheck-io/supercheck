"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { getRequirement } from "@/actions/requirements";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirementFormSkeleton } from "@/components/requirements/requirement-form-skeleton";
import React from "react";

export default function EditRequirementPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    // Unwrap params using React.use() as per Next.js 15+ patterns if applicable, or just await if it's a promise in server components.
    // In client components, params is a promise in newer Next.js versions.
    const resolvedParams = React.use(params);
    const id = resolvedParams.id;

    // Fetch requirement
    const { data: requirement, isLoading } = useQuery({
        queryKey: ["requirement", id],
        queryFn: () => getRequirement(id),
        enabled: !!id,
    });

    const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Requirements", href: "/requirements" },
        { label: "Edit Requirement", isCurrentPage: true },
    ];

    if (isLoading) {
        return (
            <div>
                <PageBreadcrumbs items={breadcrumbs} />
                <RequirementFormSkeleton />
            </div>
        );
    }

    if (!requirement) {
        return <div>Requirement not found</div>;
    }

    return (
        <div>
            <PageBreadcrumbs items={breadcrumbs} />
            <RequirementForm
                mode="edit"
                defaultValues={{
                    id: requirement.id,
                    title: requirement.title,
                    description: requirement.description ?? undefined,
                    priority: requirement.priority ?? undefined,
                    tags: requirement.tags,
                    externalId: requirement.externalId,
                    externalUrl: requirement.externalUrl,
                    externalProvider: requirement.externalProvider,
                }}
                onSuccess={() => router.push("/requirements")}
                onCancel={() => router.push("/requirements")}
            />
        </div>
    );
}
