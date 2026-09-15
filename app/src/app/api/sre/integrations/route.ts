import { NextResponse } from "next/server";

import {
  getSreIntegrationBindings,
  getSreIntegrationBindingSetupOptions,
} from "@/actions/sre-integration-bindings";
import { getSreConnectors, getSreConnectorSetupOptions } from "@/actions/sre-connectors";
import { requireSreApiPermissions } from "../_auth";

export async function GET() {
  const auth = await requireSreApiPermissions([
    { resource: "sre_connector", action: "view" },
    { resource: "notification", action: "view" },
  ]);

  if (!auth.success) {
    return auth.response;
  }

  const [
    connectorsResult,
    setupOptionsResult,
    bindingsResult,
    bindingSetupOptionsResult,
  ] = await Promise.all([
    getSreConnectors(),
    getSreConnectorSetupOptions(),
    getSreIntegrationBindings(),
    getSreIntegrationBindingSetupOptions(),
  ]);

  const success =
    connectorsResult.success &&
    setupOptionsResult.success &&
    bindingsResult.success &&
    bindingSetupOptionsResult.success;

  const error = connectorsResult.success
    ? setupOptionsResult.success
      ? bindingsResult.success
        ? bindingSetupOptionsResult.success
          ? null
          : bindingSetupOptionsResult.error
        : bindingsResult.error
      : setupOptionsResult.error
    : connectorsResult.error;

  return NextResponse.json(
    {
      success,
      error,
      connectors: connectorsResult.connectors,
      setupOptions: setupOptionsResult.options,
      bindings: bindingsResult.bindings,
      bindingSetupOptions: bindingSetupOptionsResult.options,
    },
    { status: success ? 200 : 403 }
  );
}
