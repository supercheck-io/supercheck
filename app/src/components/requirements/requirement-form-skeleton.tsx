import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RequirementFormSkeleton() {
    return (
        <div className="">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
                    <div>
                        <CardTitle>Edit Requirement</CardTitle>
                        <CardDescription className="mt-2">
                            Update requirement details
                        </CardDescription>
                    </div>
                    <div className="flex space-x-2">
                        <Skeleton className="h-9 w-20" />
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Top Section: 2 Columns */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
                        {/* Left Column: Title & Description */}
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-20" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-32 w-full" />
                                </div>
                            </div>
                        </div>

                        {/* Right Column: External Links */}
                        <div className="space-y-6">
                            <div className="space-y-4 p-4 border rounded-lg">
                                <div className="space-y-1">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-3 w-48" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-16" />
                                        <Skeleton className="h-10 w-full" />
                                    </div>
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-20" />
                                        <Skeleton className="h-10 w-full" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-12" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Test Selector Skeleton - Full Width */}
                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Skeleton className="h-6 w-32" />
                                <Skeleton className="h-4 w-48 mt-1" />
                            </div>
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-9 w-[300px]" /> {/* Tags skeleton */}
                                <Skeleton className="h-9 w-[140px]" /> {/* Priority skeleton */}
                                <Skeleton className="h-9 w-28" /> {/* Link button skeleton */}
                            </div>
                        </div>

                        {/* Test table skeleton */}
                        <div className="border rounded-lg">
                            <div className="p-4">
                                <div className="grid grid-cols-4 gap-4 pb-3 border-b">
                                    <Skeleton className="h-4 w-8" />
                                    <Skeleton className="h-4 w-12" />
                                    <Skeleton className="h-4 w-16" />
                                    <Skeleton className="h-4 w-20" />
                                </div>
                                <div className="space-y-3 pt-3">
                                    {[...Array(3)].map((_, i) => (
                                        <div key={i} className="grid grid-cols-4 gap-4 items-center">
                                            <Skeleton className="h-4 w-20" />
                                            <Skeleton className="h-4 w-16" />
                                            <Skeleton className="h-6 w-16 rounded-full" />
                                            <Skeleton className="h-4 w-48" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end space-x-4 pt-6 border-t">
                        <Skeleton className="h-10 w-20" />
                        <Skeleton className="h-10 w-32" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
