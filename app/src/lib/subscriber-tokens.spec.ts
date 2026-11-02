jest.mock("@/utils/db", () => ({ db: { update: jest.fn() } }));
import { db } from "@/utils/db";
import {
  encryptWebhookSecret,
  hashVerificationToken,
  isUnsubscribeTokenShape,
  resolveWebhookSecret,
  signUnsubscribeToken,
  unsubscribeTokenCondition,
  verifyUnsubscribeToken,
} from "./subscriber-tokens";

const A = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const B = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

describe("verification token hash", () => {
  it("is the SHA-256 hex digest", () => {
    expect(hashVerificationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("signed unsubscribe token", () => {
  it("verifies a valid token", () => {
    const token = signUnsubscribeToken(A);
    expect(verifyUnsubscribeToken(token)).toBe(A);
    expect(isUnsubscribeTokenShape(token)).toBe(true);
  });
  it("rejects a tampered signature", () => {
    const token = signUnsubscribeToken(A);
    const bad = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyUnsubscribeToken(bad)).toBeNull();
    expect(unsubscribeTokenCondition(bad)).toBeNull();
  });
  it("rejects a signature issued for another subscriber", () => {
    const sigOfB = signUnsubscribeToken(B).split(".")[1];
    expect(verifyUnsubscribeToken(`${A}.${sigOfB}`)).toBeNull();
  });
  it("rejects malformed values", () => {
    for (const v of ["", "x", `${A}.`, `${A}.short`, "not-a-uuid." + "a".repeat(43)]) {
      expect(verifyUnsubscribeToken(v)).toBeNull();
    }
  });
  it("still treats a legacy 64-hex token as a stored-token lookup", () => {
    const legacy = "a".repeat(64);
    expect(isUnsubscribeTokenShape(legacy)).toBe(true);
    expect(verifyUnsubscribeToken(legacy)).toBeNull();
    expect(unsubscribeTokenCondition(legacy)).not.toBeNull();
  });
  it("stops verifying once the key changes", () => {
    const token = signUnsubscribeToken(A);
    const prev = process.env.SECRET_ENCRYPTION_KEY;
    process.env.SECRET_ENCRYPTION_KEY = "another-secret-encryption-key-0123456789";
    try {
      expect(verifyUnsubscribeToken(token)).toBeNull();
    } finally {
      process.env.SECRET_ENCRYPTION_KEY = prev;
    }
  });
  it("fails loudly without a key", () => {
    const prev = process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.SECRET_ENCRYPTION_KEY;
    try {
      expect(() => signUnsubscribeToken(A)).toThrow(/SECRET_ENCRYPTION_KEY/);
      expect(() => encryptWebhookSecret("s")).toThrow(/SECRET_ENCRYPTION_KEY/);
    } finally {
      process.env.SECRET_ENCRYPTION_KEY = prev;
    }
  });
});

describe("resolveWebhookSecret", () => {
  const set = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    set.mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    (db.update as jest.Mock).mockReturnValue({ set });
  });
  it("decrypts the encrypted column without writing", async () => {
    const enc = encryptWebhookSecret("s3cret");
    expect(enc).not.toContain("s3cret");
    expect(await resolveWebhookSecret({ id: A, webhookSecret: null, webhookSecretEncrypted: enc })).toBe("s3cret");
    expect(db.update).not.toHaveBeenCalled();
  });
  it("encrypts and clears a legacy plaintext secret", async () => {
    expect(await resolveWebhookSecret({ id: A, webhookSecret: "legacy", webhookSecretEncrypted: null })).toBe("legacy");
    expect(set).toHaveBeenCalledWith({ webhookSecretEncrypted: expect.stringMatching(/^enc:v1:/), webhookSecret: null });
  });
  it("returns null when neither column is set", async () => {
    expect(await resolveWebhookSecret({ id: A, webhookSecret: null, webhookSecretEncrypted: null })).toBeNull();
  });
});
