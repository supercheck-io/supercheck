import { NextResponse } from "next/server";

import {
  getSreIntegrationBindings,
  getSreIntegrationBindingSetupOptions,
} from "@/actions/sre-integration-bindings";
import { getSreConnectors, getSreConnectorSetupOptions } from "@/actions/sre-connectors";

export async function GET() {
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
