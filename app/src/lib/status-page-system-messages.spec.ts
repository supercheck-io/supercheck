import {
  formatSystemMessage,
  getSystemMessages,
} from "./status-page-system-messages";

describe("status page system messages", () => {
  it("generates English messages", () => {
    const messages = getSystemMessages("en");
    expect(
      formatSystemMessage(messages.autoOutageTitle, { component: "API" }),
    ).toBe("API is experiencing an outage");
    expect(messages.recoveryBody).toBe(
      "Monitoring confirms that service has recovered.",
    );
  });

  it.each([
    ["es", "La monitorización confirma que el servicio se ha recuperado."],
    ["de", "Die Überwachung bestätigt, dass der Dienst wiederhergestellt ist."],
    ["ja", "監視により、サービスが復旧したことを確認しました。"],
  ])("uses the page language (%s) for recovery updates", (language, body) => {
    expect(getSystemMessages(language).recoveryBody).toBe(body);
  });

  it("falls back to English for unknown languages", () => {
    expect(getSystemMessages("xx").autoOutageBody).toBe(
      "Monitoring detected an availability issue.",
    );
    expect(getSystemMessages("en-GB").maintenanceStartBody).toBe(
      "Scheduled maintenance is in progress.",
    );
  });

  it("interpolates every placeholder occurrence", () => {
    expect(
      formatSystemMessage("{name} / {name}", { name: "API" }),
    ).toBe("API / API");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(formatSystemMessage("Hello {missing}", {})).toBe("Hello {missing}");
  });
});
