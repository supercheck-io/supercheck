describe("status page support utilities", () => {
  describe("getStatusPageSupportContact", () => {
    it("normalizes plain email addresses to mailto links", async () => {
      const { getStatusPageSupportContact } = await import(
        "./status-page-support"
      );

      expect(getStatusPageSupportContact("support@example.com")).toEqual({
        kind: "email",
        href: "mailto:support@example.com",
        value: "support@example.com",
      });
    });

    it("preserves valid mailto links", async () => {
      const { getStatusPageSupportContact } = await import(
        "./status-page-support"
      );

      expect(
        getStatusPageSupportContact(
          "mailto:support@example.com?subject=Need%20help"
        )
      ).toEqual({
        kind: "email",
        href: "mailto:support@example.com?subject=Need%20help",
        value: "support@example.com",
      });
    });

    it("accepts http and https support websites", async () => {
      const { getStatusPageSupportContact } = await import(
        "./status-page-support"
      );

      expect(
        getStatusPageSupportContact("https://support.example.com/help")
      ).toEqual({
        kind: "url",
        href: "https://support.example.com/help",
        value: "https://support.example.com/help",
      });
    });

    it("rejects unsupported protocols and invalid values", async () => {
      const { getStatusPageSupportContact } = await import(
        "./status-page-support"
      );

      expect(getStatusPageSupportContact("javascript:alert(1)")).toBeNull();
      expect(getStatusPageSupportContact("ftp://support.example.com")).toBeNull();
      expect(getStatusPageSupportContact("not-a-contact")).toBeNull();
    });
  });

  describe("statusPageSupportContactSchema", () => {
    it("allows empty values, email addresses, and support websites", async () => {
      const { statusPageSupportContactSchema } = await import(
        "./status-page-support"
      );

      expect(statusPageSupportContactSchema.safeParse("").success).toBe(true);
      expect(
        statusPageSupportContactSchema.safeParse("support@example.com").success
      ).toBe(true);
      expect(
        statusPageSupportContactSchema.safeParse("https://support.example.com")
          .success
      ).toBe(true);
    });

    it("rejects invalid support contacts", async () => {
      const { statusPageSupportContactSchema } = await import(
        "./status-page-support"
      );

      expect(
        statusPageSupportContactSchema.safeParse("javascript:alert(1)").success
      ).toBe(false);
      expect(statusPageSupportContactSchema.safeParse("ftp://example.com").success).toBe(
        false
      );
    });
  });

  describe("normalizeStatusPageSupportContact", () => {
    it("returns null for empty values so support contacts can be cleared", async () => {
      const { normalizeStatusPageSupportContact } = await import(
        "./status-page-support"
      );

      expect(normalizeStatusPageSupportContact("")).toBeNull();
      expect(normalizeStatusPageSupportContact("   ")).toBeNull();
    });
  });

  describe("getStatusPageSupportContactInputValue", () => {
    it("formats stored mailto links as plain email addresses for forms", async () => {
      const { getStatusPageSupportContactInputValue } = await import(
        "./status-page-support"
      );

      expect(
        getStatusPageSupportContactInputValue(
          "mailto:support@example.com?subject=Need%20help"
        )
      ).toBe("support@example.com");
    });

    it("preserves https urls for form display", async () => {
      const { getStatusPageSupportContactInputValue } = await import(
        "./status-page-support"
      );

      expect(
        getStatusPageSupportContactInputValue(
          "https://support.example.com/help"
        )
      ).toBe("https://support.example.com/help");
    });
  });

  describe("getStatusPageSupportCtaLabel", () => {
    it("returns localized labels when available and falls back to English", async () => {
      const { getStatusPageSupportCtaLabel } = await import(
        "./status-page-support"
      );

      expect(getStatusPageSupportCtaLabel("hr")).toBe("Javite nam se");
      expect(getStatusPageSupportCtaLabel("pt-BR")).toBe(
        "Entrar em contato"
      );
      expect(getStatusPageSupportCtaLabel("xx")).toBe("Get in touch");
    });
  });
});
