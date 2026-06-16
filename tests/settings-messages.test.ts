import { describe, expect, test, vi } from "vitest";
import { isTrustedRuntimeSender, validateUseMyCurrentAccountMessage } from "../src/lib/messages";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/lib/settings";

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
  });

  test("keeps defaults stable across missing stored settings", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ enabled: false, rewriteEnabled: false })).toMatchObject({
      enabled: false,
      rewriteEnabled: false,
      autoPickEnabled: true
    });
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
  });

  test("rejects untrusted runtime senders", () => {
    vi.stubGlobal("chrome", { runtime: { id: "extension-id" } });
    expect(isTrustedRuntimeSender({ id: "extension-id" })).toBe(true);
    expect(isTrustedRuntimeSender({ id: "other-extension" })).toBe(false);
    vi.unstubAllGlobals();
  });
});
