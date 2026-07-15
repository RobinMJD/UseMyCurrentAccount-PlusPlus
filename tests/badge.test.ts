import { describe, expect, test } from "vitest";
import { getBadgeState } from "../src/lib/badge";
import { mergeSettings } from "../src/lib/settings";

describe("badge state", () => {
  test("shows ON in green only when enabled with a valid account", () => {
    const badge = getBadgeState(mergeSettings({ enabled: true, preferredUpn: "USER@EXAMPLE.COM" }));
    expect(badge).toMatchObject({
      text: "ON",
      color: "#16a34a",
      reason: "enabled",
      isOperational: true
    });
  });

  test("shows OFF in red when disabled", () => {
    const badge = getBadgeState(mergeSettings({ enabled: false, preferredUpn: "user@example.com" }));
    expect(badge).toMatchObject({
      text: "OFF",
      color: "#dc2626",
      reason: "disabled",
      isOperational: false
    });
    expect(badge.title).not.toContain("user@example.com");
  });

  test("shows OFF in red when account is missing", () => {
    const badge = getBadgeState(mergeSettings({ enabled: true }));
    expect(badge).toMatchObject({
      text: "OFF",
      color: "#dc2626",
      reason: "missingAccount",
      isOperational: false
    });
    expect(badge.title).toMatch(/set an account/i);
  });

  test("shows OFF when both automation mechanics are disabled", () => {
    const badge = getBadgeState(mergeSettings({
      enabled: true,
      preferredUpn: "user@example.com",
      rewriteEnabled: false,
      autoPickEnabled: false
    }));
    expect(badge).toMatchObject({
      text: "OFF",
      reason: "noAutomation",
      isOperational: false
    });
    expect(badge.title).toMatch(/rewriting and account auto-pick are disabled/i);
  });
});
