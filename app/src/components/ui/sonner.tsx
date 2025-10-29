"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"
import { Loader2 } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      closeButton={true}
      icons={{
        loading: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
      }}
      {...props}
    />
  )
}

export { Toaster }
