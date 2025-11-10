import { ReactNode } from "react";

export const metadata = {
  title: "Observability | SuperCheck",
  description: "Distributed tracing, logs, and metrics for your tests and monitors",
};

export default function ObservabilityLayout({ children }: { children: ReactNode }) {
  return children;
}
