"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ArrowRight, Check, Zap } from "lucide-react";
import Link from "next/link";

interface UpgradePromptProps {
  resource: string;
  currentPlan: string;
  limit: number;
  nextPlan?: {
    name: string;
    limit: number;
    price: number;
  };
  variant?: "inline" | "card";
  className?: string;
}

/**
 * UpgradePrompt Component
 *
 * Displays upgrade prompts when users hit plan limits.
 * Can be shown inline as an alert or as a standalone card.
 *
 * @example
 * ```tsx
 * <UpgradePrompt
 *   resource="monitors"
 *   currentPlan="Plus"
 *   limit={25}
 *   nextPlan={{ name: "Pro", limit: 100, price: 149 }}
 * />
 * ```
 */
export function UpgradePrompt({
  resource,
  currentPlan,
  limit,
  nextPlan,
  variant = "inline",
  className = "",
}: UpgradePromptProps) {
  if (variant === "card") {
    return (
      <Card className={`border-amber-200 bg-amber-50 dark:bg-amber-950 ${className}`}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600" />
            <CardTitle className="text-lg">Upgrade to Continue</CardTitle>
          </div>
          <CardDescription>
            You&apos;ve reached your {currentPlan} plan limit
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Your {currentPlan} plan includes {limit} {resource}. {nextPlan ? `Upgrade to ${nextPlan.name} for ${nextPlan.limit} ${resource}.` : "Upgrade to get more capacity."}
            </p>

            {nextPlan && (
              <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border mt-3">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-semibold">{nextPlan.name} Plan</p>
                    <p className="text-2xl font-bold">${nextPlan.price}<span className="text-sm font-normal text-muted-foreground">/month</span></p>
                  </div>
                  <Check className="h-8 w-8 text-green-600" />
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <span>{nextPlan.limit} {resource}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <span>Enhanced features & capacity</span>
                  </li>
                  {nextPlan.name === "Pro" && (
                    <>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-600" />
                        <span>Priority support</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-600" />
                        <span>SSO & custom domains</span>
                      </li>
                    </>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Link href="/billing" className="flex-1" prefetch={false}>
              <Button className="w-full">
                Upgrade Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/billing" prefetch={false}>
              <Button variant="outline">
                Compare Plans
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Inline variant
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Limit Reached</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-3">
          You&apos;ve reached your {currentPlan} plan limit of {limit} {resource}.
          {nextPlan && ` Upgrade to ${nextPlan.name} for ${nextPlan.limit} ${resource}.`}
        </p>
        <div className="flex gap-2">
          <Link href="/billing" prefetch={false}>
            <Button size="sm" variant="default">
              Upgrade Plan
            </Button>
          </Link>
          <Link href="/billing" prefetch={false}>
            <Button size="sm" variant="outline">
              View Details
            </Button>
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * QuickUpgradeButton Component
 *
 * A compact button for quick upgrade CTAs in constrained spaces.
 */
interface QuickUpgradeButtonProps {
  resource?: string;
  className?: string;
}

export function QuickUpgradeButton({ resource, className = "" }: QuickUpgradeButtonProps) {
  return (
    <Link href="/billing" prefetch={false}>
      <Button size="sm" variant="default" className={className}>
        <Zap className="mr-2 h-4 w-4" />
        Upgrade{resource ? ` for more ${resource}` : ""}
      </Button>
    </Link>
  );
}
