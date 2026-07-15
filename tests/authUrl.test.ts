import { describe, expect, test } from "vitest";
import { buildAuthUrlTransform, getPreferredDomain, shouldRewriteMicrosoftLoginUrl } from "../src/lib/authUrl";

const settings = {
  enabled: true,
  rewriteEnabled: true,
  preferredUpn: "admin.user@example.com",
  suppressSelectAccountPrompt: true
};

describe("auth URL rewriting", () => {
  test("adds login and domain hints when missing", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&state=keep",
      settings
    );
    expect(result.shouldRedirect).toBe(true);
    const url = new URL(result.redirectUrl!);
    expect(url.searchParams.get("login_hint")).toBe("admin.user@example.com");
    expect(url.searchParams.get("domain_hint")).toBe("example.com");
    expect(url.searchParams.get("state")).toBe("keep");
  });

  test("replaces wrong login hint", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?login_hint=wrong@example.com",
      settings
    );
    expect(new URL(result.redirectUrl!).searchParams.get("login_hint")).toBe(settings.preferredUpn);
  });

  test("canonicalizes repeated login and domain hints", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&login_hint=admin.user%40example.com&login_hint=other%40example.com&domain_hint=example.com&domain_hint=other.example",
      settings
    );

    expect(result.shouldRedirect).toBe(true);
    const url = new URL(result.redirectUrl!);
    expect(url.searchParams.getAll("login_hint")).toEqual(["admin.user@example.com"]);
    expect(url.searchParams.getAll("domain_hint")).toEqual(["example.com"]);
    expect(url.searchParams.get("client_id")).toBe("abc");
  });

  test("adds whr for saml and wsfed URLs", () => {
    const saml = buildAuthUrlTransform("https://login.microsoftonline.com/common/saml2?SAMLRequest=abc", settings);
    const wsfed = buildAuthUrlTransform("https://login.microsoftonline.com/common/wsfed?wa=wsignin1.0", settings);
    expect(new URL(saml.redirectUrl!).searchParams.get("whr")).toBe("example.com");
    expect(new URL(wsfed.redirectUrl!).searchParams.get("whr")).toBe("example.com");
  });

  test("removes only select account prompt", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&nonce=n",
      settings
    );
    const url = new URL(result.redirectUrl!);
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.get("nonce")).toBe("n");

    const login = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=login",
      settings
    );
    expect(new URL(login.redirectUrl!).searchParams.get("prompt")).toBe("login");

    const mixed = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=login%20select_account",
      settings
    );
    expect(new URL(mixed.redirectUrl!).searchParams.get("prompt")).toBe("login select_account");
    expect(mixed.changedParams).not.toContain("prompt");

    const repeated = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&prompt=login",
      settings
    );
    expect(new URL(repeated.redirectUrl!).searchParams.getAll("prompt")).toEqual(["login"]);
    expect(repeated.changedParams).toContain("prompt");
  });

  test("preserves fragments and security-sensitive parameters", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&scope=openid&code_challenge=xyz&claims=claim#frag",
      settings
    );
    const url = new URL(result.redirectUrl!);
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("scope")).toBe("openid");
    expect(url.searchParams.get("code_challenge")).toBe("xyz");
    expect(url.searchParams.get("claims")).toBe("claim");
    expect(url.hash).toBe("#frag");
  });

  test("skips rewrite when disabled or missing preferred account", () => {
    expect(buildAuthUrlTransform("https://login.microsoftonline.com/common/oauth2/v2.0/authorize", { ...settings, enabled: false }).shouldRedirect).toBe(false);
    expect(buildAuthUrlTransform("https://login.microsoftonline.com/common/oauth2/v2.0/authorize", { ...settings, preferredUpn: undefined }).shouldRedirect).toBe(false);
  });

  test("skips rewrite for excluded apps", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb",
      {
        ...settings,
        appExclusions: [
          {
            id: "exclusion-1",
            enabled: true,
            matchType: "clientId",
            value: "app-123",
            createdAt: "2026-06-16T10:00:00.000Z"
          }
        ]
      }
    );

    expect(result.shouldRedirect).toBe(false);
    expect(result.skippedReason).toBe("excludedApp");
    expect(result.exclusionMatch?.value).toBe("app-123");
  });

  test("skips rewrite for unapproved apps in approved-only mode", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb",
      {
        ...settings,
        requireAppApproval: true,
        appApprovals: []
      }
    );

    expect(result.shouldRedirect).toBe(false);
    expect(result.skippedReason).toBe("approvalRequired");
    expect(result.appContext?.clientId).toBe("app-123");
    expect(result.appContext?.redirectHost).toBe("portal.example.com");
  });

  test("rewrites approved apps in approved-only mode", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb",
      {
        ...settings,
        requireAppApproval: true,
        appApprovals: [
          {
            id: "approval-1",
            enabled: true,
            matchType: "clientId",
            value: "app-123",
            createdAt: "2026-06-16T10:00:00.000Z"
          }
        ]
      }
    );

    expect(result.shouldRedirect).toBe(true);
    expect(result.approvalMatch?.value).toBe("app-123");
    expect(new URL(result.redirectUrl!).searchParams.get("login_hint")).toBe(settings.preferredUpn);
  });

  test("classifies supported Microsoft login URLs", () => {
    expect(shouldRewriteMicrosoftLoginUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")).toBe(true);
    expect(shouldRewriteMicrosoftLoginUrl("https://login.microsoftonline.com/common/saml2")).toBe(true);
    expect(shouldRewriteMicrosoftLoginUrl("https://example.com/common/oauth2/v2.0/authorize")).toBe(false);
    expect(getPreferredDomain(settings.preferredUpn)).toBe("example.com");
  });
});
