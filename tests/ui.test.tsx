import { readFileSync } from "node:fs";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { mergeSettings, type DiagnosticKind, type UseMyCurrentAccountSettings } from "../src/lib/settings";
import { PopupPanel } from "../src/ui/PopupPanel";
import { buildUsageStats, SettingsEditor } from "../src/ui/SettingsEditor";

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;
const removedProfileLabel = ["Detected", "profile", "email"].join(" ");

let mountedRoot: Root | undefined;

afterEach(async () => {
  vi.useRealTimers();
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.innerHTML = "";
});

describe("extension UI surfaces", () => {
  test("popup keeps daily controls compact and hides advanced details", async () => {
    await render(
      <PopupPanel
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={async () => undefined}
        onOpenSettings={vi.fn()}
      />
    );

    const text = pageText();
    expect(text).toContain("Account to auto select");
    expect(text).toContain("Full settings");
    expect(text).not.toContain("Apply");
    expect(text).not.toContain(removedProfileLabel);
    expect(text).not.toContain("Diagnostics");
    expect(text).not.toContain("URL rewrite");
    expect(text).not.toContain("Aliases");
    expect(text).not.toContain("Mode details");
    expect(text).not.toContain("cleanest way to skip the picker");
    expect(text).not.toContain("Use another account");
  });

  test("popup saves valid account changes automatically", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    await render(
      <PopupPanel
        settings={settingsWith({ enabled: true })}
        onSave={onSave}
        onOpenSettings={vi.fn()}
      />
    );

    const accountInput = getAccountInput();
    await act(async () => {
      setInputValue(accountInput, "USER@EXAMPLE.COM");
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      preferredUpn: "user@example.com"
    }));
  });

  test("popup waits for a valid account before auto-saving ON state", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    await render(
      <PopupPanel
        settings={settingsWith({ enabled: true })}
        onSave={onSave}
        onOpenSettings={vi.fn()}
      />
    );

    const accountInput = getAccountInput();
    await act(async () => {
      setInputValue(accountInput, "not an account");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(pageText()).toContain("saves automatically once valid");
  });

  test("settings page includes advanced behavior controls and diagnostics", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          diagnostics: [
            diagnostic("autoPickedAccount", "Matched configured account.", 1)
          ]
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    const text = pageText();
    expect(text).toContain("Account to auto select");
    expect(text).toContain("Aliases");
    expect(text).toContain("URL rewrite");
    expect(text).toContain("Auto-pick account");
    expect(text).toContain("Suppress select account prompt");
    expect(text).toContain("Mode details");
    expect(text).toContain("cleanest way to skip the picker");
    expect(text).toContain("does nothing on no match, multiple matches");
    expect(text).toContain("prompt=select_account");
    expect(text).toContain("prompt=login");
    expect(text).toContain("prompt=consent");
    expect(text).toContain("prompt=none");
    expect(text).toContain("Save settings");
    expect(text).toContain("Statistics");
    expect(text).toContain("Diagnostics data");
    expect(text).toContain("Matched configured account.");
    expect(text).not.toContain(removedProfileLabel);
    expect(text.indexOf("Save settings")).toBeLessThan(text.indexOf("Statistics"));
    expect(text.indexOf("Statistics")).toBeLessThan(text.indexOf("Diagnostics data"));
    expect(document.querySelector<HTMLDetailsElement>("details.mode-details")?.open).toBe(false);
  });

  test("statistics summarize local usage data", () => {
    const stats = buildUsageStats(settingsWith({
      aliases: ["alias.one@example.com", "alias.two@example.com"],
      diagnostics: [
        diagnostic("urlRewritten", "URL prepared.", 1),
        diagnostic("autoPickedAccount", "Picked.", 2),
        diagnostic("noMatchingAccount", "No match.", 3),
        diagnostic("disabled", "Disabled.", 4)
      ]
    }));
    const values = Object.fromEntries(stats.map((item) => [item.label, item.value]));

    expect(values).toMatchObject({
      "Total events": "4",
      "URL rewrites": "1",
      "Auto-picked": "1",
      "Picker misses": "1",
      "Skipped decisions": "1",
      "Picker success": "50%",
      "Aliases": "2",
      "Active controls": "4/4"
    });
  });

  test("diagnostics data is paginated", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          diagnostics: Array.from({ length: 12 }, (_, index) =>
            diagnostic("urlRewritten", `Diagnostic ${String(index + 1).padStart(2, "0")}`, index + 1)
          )
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    expect(pageText()).toContain("Showing 1-10 of 12");
    expect(pageText()).toContain("Diagnostic 01");
    expect(pageText()).toContain("Diagnostic 10");
    expect(pageText()).not.toContain("Diagnostic 11");

    await act(async () => getButton("Next").click());

    expect(pageText()).toContain("Showing 11-12 of 12");
    expect(pageText()).toContain("Diagnostic 11");
    expect(pageText()).toContain("Diagnostic 12");
    expect(pageText()).not.toContain("Diagnostic 01");
  });

  test("settings page source does not render the removed data section controls", () => {
    const source = readFileSync("src/settings/main.tsx", "utf8");
    expect(source).not.toContain("Export JSON");
    expect(source).not.toContain("Import JSON");
    expect(source).not.toContain("createResetSettings");
  });

  test("legacy detected profile email remains internal-only", async () => {
    await render(
      <PopupPanel
        settings={settingsWith({ detectedProfileEmail: "legacy@example.com" })}
        onSave={async () => undefined}
        onOpenSettings={vi.fn()}
      />
    );

    const text = pageText();
    const accountInput = document.querySelector<HTMLInputElement>("input[aria-label='Account to auto select']");
    expect(text).not.toContain("legacy@example.com");
    expect(accountInput?.value).toBe("");
  });
});

async function render(element: ReactElement) {
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Missing test root.");
  }
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(element));
}

function settingsWith(input: Partial<UseMyCurrentAccountSettings>) {
  return mergeSettings(input);
}

function pageText() {
  return document.body.textContent || "";
}

function getAccountInput() {
  const accountInput = document.querySelector<HTMLInputElement>("input[aria-label='Account to auto select']");
  if (!accountInput) {
    throw new Error("Account input was not rendered.");
  }
  return accountInput;
}

function getButton(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === label);
  if (!button) {
    throw new Error(`${label} button was not rendered.`);
  }
  return button;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function diagnostic(kind: DiagnosticKind, message: string, index: number) {
  return {
    id: `event-${index}`,
    kind,
    occurredAt: `2026-06-${String(Math.min(index, 28)).padStart(2, "0")}T10:00:00.000Z`,
    message
  };
}
