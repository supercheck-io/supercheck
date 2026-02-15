"use client";

import { useRouter } from "next/navigation";
import { useQuery, useIsRestoring } from "@tanstack/react-query";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { RequirementForm } from "@/components/requirements/requirement-form";
import { getRequirement } from "@/actions/requirements";
import { RequirementFormSkeleton } from "@/components/requirements/requirement-form-skeleton";
import React from "react";
import { REQUIREMENTS_PATH } from "@/lib/requirements/url";

export default function EditRequirementPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    // Unwrap params using React.use() as per Next.js 15+ patterns if applicable, or just await if it's a promise in server components.
    // In client components, params is a promise in newer Next.js versions.
    const resolvedParams = React.use(params);
    const id = resolvedParams.id;

    // Fetch requirement
    const isRestoring = useIsRestoring();
    const { data: requirement, isPending, isFetching } = useQuery({
        queryKey: ["requirement", id],
        queryFn: () => getRequirement(id),
        enabled: !!id,
        staleTime: 30_000,          // 30s - ensures fresh data when re-editing
        refetchOnWindowFocus: false,
        refetchOnMount: "always",   // Always refetch on page visit for latest data
        refetchOnReconnect: false,
    });
    const isLoading = isPending && isFetching && !isRestoring;

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
                    // Convert tag objects to comma-separated string for form
                    tags: Array.isArray(requirement.tags)
                        ? requirement.tags.map(t => t.name).join(", ")
                        : (requirement.tags ?? undefined),
                    externalId: requirement.externalId,
                    externalUrl: requirement.externalUrl,
                    externalProvider: requirement.externalProvider,
                }}
                onCancel={() => router.push(REQUIREMENTS_PATH)}
            />
        </div>
    );
}
