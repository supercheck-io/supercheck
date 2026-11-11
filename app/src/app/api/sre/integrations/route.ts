import { NextResponse } from "next/server";

import {
  getSreIntegrationBindings,
  getSreIntegrationBindingSetupOptions,
} from "@/lib/server-actions/sre-integration-bindings";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getSreConnectors, getSreConnectorSetupOptions } from "@/lib/server-actions/sre-connectors";
import { requireSreApiPermissions } from "../_auth";

const EMPTY_BINDING_OPTIONS = { notificationProviders: [], connectors: [], services: [] };

export async function GET() {
  // Connectors only need sre_connector:view; bindings are fetched when notification:view is also held.
  const auth = await requireSreApiPermissions([
    { resource: "sre_connector", action: "view" },
  ]);

  if (!auth.success) {
    return auth.response;
  }

  try {
    const { context } = auth;
    const canViewNotifications = checkPermissionWithContext("notification", "view", {
      userId: context.userId,
      organizationId: context.organizationId,
      orgPendingDeletion: context.orgPendingDeletion,
      project: context.project,
    });

    const [
      connectorsResult,
      setupOptionsResult,
      bindingsResult,
      bindingSetupOptionsResult,
    ] = await Promise.all([
      getSreConnectors(context),
      getSreConnectorSetupOptions(context),
      canViewNotifications
        ? getSreIntegrationBindings(context)
        : { success: true as const, bindings: [] },
      canViewNotifications
        ? getSreIntegrationBindingSetupOptions(context)
        : { success: true as const, options: EMPTY_BINDING_OPTIONS },
    ]);

    const error =
      [connectorsResult, setupOptionsResult, bindingsResult, bindingSetupOptionsResult].find(
        (result) => !result.success,
      ) ?? null;

    return NextResponse.json(
      {
        success: error === null,
        error: error && "error" in error ? error.error : null,
        connectors: connectorsResult.connectors,
        setupOptions: setupOptionsResult.options,
        bindings: bindingsResult.bindings,
        bindingSetupOptions: bindingSetupOptionsResult.options,
      },
      { status: error === null ? 200 : 500 },
    );
  } catch (error) {
    console.error("Error loading SRE integrations:", error);
    return NextResponse.json({ success: false, error: "Failed to load integrations" }, { status: 500 });
  }
}
