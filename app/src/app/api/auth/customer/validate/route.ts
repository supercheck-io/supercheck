import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/rbac/middleware";
import { getActiveOrganization } from "@/lib/session";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";

/**
 * POST /api/auth/customer/validate
 * Validate and fix Polar customer ID mismatch
 */
export async function POST() {
  try {
    await requireAuth();
    const activeOrg = await getActiveOrganization();

    if (!activeOrg) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Get organization details
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, activeOrg.id),
    });

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // If Polar is disabled, clear the customer ID
    if (!isPolarEnabled()) {
      if (org.polarCustomerId) {
        await db.update(organization)
          .set({ 
            polarCustomerId: null,
            subscriptionPlan: "unlimited",
            subscriptionStatus: "none",
            subscriptionId: null
          })
          .where(eq(organization.id, activeOrg.id));
        
        return NextResponse.json({
          message: "Polar disabled - cleared customer ID and set unlimited plan",
          action: "cleared"
        });
      }
      
      return NextResponse.json({
        message: "Polar already disabled - no action needed",
        action: "none"
      });
    }

    // If no customer ID, we're good
    if (!org.polarCustomerId) {
      return NextResponse.json({
        message: "No Polar customer ID stored - customer will be created on signup",
        action: "none"
      });
    }

    // Validate customer exists in Polar
    const config = getPolarConfig()!;
    const polarUrl = config.server === 'sandbox' 
      ? 'https://api.polar.sh' 
      : 'https://api.polar.sh';

    try {
      const response = await fetch(`${polarUrl}/v1/customers/${org.polarCustomerId}`, {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const customer = await response.json();
        return NextResponse.json({
          message: "Polar customer exists and is valid",
          action: "none",
          customer: {
            id: customer.id,
            email: customer.email,
            created_at: customer.created_at
          }
        });
      } else if (response.status === 404) {
        // Customer doesn't exist in Polar - clear the invalid ID
        await db.update(organization)
          .set({ 
            polarCustomerId: null,
            subscriptionPlan: "unlimited",
            subscriptionStatus: "none", 
            subscriptionId: null
          })
          .where(eq(organization.id, activeOrg.id));

        return NextResponse.json({
          message: "Invalid Polar customer ID cleared - customer will be recreated on next signup",
          action: "cleared",
          invalidCustomerId: org.polarCustomerId
        });
      } else {
        throw new Error(`Polar API error: ${response.status}`);
      }
    } catch (error) {
      console.error("Error validating Polar customer:", error);
      return NextResponse.json(
        { error: "Failed to validate Polar customer" },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error("Error in customer validation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
