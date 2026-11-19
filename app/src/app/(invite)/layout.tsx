// Unlike (auth), no redirect for signed-in visitors: an invitee who is already signed in (or returns from social sign-in) must reach the invitation.
export default function InviteGroupLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center">{children}</div>;
}
