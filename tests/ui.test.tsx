import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { mergeSettings, type UseMyCurrentAccountSettings } from "../src/lib/settings";
import { PopupPanel } from "../src/ui/PopupPanel";
import { SettingsEditor } from "../src/ui/SettingsEditor";

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;
const removedProfileLabel = ["Detected", "profile", "email"].join(" ");

let mountedRoot: Root | undefined;

afterEach(async () => {
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
    expect(text).not.toContain(removedProfileLabel);
    expect(text).not.toContain("Diagnostics");
    expect(text).not.toContain("URL rewrite");
    expect(text).not.toContain("Aliases");
  });

  test("settings page includes advanced behavior controls and diagnostics", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          diagnostics: [
            {
              id: "event-1",
              kind: "autoPickedAccount",
              occurredAt: "2026-06-16T10:00:00.000Z",
              message: "Matched configured account."
            }
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
    expect(text).toContain("Diagnostics");
    expect(text).toContain("Matched configured account.");
    expect(text).not.toContain(removedProfileLabel);
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
