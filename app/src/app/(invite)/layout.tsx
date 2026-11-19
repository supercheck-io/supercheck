import { AuthFrame } from "@/components/auth/auth-shell";

// Unlike (auth), no redirect for signed-in visitors: an invitee who is already signed in (or returns from social sign-in) must reach the invitation.
export default function InviteGroupLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
