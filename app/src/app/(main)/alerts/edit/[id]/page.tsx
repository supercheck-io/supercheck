import { Metadata } from "next";
import { EditAlertWizard } from "@/components/alerts/edit-alert-wizard";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Edit Alert Settings | Supercheck",
  description: "Edit notification provider configuration",
};

async function fetchNotificationProvider(id: string) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notification-providers/${id}`, {
      cache: 'no-store'
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch notification provider: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error("Error fetching notification provider:", error);
    return null;
  }
}

export default async function EditAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = await fetchNotificationProvider(id);

  if (!provider) {
    notFound();
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Alerts", href: "/alerts" },
    { label: "Edit", href: `/alerts/edit/${id}` },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <EditAlertWizard providerId={id} initialData={provider} />
    </div>
  );
} 