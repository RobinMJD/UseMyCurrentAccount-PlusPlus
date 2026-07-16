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

  test.each([
    "login_hint=app.user%40example.com",
    "Login_Hint=app.user%40example.com",
    "login%5Fhint=app.user%40example.com",
    "%6Cogin_hint=app.user%40example.com",
    "%6C%6F%67%69%6E%5F%68%69%6E%74=app.user%40example.com",
    "%20login_hint+=app.user%40example.com",
    "username=app.user%40example.com",
    "Domain_Hint=app.example.com"
  ])("preserves an application-provided account hint without rewriting: %s", (hint) => {
    const inputUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&${hint}&prompt=select_account&state=keep`;
    const result = buildAuthUrlTransform(inputUrl, settings);

    expect(result.shouldRedirect).toBe(false);
    expect(result.redirectUrl).toBeUndefined();
    expect(result.changedParams).toEqual([]);
    expect(result.skippedReason).toBe("existingAppHint");
  });

  test("does not confuse a nested redirect hint with a top-level application hint", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example%2Fcb%3Flogin_hint%3Dnested%40example.com&state=keep",
      settings
    );

    expect(result.shouldRedirect).toBe(true);
    const url = new URL(result.redirectUrl!);
    expect(url.searchParams.get("login_hint")).toBe(settings.preferredUpn);
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb?login_hint=nested@example.com");
  });

  test("fails closed for an unrelated encoded top-level query key", () => {
    const result = buildAuthUrlTransform(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&response%5Fmode=query&state=keep",
      settings
    );

    expect(result.shouldRedirect).toBe(false);
    expect(result.redirectUrl).toBeUndefined();
    expect(result.changedParams).toEqual([]);
    expect(result.skippedReason).toBe("encodedQueryKey");
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
