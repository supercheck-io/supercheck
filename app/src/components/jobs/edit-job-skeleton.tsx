import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function EditJobSkeleton() {
  return (
    <div className="">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
          <div>
            <CardTitle>Edit Job</CardTitle>
            <CardDescription className="mt-2">
              Update job details and manage associated tests
            </CardDescription>
          </div>
          <div className="flex space-x-2">
            <Skeleton className="h-9 w-20" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-6 w-40" />
              </div>
            </div>
          </div>

          {/* Selected Tests Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48 mt-1" />
              </div>
              <Skeleton className="h-9 w-28" />
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
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="grid grid-cols-4 gap-4 items-center">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-6 w-16 rounded-full" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end space-x-4 mt-6">
            <Skeleton className="h-10 w-16" />
            <Skeleton className="h-10 w-24" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 