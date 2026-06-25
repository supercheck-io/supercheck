import { assertReadOnlyConnector, type Connector, type ConnectorMetadata, type ConnectorType } from "./connector-base";

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    assertReadOnlyConnector(connector);

    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector already registered: ${connector.id}`);
    }

    this.connectors.set(connector.id, connector);
  }

  get(connectorId: string): Connector | undefined {
    return this.connectors.get(connectorId);
  }

  require(connectorId: string): Connector {
    const connector = this.get(connectorId);
    if (!connector) {
      throw new Error(`Connector not registered: ${connectorId}`);
    }

    return connector;
  }

  list(type?: ConnectorType): ConnectorMetadata[] {
    return Array.from(this.connectors.values())
      .filter((connector) => !type || connector.type === type)
      .map((connector) => connector.metadata());
  }
}

export const connectorRegistry = new ConnectorRegistry();
