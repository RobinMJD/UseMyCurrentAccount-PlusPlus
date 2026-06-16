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

  test("classifies supported Microsoft login URLs", () => {
    expect(shouldRewriteMicrosoftLoginUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")).toBe(true);
    expect(shouldRewriteMicrosoftLoginUrl("https://login.microsoftonline.com/common/saml2")).toBe(true);
    expect(shouldRewriteMicrosoftLoginUrl("https://example.com/common/oauth2/v2.0/authorize")).toBe(false);
    expect(getPreferredDomain(settings.preferredUpn)).toBe("example.com");
  });
});
