import Link from "next/link";
import { XCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export interface CancellationErrorInfo {
  isCancelled: boolean;
  cancelledBy?: string;
  cancelledAt?: string;
}

interface CancellationErrorPageProps {
  cancellationInfo?: CancellationErrorInfo;
  backToLabel?: string;
  backToUrl?: string;
  containerClassName?: string;
  isK6?: boolean;
}

export function CancellationErrorPage({
  cancellationInfo,
  backToLabel,
  backToUrl,
  containerClassName = "w-full h-full relative",
  isK6 = false,
}: CancellationErrorPageProps) {
  const testType = isK6 ? "K6 load test" : "Playwright test";

  return (
    <div className={containerClassName}>
      <div className="flex flex-col items-center justify-center w-full h-full p-8">
        <div className="flex flex-col items-center text-center max-w-2xl w-full">
          {/* Main Error Icon and Title */}
          <div className="flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 mb-6">
            <XCircle className="h-10 w-10 text-orange-500" />
          </div>

          <h1 className="text-3xl font-bold mb-3 text-foreground">
            Execution Cancelled
          </h1>

          <p className="text-lg text-muted-foreground mb-6">
            This {testType} was cancelled before it could complete.
          </p>

          {/* Info Card */}
          <Card className="w-full mb-6 bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <XCircle className="h-5 w-5 text-orange-500" />
                What happened?
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">
                A user requested to cancel this execution. The test was stopped
                immediately and no results were generated. You can re-run the
                test when ready.
              </p>
            </CardContent>
          </Card>

          <Separator className="w-full mb-6" />

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            {backToUrl && (
              <Button
                asChild
                variant="outline"
                className="flex items-center gap-2"
                size="lg"
              >
                <Link href={backToUrl}>
                  <ArrowLeft className="h-4 w-4" />
                  {backToLabel || "Go Back"}
                </Link>
              </Button>
            )}
          </div>

          {/* Additional Help Text */}
          <p className="text-sm text-muted-foreground max-w-md mt-6">
            You can safely re-run this test at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
