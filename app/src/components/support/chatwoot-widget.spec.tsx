import { render } from "@testing-library/react";
import { ChatwootWidget, resetChatwootSession } from "./chatwoot-widget";

jest.mock("next/script", () => ({
  __esModule: true,
  default: () => null,
}));

function makeChatwoot() {
  return {
    setUser: jest.fn(),
    setCustomAttributes: jest.fn(),
    toggle: jest.fn(),
    reset: jest.fn(),
    toggleBubbleVisibility: jest.fn(),
    hasLoaded: false,
    resetTriggered: false,
    identifier: "previous-user",
    user: { email: "previous@example.com" },
  };
}

const baseProps = {
  websiteToken: "tok",
  baseUrl: "https://app.chatwoot.com",
  user: { id: "u1", email: "a@b.co", name: "A", identityValidationToken: "hash" },
  customAttributes: { source: "supercheck-app", skip: undefined },
};

describe("ChatwootWidget", () => {
  afterEach(() => {
    delete window.$chatwoot;
  });

  it("identifies once on chatwoot:ready, with identifier_hash, and not on re-render", () => {
    const cw = makeChatwoot();
    window.$chatwoot = cw;
    const { rerender } = render(<ChatwootWidget {...baseProps} />);

    expect(cw.setUser).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("chatwoot:ready"));
    expect(cw.setUser).toHaveBeenCalledWith("u1", {
      email: "a@b.co",
      name: "A",
      avatar_url: undefined,
      identifier_hash: "hash",
    });
    expect(cw.setCustomAttributes).toHaveBeenCalledWith({ source: "supercheck-app" });

    // New object literals with identical content must not re-identify
    rerender(<ChatwootWidget {...baseProps} user={{ ...baseProps.user }} />);
    window.dispatchEvent(new Event("chatwoot:ready"));
    expect(cw.setUser).toHaveBeenCalledTimes(1);
  });

  it("omits identifier_hash when no token is available", () => {
    const cw = makeChatwoot();
    window.$chatwoot = cw;
    render(
      <ChatwootWidget
        {...baseProps}
        user={{ ...baseProps.user, identityValidationToken: null }}
      />
    );
    window.dispatchEvent(new Event("chatwoot:ready"));
    expect(cw.setUser.mock.calls[0][1]).not.toHaveProperty("identifier_hash");
  });

  it("hides the bubble on unmount without resetting the contact session", () => {
    const cw = makeChatwoot();
    cw.hasLoaded = true;
    window.$chatwoot = cw;
    const { unmount } = render(<ChatwootWidget {...baseProps} />);
    unmount();
    expect(cw.reset).not.toHaveBeenCalled();
    expect(cw.toggle).toHaveBeenCalledWith("close");
    expect(cw.toggleBubbleVisibility).toHaveBeenCalledWith("hide");
  });

  it("hides a still-loading widget without touching bubble DOM that does not exist yet", () => {
    const cw = makeChatwoot();
    window.$chatwoot = cw;
    cw.toggleBubbleVisibility.mockImplementation(() => { throw new Error("Bubble not created"); });
    const { unmount } = render(<ChatwootWidget {...baseProps} />);
    expect(unmount).not.toThrow();
    expect(cw.toggleBubbleVisibility).not.toHaveBeenCalled();
    expect(window.$chatwoot.hideMessageBubble).toBe(true);
  });

  it("waits for chatwoot:ready after resetChatwootSession before identifying again", () => {
    const cw = makeChatwoot();
    cw.hasLoaded = true;
    cw.reset.mockImplementation(() => { cw.resetTriggered = true; });
    window.$chatwoot = cw;
    resetChatwootSession();
    expect(cw.reset).toHaveBeenCalledTimes(1);
    expect(cw.hasLoaded).toBe(false);
    expect(cw.resetTriggered).toBe(false);
    expect(cw).not.toHaveProperty("user");
    expect(cw).not.toHaveProperty("identifier");

    render(<ChatwootWidget {...baseProps} />);
    expect(cw.setUser).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("chatwoot:ready"));
    expect(cw.setUser).toHaveBeenCalledTimes(1);
  });

  it("identifies on remount when the reset completed while the widget was absent", () => {
    const cw = makeChatwoot();
    window.$chatwoot = cw;
    resetChatwootSession();
    cw.hasLoaded = true;
    window.dispatchEvent(new Event("chatwoot:ready"));

    render(<ChatwootWidget {...baseProps} />);
    expect(cw.setUser).toHaveBeenCalledTimes(1);
  });

  it("starts the bubble hidden until the user is identified", () => {
    window.$chatwoot = makeChatwoot();
    render(<ChatwootWidget {...baseProps} />);
    expect(window.chatwootSettings?.hideMessageBubble).toBe(true);
  });

  it("renders nothing for an insecure base URL", () => {
    const { container } = render(
      <ChatwootWidget {...baseProps} baseUrl="http://evil.example.com" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
