import { describe, expect, test, vi } from "vitest";
import { isTrustedRuntimeSender, validateUseMyCurrentAccountMessage } from "../src/lib/messages";
import {
  appendDiagnostic,
  applyProfileEmailPrefill,
  createDiagnostic,
  DEFAULT_SETTINGS,
  loadSettings,
  mergeSettings,
  migrateLegacySettings,
  prefillProfileEmailOnFreshInstall,
  SETTINGS_KEY,
  updateSettings
} from "../src/lib/settings";

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
    expect(settings).not.toHaveProperty("detectedProfileEmail");
    expect(settings.aliases).toEqual(["ok@example.com"]);
    expect(settings.diagnostics).toHaveLength(60);
    expect(settings.diagnostics[0].message).toHaveLength(220);
    expect(settings.diagnostics[0].url).toBeUndefined();
    expect(settings.diagnostics[0].sanitizedUrl).toHaveLength(500);
    expect(settings.appApprovals).toEqual([]);
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

  test("sanitizes and dedupes app approvals", () => {
    const settings = mergeSettings({
      requireAppApproval: true,
      appApprovals: [
        {
          id: "one",
          enabled: true,
          matchType: "clientId",
          value: "APP-123",
          createdAt: "2026-06-16T10:00:00.000Z"
        },
        {
          id: "duplicate",
          enabled: true,
          matchType: "clientId",
          value: "app-123",
          createdAt: "2026-06-16T10:00:00.000Z"
        },
        {
          id: "host",
          enabled: false,
          matchType: "redirectHost",
          value: "https://Portal.Example.com/callback",
          createdAt: "not a date"
        }
      ]
    });

    expect(settings.requireAppApproval).toBe(true);
    expect(settings.appApprovals).toHaveLength(2);
    expect(settings.appApprovals[0]).toMatchObject({
      enabled: true,
      matchType: "clientId",
      value: "app-123"
    });
    expect(settings.appApprovals[1]).toMatchObject({
      enabled: false,
      matchType: "redirectHost",
      value: "portal.example.com",
      createdAt: "1970-01-01T00:00:00.000Z"
    });
  });

  test("keeps defaults stable across missing stored settings", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ enabled: false, rewriteEnabled: false })).toMatchObject({
      enabled: false,
      rewriteEnabled: false,
      autoPickEnabled: true
    });
  });

  test("prefills an empty account once without retaining a hidden profile-email copy", () => {
    const prefilled = applyProfileEmailPrefill(mergeSettings(undefined), "PROFILE@EXAMPLE.COM");
    expect(prefilled.preferredUpn).toBe("profile@example.com");
    expect(prefilled).not.toHaveProperty("detectedProfileEmail");

    const preserved = applyProfileEmailPrefill(
      mergeSettings({ preferredUpn: "manual@example.com" }),
      "profile@example.com"
    );
    expect(preserved.preferredUpn).toBe("manual@example.com");

    const cleared = mergeSettings({ ...prefilled, preferredUpn: undefined });
    expect(mergeSettings(cleared).preferredUpn).toBeUndefined();
    expect(mergeSettings(cleared)).not.toHaveProperty("detectedProfileEmail");
  });

  test("migrates a legacy detected profile email out of local storage without resurrecting it", async () => {
    let stored: Record<string, unknown> = {
      ...mergeSettings({ enabled: false }),
      preferredUpn: undefined,
      detectedProfileEmail: "legacy@example.com"
    };
    const set = vi.fn(async (items: Record<string, unknown>) => {
      stored = structuredClone(items[SETTINGS_KEY]) as Record<string, unknown>;
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ [SETTINGS_KEY]: structuredClone(stored) })),
          set
        }
      }
    });

    const loaded = await loadSettings();

    expect(loaded.preferredUpn).toBeUndefined();
    expect(loaded).not.toHaveProperty("detectedProfileEmail");
    expect(set).not.toHaveBeenCalled();

    await Promise.all([
      migrateLegacySettings(),
      updateSettings({ enabled: true })
    ]);

    expect(set).toHaveBeenCalledTimes(2);
    expect(stored).not.toHaveProperty("detectedProfileEmail");
    expect(stored.preferredUpn).toBeUndefined();
    expect(stored.enabled).toBe(true);
    vi.unstubAllGlobals();
  });

  test("a late install prefill cannot overwrite a user-created clear record", async () => {
    let stored: Record<string, unknown> | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => stored ? { [SETTINGS_KEY]: structuredClone(stored) } : {}),
          set: vi.fn(async (items: Record<string, unknown>) => {
            stored = structuredClone(items[SETTINGS_KEY]) as Record<string, unknown>;
          })
        }
      }
    });

    await updateSettings({ enabled: false, preferredUpn: undefined });
    const afterLatePrefill = await prefillProfileEmailOnFreshInstall("profile@example.com");

    expect(afterLatePrefill.enabled).toBe(false);
    expect(afterLatePrefill.preferredUpn).toBeUndefined();
    expect(stored).not.toHaveProperty("detectedProfileEmail");
    vi.unstubAllGlobals();
  });

  test("clearing an installed prefill remains cleared through restart migration", async () => {
    let stored: Record<string, unknown> | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => stored ? { [SETTINGS_KEY]: structuredClone(stored) } : {}),
          set: vi.fn(async (items: Record<string, unknown>) => {
            stored = structuredClone(items[SETTINGS_KEY]) as Record<string, unknown>;
          })
        }
      }
    });

    expect((await prefillProfileEmailOnFreshInstall("profile@example.com")).preferredUpn)
      .toBe("profile@example.com");
    await updateSettings({ enabled: false, preferredUpn: undefined });
    const restarted = await migrateLegacySettings();

    expect(restarted.enabled).toBe(false);
    expect(restarted.preferredUpn).toBeUndefined();
    expect(stored).not.toHaveProperty("detectedProfileEmail");
    vi.unstubAllGlobals();
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
    if (message.action !== "saveSettings") {
      throw new Error("Expected settings update message.");
    }
    expect(message.settings).toEqual({ preferredUpn: "user@example.com" });
    expect(validateUseMyCurrentAccountMessage({
      action: "saveSettings",
      settings: {
        preferredUpn: "",
        diagnostics: [{ id: "stale" }],
        detectedProfileEmail: "attacker@example.com"
      }
    })).toEqual({ action: "saveSettings", settings: { preferredUpn: undefined } });
    expect(() => validateUseMyCurrentAccountMessage({ action: "saveSettings" })).toThrow(/malformed/);
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
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=APP-123&login_hint=user%40example.com&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcallback&state=secret&nonce=secret&claims=secret",
        preferredUpn: "user@example.com",
        matchedUpn: "user@example.com",
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
    expect(message.action).toBe("recordPickerResult");
    if (message.action !== "recordPickerResult") {
      throw new Error("Expected diagnostic message.");
    }
    expect(message.diagnostic.url).toBeUndefined();
    expect(message.diagnostic.sanitizedUrl).toContain("client_id=APP-123");
    expect(message.diagnostic.sanitizedUrl).toContain("redirect_host=portal.example.com");
    expect(message.diagnostic.sanitizedUrl).not.toContain("login_hint=");
    expect(message.diagnostic.sanitizedUrl).not.toContain("user%40example.com");
    expect(message.diagnostic.sanitizedUrl).not.toContain("state=");
    expect(message.diagnostic.sanitizedUrl).not.toContain("nonce=");
    expect(message.diagnostic.sanitizedUrl).not.toContain("claims=");
    expect(message.diagnostic.preferredUpn).toBeUndefined();
    expect(message.diagnostic.matchedUpn).toBeUndefined();
  });

  test("assigns unique diagnostic IDs even for identical events in the same millisecond", () => {
    const now = new Date("2026-07-15T10:11:12.123Z");
    const first = createDiagnostic("noMatchingAccount", { message: "No exact match." }, now);
    const second = createDiagnostic("noMatchingAccount", { message: "No exact match." }, now);

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^diag-20260715101112123-noMatchingAccount-/);
    expect(second.id).toMatch(/^diag-20260715101112123-noMatchingAccount-/);
  });

  test("rejects untrusted runtime senders", () => {
    vi.stubGlobal("chrome", { runtime: { id: "extension-id" } });
    expect(isTrustedRuntimeSender({ id: "extension-id" })).toBe(true);
    expect(isTrustedRuntimeSender({ id: "other-extension" })).toBe(false);
    vi.unstubAllGlobals();
  });

  test("serializes settings patches with diagnostics so concurrent updates cannot overwrite each other", async () => {
    let stored = mergeSettings({
      preferredUpn: "user@example.com",
      diagnostics: []
    });
    const get = vi.fn(async () => ({ [SETTINGS_KEY]: structuredClone(stored) }));
    const set = vi.fn(async (value: Record<string, unknown>) => {
      await Promise.resolve();
      stored = structuredClone(value[SETTINGS_KEY]) as typeof stored;
    });
    vi.stubGlobal("chrome", { storage: { local: { get, set } } });

    const diagnostic = createDiagnostic("noMatchingAccount", { message: "No exact account match." });
    await Promise.all([
      updateSettings({ enabled: false, aliases: ["ALIAS@example.com"] }),
      appendDiagnostic(diagnostic)
    ]);

    expect(stored.enabled).toBe(false);
    expect(stored.aliases).toEqual(["alias@example.com"]);
    expect(stored.diagnostics).toEqual([diagnostic]);
    expect(set).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
