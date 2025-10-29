import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign In | Supercheck",
  description: "Sign in to your Supercheck account",
}

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}