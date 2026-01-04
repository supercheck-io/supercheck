import { Metadata } from "next/types";

export const metadata: Metadata = {
    title: "Requirements | Supercheck",
    description: "Manage product requirements and link them to tests",
};

export default function RequirementsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
