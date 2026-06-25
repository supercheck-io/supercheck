import { decryptSecret, encryptSecret, maskSecret, type SecretEnvelope } from "@/lib/security/secret-crypto";

export type ConnectorCredentialPrimitive = string | number | boolean | null;
export type ConnectorCredentialValue = {
  [key: string]: ConnectorCredentialPrimitive | ConnectorCredentialValue;
};

export type ConnectorCredentialContext = {
  organizationId: string;
  connectorId: string;
  projectId?: string | null;
};

export type EncryptedConnectorCredential = {
  encryptedCredential: string;
  encryptionVersion: 1;
  encryptionKeyContext: string;
};

export function buildConnectorCredentialContext(context: ConnectorCredentialContext): string {
  return ["sre_connector", context.organizationId, context.projectId ?? "org", context.connectorId].join(":");
}

export function encryptConnectorCredential(
  credential: ConnectorCredentialValue,
  context: ConnectorCredentialContext
): EncryptedConnectorCredential {
  const encryptionKeyContext = buildConnectorCredentialContext(context);
  const envelope = encryptSecret(JSON.stringify(credential), { context: encryptionKeyContext });

  return {
    encryptedCredential: JSON.stringify(envelope),
    encryptionVersion: 1,
    encryptionKeyContext,
  };
}

export function decryptConnectorCredential<T extends ConnectorCredentialValue = ConnectorCredentialValue>(
  encryptedCredential: string,
  context: ConnectorCredentialContext
): T {
  const envelope = JSON.parse(encryptedCredential) as SecretEnvelope;
  const plaintext = decryptSecret(envelope, { context: buildConnectorCredentialContext(context) });
  return JSON.parse(plaintext) as T;
}

export function maskConnectorCredential(credential: ConnectorCredentialValue): ConnectorCredentialValue {
  return Object.fromEntries(
    Object.entries(credential).map(([key, value]) => {
      if (value && typeof value === "object") {
        return [key, maskConnectorCredential(value)];
      }

      if (typeof value === "string") {
        return [key, maskSecret(value)];
      }

      return [key, value];
    })
  );
}
