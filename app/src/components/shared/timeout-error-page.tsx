import Link from "next/link";
import { AlertCircle, Clock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TimeoutErrorInfo, getTimeoutErrorMessages } from "@/lib/timeout-utils";

interface TimeoutErrorPageProps {
  timeoutInfo: TimeoutErrorInfo;
  backToLabel?: string;
  backToUrl?: string;
  containerClassName?: string;
}

export function TimeoutErrorPage({
  timeoutInfo,
  backToLabel,
  backToUrl,
  containerClassName = "w-full h-full relative"
}: TimeoutErrorPageProps) {
  const errorMessages = getTimeoutErrorMessages(timeoutInfo);

  const getIconColor = () => {
    switch (timeoutInfo.timeoutType) {
      case 'test': return 'text-amber-500';
      case 'job': return 'text-orange-500';
      default: return 'text-red-500';
    }
  };

  const getBackgroundColor = () => {
    switch (timeoutInfo.timeoutType) {
      case 'test': return 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800';
      case 'job': return 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800';
      default: return 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800';
    }
  };

  return (
    <div className={containerClassName}>
      <div className="flex flex-col items-center justify-center w-full h-full p-8">
        <div className="flex flex-col items-center text-center max-w-2xl w-full">
          {/* Main Error Icon and Title */}
          <div className="flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 mb-6">
            <Clock className={`h-10 w-10 ${getIconColor()}`} />
          </div>
          
          <h1 className="text-3xl font-bold mb-3 text-foreground">
            {errorMessages.title}
          </h1>
          
          <p className="text-lg text-muted-foreground mb-6">
            {errorMessages.message}
          </p>

          {/* Suggestion Card */}
          <Card className={`w-full mb-6 ${getBackgroundColor()}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertCircle className="h-5 w-5" />
                What might be causing this?
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground mb-4">
                {errorMessages.suggestion}
              </p>
            </CardContent>
          </Card>

          {/* Timeout Details */}
          {/* {timeoutInfo.timeoutDurationMinutes > 0 && (
            <div className="text-xs text-muted-foreground mb-6 p-3 bg-muted rounded-md">
              <span className="font-mono">
                TIMEOUT: {timeoutInfo.timeoutDurationMinutes} MIN{timeoutInfo.timeoutDurationMinutes !== 1 ? 'S' : ''} 
              
              </span>
            </div>
          )} */}

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
          <p className="text-sm text-muted-foreground  max-w-md">
            {timeoutInfo.timeoutType === 'test' 
              ? "Test scripts that take longer than 2 minutes are automatically terminated."
              : timeoutInfo.timeoutType === 'job'
              ? "Job executions that take longer than 15 minutes are automatically terminated to prevent resource exhaustion."
              : "Long-running executions are automatically terminated to prevent resource exhaustion."
            }
          </p>
        </div>
      </div>
    </div>
  );
} 