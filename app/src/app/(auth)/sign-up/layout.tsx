import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign Up | Supercheck",
  description: "Create your Supercheck account",
}

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}