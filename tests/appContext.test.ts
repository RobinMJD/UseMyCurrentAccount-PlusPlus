import { describe, expect, test } from "vitest";
import { findMatchingAppExclusion, getAppContextFromUrl, sanitizeStoredDiagnosticUrl } from "../src/lib/appContext";
import { createAppExclusion } from "../src/lib/settings";

describe("app context extraction", () => {
  test("extracts OAuth app identifiers and redacts sensitive parameters", () => {
    const context = getAppContextFromUrl(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=APP-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcallback&state=secret&nonce=secret"
    );

    expect(context).toMatchObject({
      flow: "oauth",
      tenant: "common",
      clientId: "app-123",
      redirectHost: "portal.example.com",
      redirectPath: "/callback"
    });
    expect(context.sanitizedUrl).toContain("client_id=APP-123");
    expect(context.sanitizedUrl).toContain("redirect_host=portal.example.com");
    expect(context.sanitizedUrl).not.toContain("state=");
    expect(context.sanitizedUrl).not.toContain("nonce=");
  });

  test("extracts SAML and WS-Fed reply hosts", () => {
    expect(getAppContextFromUrl("https://login.microsoftonline.com/tenant/saml2?wreply=https%3A%2F%2Fsaml.example.com%2Facs")).toMatchObject({
      flow: "saml",
      tenant: "tenant",
      redirectHost: "saml.example.com",
      redirectPath: "/acs"
    });
    expect(getAppContextFromUrl("https://login.microsoftonline.com/tenant/wsfed?wtrealm=https%3A%2F%2Ffed.example.com%2F")).toMatchObject({
      flow: "wsfed",
      redirectHost: "fed.example.com"
    });
  });

  test("matches enabled exclusions by client ID and redirect host", () => {
    const context = getAppContextFromUrl(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcallback"
    );
    const clientExclusion = createAppExclusion("clientId", "APP-123")!;
    const hostExclusion = createAppExclusion("redirectHost", "other.example.com")!;

    expect(findMatchingAppExclusion(context, [clientExclusion])?.exclusion.id).toBe(clientExclusion.id);
    expect(findMatchingAppExclusion(context, [hostExclusion])).toBeUndefined();
    expect(findMatchingAppExclusion(context, [{ ...hostExclusion, value: "portal.example.com" }])?.value).toBe("portal.example.com");
  });

  test("sanitizes legacy diagnostic URLs for display", () => {
    const sanitized = sanitizeStoredDiagnosticUrl(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb&claims=secret"
    );
    expect(sanitized).toContain("client_id=app-123");
    expect(sanitized).toContain("redirect_host=portal.example.com");
    expect(sanitized).not.toContain("claims=");
  });
});
