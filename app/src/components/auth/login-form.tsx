import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckIcon } from "@/components/logo/supercheck-logo"
import { Loader2, Info, Eye, EyeOff } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

interface LoginFormProps {
  className?: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  inviteData: InviteData | null;
  inviteToken: string | null;
  isFromNotification?: boolean;
}

export function LoginForm({
  className,
  onSubmit,
  isLoading,
  error,
  inviteData,
  inviteToken,
  isFromNotification = false,
}: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [passwordValue, setPasswordValue] = useState("")

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {isFromNotification && (
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="flex flex-col gap-2">
                <h3 className="font-medium text-foreground">
                  Organization Access Required
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  You&apos;re trying to access a notification link that requires organization membership. 
                  If you don&apos;t have an account or need access to this organization, please contact 
                  your administrator to request an invitation.
                </p>
                <p className="text-muted-foreground text-sm">
                  If you already have an account with access, please sign in below to continue.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={onSubmit}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <h1 className="text-2xl font-bold">Welcome back</h1>
                <p className="text-muted-foreground text-balance">
                  {inviteData 
                    ? `Sign in to join ${inviteData.organizationName} as ${inviteData.role}`
                    : 'Sign in to your account'
                  }
                </p>
              </div>
              <div className="grid gap-3">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="test@example.com"
                  defaultValue={inviteData?.email || ''}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link 
                    href="/forgot-password" 
                    className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input 
                    id="password" 
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={passwordValue}
                    onChange={(e) => setPasswordValue(e.target.value)}
                    required 
                    autoComplete="current-password"
                    className={passwordValue ? "pr-10" : ""}
                  />
                  {passwordValue && (
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign in
              </Button>
              <div className="text-center text-sm">
                {isFromNotification ? (
                  <span className="text-muted-foreground">
                    Need access? Contact your administrator for an organization invitation.
                  </span>
                ) : (
                  <>
                    Don&apos;t have an account?{" "}
                    <Link 
                      href={inviteToken ? `/sign-up?invite=${inviteToken}` : "/sign-up"} 
                      className="underline underline-offset-4"
                    >
                      Sign up
                    </Link>
                  </>
                )}
              </div>
            </div>
          </form>
          <div className="bg-muted relative hidden md:block">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-3">
                <CheckIcon className="h-10 w-10" />
                <div className="grid text-left text-sm leading-tight">
                  <span className="font-semibold text-lg">Supercheck</span>
                  <span className="text-muted-foreground">Automation & Monitoring for Modern Apps</span>
                </div>
              </div>                    
            </div>
          </div>
        </CardContent>
      </Card>
      {/* <div className="text-muted-foreground text-center text-xs text-balance">
        By continuing, you agree to our{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">Terms of Service</a>{" "}
        and{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">Privacy Policy</a>.
      </div> */}
    </div>
  )
}