import Link from "next/link";
import { AlertCircle, ArrowLeft, Eye, EyeOff, Loader2, Building2, CheckCircle2, Info, Mail, Shield, TriangleAlert, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SupercheckLogo } from "@/components/logo/supercheck-logo";

/**
 * Shared pieces for every sign-in, sign-up, invite, device and consent screen,
 * so they share one width, logo, heading size, callout style and footer.
 */

/** Page background and centering. Used by the route-group layouts. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      {children}
    </main>
  );
}

/** The card every auth screen sits in. `footer` renders below it (legal text). */
export function AuthCard({
  children,
  footer,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { footer?: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-4" {...props}>
      <Card className={cn("flex flex-col gap-6 rounded-xl p-6 shadow-sm sm:p-8", className)}>{children}</Card>
      {footer}
    </div>
  );
}

const STATUS_ICONS = {
  info: { Icon: Mail, tone: "bg-primary/10 text-primary" },
  success: { Icon: CheckCircle2, tone: "bg-success/10 text-success" },
  error: { Icon: AlertCircle, tone: "bg-failure/10 text-failure" },
} as const;

/** Logo, optional status icon, title and description. Always centred, always `h1`. */
export function AuthHeader({
  title,
  description,
  status,
  logoHref,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Icon circle for result screens (check your email, expired link, done). */
  status?: keyof typeof STATUS_ICONS;
  logoHref?: string;
}) {
  const logo = <SupercheckLogo className="size-10" aria-hidden="true" />;
  const StatusIcon = status ? STATUS_ICONS[status] : null;
  // One mark per screen: result screens show the status circle in place of the logo.
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {StatusIcon ? (
        <div className={cn("flex size-12 items-center justify-center rounded-full", StatusIcon.tone)}>
          <StatusIcon.Icon className="size-6" aria-hidden="true" />
        </div>
      ) : logoHref ? (
        <Link href={logoHref} aria-label="Supercheck">
          {logo}
        </Link>
      ) : (
        <>
          {logo}
          <span className="sr-only">Supercheck</span>
        </>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <div className="text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-4">{description}</div> : null}
    </div>
  );
}

const CALLOUT_ICONS: Record<"info" | "success" | "warning" | "error", LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
};

/** The one callout for errors, successes, warnings and notes on auth screens. */
export function AuthCallout({
  variant,
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant: keyof typeof CALLOUT_ICONS }) {
  const Icon = CALLOUT_ICONS[variant];
  return (
    <Alert
      variant={variant}
      // Errors interrupt; everything else is announced politely.
      role={variant === "error" ? "alert" : "status"}
      className={cn("px-4 py-3 [&>svg]:top-3.5 [&>svg+div]:translate-y-0", className)}
      {...props}
    >
      <Icon className="size-4" aria-hidden="true" />
      <div className="text-sm">{children}</div>
    </Alert>
  );
}

/** "Back to sign in" and similar. 44px tall on touch screens. */
export function AuthBackLink({ href, children = "Back to sign in", ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  return (
    <div className="text-center">
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-8"
        {...props}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {children}
      </Link>
    </div>
  );
}

/** Terms and privacy line, shown on cloud only (callers decide). */
export function AuthLegal({ action = "continuing" }: { action?: string }) {
  return (
    <p className="px-6 text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-foreground">
      By {action}, you agree to our{" "}
      <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
      <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
    </p>
  );
}

export function formatInviteRole(role: string | undefined | null): string {
  if (!role) return "Member";
  return role
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Organization and role the visitor was invited to: identical on sign-in, sign-up and the invite page. */
export function InviteBanner({
  organizationName,
  role,
  email,
  invitedBy,
}: {
  organizationName: string;
  role?: string;
  email?: string;
  invitedBy?: string;
}) {
  const rows: Array<{ Icon: LucideIcon; label: string; value: React.ReactNode }> = [
    { Icon: Building2, label: "Organization", value: organizationName },
    { Icon: Shield, label: "Role", value: <Badge variant="secondary">{formatInviteRole(role ?? "project_viewer")}</Badge> },
    ...(email ? [{ Icon: Mail, label: "Email", value: email }] : []),
    ...(invitedBy ? [{ Icon: User, label: "Invited by", value: invitedBy }] : []),
  ];
  return (
    <dl className="space-y-3 rounded-lg border bg-muted/30 p-4" data-testid="invite-banner">
      {rows.map(({ Icon, label, value }) => (
        <div key={label} className="flex items-start gap-3">
          <Icon className="mt-0.5 hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
          <dt className="w-24 shrink-0 sm:w-28 text-sm text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Loading state: same card, logo and spinner on every screen. */
export function AuthLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <AuthCard role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <SupercheckLogo className="size-10" aria-hidden="true" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>{label}</span>
        </div>
      </div>
    </AuthCard>
  );
}

/** Show/hide button inside a password input. The hit area is 40px wide, full field height. */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const Icon = shown ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
