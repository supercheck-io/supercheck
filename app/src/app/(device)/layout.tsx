import { AuthFrame } from "@/components/auth/auth-shell";

/** Static consent shell: the URL carries a login code, so keep third-party widgets out. */
export default function DeviceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthFrame>{children}</AuthFrame>;
}
