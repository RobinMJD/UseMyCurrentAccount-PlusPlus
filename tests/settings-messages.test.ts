import { describe, expect, test, vi } from "vitest";
import { isTrustedRuntimeSender, validateUseMyCurrentAccountMessage } from "../src/lib/messages";
import { applyDetectedProfileEmailPrefill, DEFAULT_SETTINGS, mergeSettings } from "../src/lib/settings";

describe("settings validation", () => {
  test("sanitizes malformed UPNs and oversized diagnostics", () => {
    const settings = mergeSettings({
      preferredUpn: "not an email",
      detectedProfileEmail: "USER@EXAMPLE.COM",
      aliases: ["ok@example.com", "bad alias", "OK@example.com"],
      diagnostics: Array.from({ length: 80 }, (_, index) => ({
        id: `id-${index}`,
        kind: "autoPickedAccount",
        occurredAt: "2026-06-16T10:00:00.000Z",
        message: "x".repeat(500),
        url: "https://login.microsoftonline.com/" + "x".repeat(800)
      }))
    });
    expect(settings.preferredUpn).toBeUndefined();
    expect(settings.detectedProfileEmail).toBe("user@example.com");
    expect(settings.aliases).toEqual(["ok@example.com"]);
    expect(settings.diagnostics).toHaveLength(60);
    expect(settings.diagnostics[0].message).toHaveLength(220);
    expect(settings.diagnostics[0].url).toHaveLength(500);
    expect(settings.appExclusions).toEqual([]);
  });

  test("sanitizes and dedupes app exclusions", () => {
    const settings = mergeSettings({
      appExclusions: [
        {
          id: "one",
          enabled: true,
          matchType: "clientId",
          value: "APP-123",
          createdAt: "2026-06-16T10:00:00.000Z"
        },
        {
          id: "duplicate",
          enabled: false,
          matchType: "clientId",
          value: "app-123",
          createdAt: "2026-06-16T10:00:00.000Z"
        },
        {
          id: "host",
          enabled: true,
          matchType: "redirectHost",
          value: "https://Portal.Example.com/callback",
          createdAt: "not a date"
        },
        {
          id: "bad",
          enabled: true,
          matchType: "redirectHost",
          value: "localhost",
          createdAt: "2026-06-16T10:00:00.000Z"
        }
      ]
    });

    expect(settings.appExclusions).toHaveLength(2);
    expect(settings.appExclusions[0]).toMatchObject({
      enabled: true,
      matchType: "clientId",
      value: "app-123"
    });
    expect(settings.appExclusions[1]).toMatchObject({
      matchType: "redirectHost",
      value: "portal.example.com",
      createdAt: "1970-01-01T00:00:00.000Z"
    });

    const capped = mergeSettings({
      appExclusions: Array.from({ length: 35 }, (_, index) => ({
        id: `item-${index}`,
        enabled: true,
        matchType: "clientId",
        value: `app-${index}`,
        createdAt: "2026-06-16T10:00:00.000Z"
      }))
    });
    expect(capped.appExclusions).toHaveLength(30);
  });

  test("keeps defaults stable across missing stored settings", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ enabled: false, rewriteEnabled: false })).toMatchObject({
      enabled: false,
      rewriteEnabled: false,
      autoPickEnabled: true
    });
  });

  test("prefills an empty account from hidden profile identity", () => {
    const prefilled = applyDetectedProfileEmailPrefill(mergeSettings(undefined), "PROFILE@EXAMPLE.COM");
    expect(prefilled.detectedProfileEmail).toBe("profile@example.com");
    expect(prefilled.preferredUpn).toBe("profile@example.com");

    const preserved = applyDetectedProfileEmailPrefill(
      mergeSettings({ preferredUpn: "manual@example.com" }),
      "profile@example.com"
    );
    expect(preserved.detectedProfileEmail).toBe("profile@example.com");
    expect(preserved.preferredUpn).toBe("manual@example.com");
  });

  test("validates runtime messages", () => {
    const message = validateUseMyCurrentAccountMessage({
      action: "saveSettings",
      settings: { preferredUpn: "USER@EXAMPLE.COM" }
    });
    expect(message).toMatchObject({
      action: "saveSettings",
      settings: { preferredUpn: "user@example.com" }
    });
    expect(() => validateUseMyCurrentAccountMessage({ action: "surprise" })).toThrow(/Unsupported/);
    expect(() => validateUseMyCurrentAccountMessage({ action: "refreshProfileIdentity" })).toThrow(/Unsupported/);
  });

  test("preserves enriched diagnostic fields through message validation", () => {
    const message = validateUseMyCurrentAccountMessage({
      action: "recordPickerResult",
      diagnostic: {
        kind: "excludedApp",
        occurredAt: "2026-06-16T10:00:00.000Z",
        message: "Excluded.",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=secret",
        flow: "oauth",
        tenant: "common",
        clientId: "APP-123",
        redirectHost: "Portal.Example.com",
        redirectPath: "/callback",
        ruleId: 1000,
        changedParams: ["login_hint", "bad param !"],
        exclusionId: "exclusion-1",
        exclusionValue: "APP-123",
        pickerTileCount: 2,
        pickerMatchCount: 0
      }
    });

    expect(message).toMatchObject({
      action: "recordPickerResult",
      diagnostic: {
        kind: "excludedApp",
        flow: "oauth",
        clientId: "app-123",
        redirectHost: "portal.example.com",
        ruleId: 1000,
        changedParams: ["login_hint", "badparam"],
        pickerTileCount: 2,
        pickerMatchCount: 0
      }
    });
  });

  test("rejects untrusted runtime senders", () => {
    vi.stubGlobal("chrome", { runtime: { id: "extension-id" } });
    expect(isTrustedRuntimeSender({ id: "extension-id" })).toBe(true);
    expect(isTrustedRuntimeSender({ id: "other-extension" })).toBe(false);
    vi.unstubAllGlobals();
  });
});
