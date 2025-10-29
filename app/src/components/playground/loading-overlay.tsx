"use client";
import { Skeleton } from "@/components/ui/skeleton";

interface LoadingOverlayProps {
  isVisible: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-start overflow-hidden">
      <div className="w-full max-w-full p-4 h-full overflow-hidden">
        {/* Header area skeleton - match the exact layout of the actual header */}
        <div className="flex justify-between items-center mb-4">
          <Skeleton className="h-10 w-48" />
          <div className="flex space-x-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
        
        {/* Main content with exact dimensions to match the real content */}
        <div className="h-[calc(100vh-10rem)]">
          <div className="hidden h-full flex-col flex-1 md:flex">
            <div className="flex h-full">
              {/* Left panel - Editor */}
              <div className="w-[70%] h-full flex flex-col border rounded-tl-lg rounded-bl-lg">
                <div className="flex items-center justify-between border-b bg-muted px-4 py-2 rounded-tl-lg">
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                  <Skeleton className="h-9 w-28" />
                </div>
                <div className="flex-1 overflow-hidden rounded-bl-lg">
                  <div className="p-4 space-y-2 h-full overflow-hidden">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-4/6" />
                    <div className="h-4"></div>
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-3/5" />
                  </div>
                </div>
              </div>
              
              {/* Resize handle */}
              <div className="w-[10px] h-full bg-border flex items-center justify-center">
                <div className="w-1 h-8 rounded-full bg-muted-foreground/20"></div>
              </div>
              
              {/* Right panel - Test details */}
              <div className="w-[calc(30%-10px)] h-full flex flex-col border rounded-tr-lg rounded-br-lg">
                <div className="flex items-center justify-between border-b bg-muted px-4 py-2 rounded-tr-lg">
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                </div>
                <div className="flex-1 overflow-hidden p-4 space-y-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
