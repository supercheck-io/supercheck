import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isPolarEnabled, getPolarConfig } from '@/lib/feature-flags';

/**
 * POST /api/auth/sync-polar-customer
 * 
 * Ensures a Polar customer exists for the current user and syncs their data.
 * This is critical for social auth (GitHub/Google) signups where:
 * - The Polar customer may not have been created (if user already existed)
 * - The customer data (email, name) may be incomplete
 * 
 * This endpoint will:
 * 1. Try to find existing customer by externalId (user.id)
 * 2. If not found, try to find by email
 * 3. If still not found, CREATE a new customer
 * 4. Update the customer with correct email and name from OAuth profile
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    if (!isPolarEnabled()) {
      return NextResponse.json({
        success: true,
        message: 'Polar is not enabled - no sync needed'
      });
    }

    const config = getPolarConfig();
    if (!config) {
      return NextResponse.json({
        success: true,
        message: 'Polar config not available - no sync needed'
      });
    }

    const { Polar } = await import('@polar-sh/sdk');
    const polarClient = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });

    let customerId: string | null = null;
    let action: 'created' | 'updated' | 'linked' = 'updated';

    // Step 1: Try to find customer by externalId (user.id)
    try {
      const existingCustomer = await polarClient.customers.getExternal({
        externalId: user.id,
      });
      if (existingCustomer?.id) {
        customerId = existingCustomer.id;
        console.log(`[Polar] Found existing customer by externalId: ${customerId}`);
      }
    } catch {
      // Customer not found by externalId - this is expected for social auth
      console.log(`[Polar] No customer found by externalId for user ${user.id}`);
    }

    // Step 2: If not found by externalId, try to find by email
    if (!customerId) {
      try {
        const { result: customersByEmail } = await polarClient.customers.list({
          email: user.email,
        });
        const existingCustomer = customersByEmail.items[0];
        if (existingCustomer?.id) {
          customerId = existingCustomer.id;
          action = 'linked';
          console.log(`[Polar] Found existing customer by email: ${customerId}`);
          
          // Link this customer to the user by setting externalId
          await polarClient.customers.update({
            id: customerId,
            customerUpdate: {
              externalId: user.id,
              name: user.name || user.email,
            },
          });
          console.log(`[Polar] ✅ Linked customer ${customerId} to user ${user.id}`);
        }
      } catch (emailLookupError) {
        console.log(`[Polar] Could not lookup customer by email:`, emailLookupError instanceof Error ? emailLookupError.message : emailLookupError);
      }
    }

    // Step 3: If still not found, CREATE a new customer
    if (!customerId) {
      try {
        const newCustomer = await polarClient.customers.create({
          email: user.email,
          name: user.name || user.email,
          externalId: user.id,
          metadata: {
            userId: user.id,
            source: 'supercheck-sync',
          },
        });
        customerId = newCustomer.id;
        action = 'created';
        console.log(`[Polar] ✅ Created new customer ${customerId} for user ${user.id} (${user.email})`);
      } catch (createError) {
        console.error(`[Polar] Failed to create customer for user ${user.id}:`, createError instanceof Error ? createError.message : createError);
        return NextResponse.json({
          success: false,
          error: 'Failed to create Polar customer'
        }, { status: 500 });
      }
    }

    // Step 4: If we found existing customer by externalId, update with latest data
    if (action === 'updated' && customerId) {
      try {
        await polarClient.customers.updateExternal({
          externalId: user.id,
          customerUpdateExternalID: {
            email: user.email,
            name: user.name || user.email,
          },
        });
        console.log(`[Polar] ✅ Updated customer data for user ${user.id} (${user.email})`);
      } catch (updateError) {
        console.log(`[Polar] Could not update customer data:`, updateError instanceof Error ? updateError.message : updateError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Customer ${action} successfully`,
      customerId,
      action,
    });
  } catch (error) {
    console.error('[Polar] Error in sync-polar-customer:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to sync customer data' },
      { status: 500 }
    );
  }
}
