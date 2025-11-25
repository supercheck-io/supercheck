"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CreditCard, 
  Calendar, 
  Zap, 
  Clock, 
  Users, 
  FolderOpen, 
  Monitor,
  FileText,
  ExternalLink,
  AlertCircle
} from "lucide-react";
import { authClient } from "@/utils/auth-client";
import { toast } from "sonner";

interface SubscriptionData {
  subscription: {
    plan: "plus" | "pro" | "unlimited";
    status: "active" | "canceled" | "past_due" | "none";
    subscriptionId?: string;
    polarCustomerId?: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  usage: {
    playwrightMinutes: { used: number; included: number; overage: number; percentage: number };
    k6VuHours: { used: number; included: number; overage: number; percentage: number };
  };
  limits: {
    monitors: { current: number; limit: number; remaining: number; percentage: number };
    statusPages: { current: number; limit: number; remaining: number; percentage: number };
    projects: { current: number; limit: number; remaining: number; percentage: number };
    teamMembers: { current: number; limit: number; remaining: number; percentage: number };
  };
  planFeatures: {
    customDomains: boolean;
    ssoEnabled: boolean;
    dataRetentionDays: number;
  };
}

const planDetails: Record<string, { name: string; color: string; description: string }> = {
  plus: { 
    name: "Plus", 
    color: "bg-blue-500", 
    description: "For growing teams with advanced monitoring needs" 
  },
  pro: { 
    name: "Pro", 
    color: "bg-purple-500", 
    description: "For enterprises with high-volume testing requirements" 
  },
  unlimited: { 
    name: "Unlimited", 
    color: "bg-green-500", 
    description: "Self-hosted with unlimited features" 
  },
};

export function SubscriptionTab() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    fetchSubscriptionData();
  }, []);

  const fetchSubscriptionData = async () => {
    try {
      const response = await fetch("/api/billing/current");
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error("Error fetching subscription data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      // Get customer state to get portal URL
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (authClient as any).customer.portal();
      // If portal returns a URL, open it in new tab
      if (result?.data?.url) {
        window.open(result.data.url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error("Error opening portal:", error);
      toast.error("Failed to open subscription portal");
    } finally {
      setOpeningPortal(false);
    }
  };

  if (loading) {
    return <SubscriptionTabSkeleton />;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-2">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Unable to load subscription data</p>
          <Button variant="outline" onClick={fetchSubscriptionData}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const plan = planDetails[data.subscription.plan] || planDetails.plus;
  const periodEnd = new Date(data.subscription.currentPeriodEnd);
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="space-y-6">
      {/* Plan Header Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <CardTitle className="text-2xl">{plan.name} Plan</CardTitle>
                <Badge className={`${plan.color} text-white`}>
                  {data.subscription.status}
                </Badge>
              </div>
              <CardDescription className="text-base">
                {plan.description}
              </CardDescription>
            </div>
            {data.subscription.plan !== "unlimited" && (
              <Button 
                variant="outline"
                onClick={handleManageSubscription}
                disabled={openingPortal}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                {openingPortal ? "Opening..." : "Manage Subscription"}
                <ExternalLink className="h-3 w-3 ml-2" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>{daysRemaining} days remaining</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Renews {periodEnd.toLocaleDateString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage and Features Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Usage Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usage This Period</CardTitle>
            <CardDescription>Resets on {periodEnd.toLocaleDateString()}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Playwright Execution Minutes
                </span>
                <span className="text-muted-foreground">
                  {data.usage.playwrightMinutes.used.toLocaleString()} / {data.usage.playwrightMinutes.included.toLocaleString()}
                </span>
              </div>
              <Progress value={Math.min(data.usage.playwrightMinutes.percentage, 100)} className="h-2" />
              {data.usage.playwrightMinutes.overage > 0 && (
                <p className="text-xs text-amber-500">
                  {data.usage.playwrightMinutes.overage.toLocaleString()} minutes overage
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium">
                  <Clock className="h-4 w-4 text-blue-500" />
                  K6 Virtual User Hours
                </span>
                <span className="text-muted-foreground">
                  {data.usage.k6VuHours.used.toLocaleString()} / {data.usage.k6VuHours.included.toLocaleString()}
                </span>
              </div>
              <Progress value={Math.min(data.usage.k6VuHours.percentage, 100)} className="h-2" />
              {data.usage.k6VuHours.overage > 0 && (
                <p className="text-xs text-amber-500">
                  {data.usage.k6VuHours.overage.toLocaleString()} VU hours overage
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Plan Features */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Plan Features</CardTitle>
            <CardDescription>Included in your {plan.name} plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Data Retention
              </span>
              <span className="font-medium">{data.planFeatures.dataRetentionDays} days</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                Custom Domains
              </span>
              <Badge variant={data.planFeatures.customDomains ? "default" : "secondary"}>
                {data.planFeatures.customDomains ? "Enabled" : "Not included"}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                SSO Authentication
              </span>
              <Badge variant={data.planFeatures.ssoEnabled ? "default" : "secondary"}>
                {data.planFeatures.ssoEnabled ? "Enabled" : "Not included"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resource Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Resource Limits</CardTitle>
          <CardDescription>Current usage across all resources</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <ResourceCard
              icon={Monitor}
              label="Monitors"
              current={data.limits.monitors.current}
              limit={data.limits.monitors.limit}
            />
            <ResourceCard
              icon={FileText}
              label="Status Pages"
              current={data.limits.statusPages.current}
              limit={data.limits.statusPages.limit}
            />
            <ResourceCard
              icon={FolderOpen}
              label="Projects"
              current={data.limits.projects.current}
              limit={data.limits.projects.limit}
            />
            <ResourceCard
              icon={Users}
              label="Team Members"
              current={data.limits.teamMembers.current}
              limit={data.limits.teamMembers.limit}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceCard({ 
  icon: Icon, 
  label, 
  current, 
  limit, 
}: { 
  icon: React.ElementType; 
  label: string; 
  current: number; 
  limit: number; 
}) {
  const percentage = limit > 0 ? (current / limit) * 100 : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${isAtLimit ? 'text-red-500' : isNearLimit ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">
        {current}
        <span className="text-sm font-normal text-muted-foreground ml-1">
          / {limit >= 999999 ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      <Progress 
        value={Math.min(percentage, 100)} 
        className={`h-1.5 mt-2 ${isAtLimit ? '[&>div]:bg-red-500' : isNearLimit ? '[&>div]:bg-amber-500' : ''}`}
      />
    </div>
  );
}

function SubscriptionTabSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48 mt-2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full mt-4" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48 mt-2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
