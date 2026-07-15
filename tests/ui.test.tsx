import { readFileSync } from "node:fs";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  mergeSettings,
  type AppMatchType,
  type AppRule,
  type DiagnosticKind,
  type UseMyCurrentAccountSettings
} from "../src/lib/settings";
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
    expect(text).not.toContain("Overview");
    expect(text).not.toContain("Automation scope");
    expect(text).not.toContain("App approvals");
    expect(text).not.toContain("Included apps");
    expect(text).not.toContain("App exclusions");
    expect(text).not.toContain("Excluded apps");
    expect(text).not.toContain("Allow client ID");
    expect(text).not.toContain("Exclude client ID");
    expect(document.querySelector(".help-button")).toBeNull();
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
    expect(pageText()).toContain("invalid value has not been saved");
  });

  test("popup cannot turn on with an invalid account", async () => {
    const onSave = vi.fn(async () => undefined);
    await render(
      <PopupPanel
        settings={settingsWith({ enabled: false })}
        onSave={onSave}
        onOpenSettings={vi.fn()}
      />
    );

    await act(async () => setInputValue(getAccountInput(), "not an account"));
    const toggle = getButton("OFF");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-label")).toBe("Enter a valid account before turning on");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("popup directs users to Full settings when every automation behavior is disabled", async () => {
    await render(
      <PopupPanel
        settings={settingsWith({
          enabled: true,
          preferredUpn: "user@example.com",
          rewriteEnabled: false,
          autoPickEnabled: false
        })}
        onSave={async () => undefined}
        onOpenSettings={vi.fn()}
      />
    );

    const toggle = getButton("OFF");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-label")).toBe("Enable an automation behavior in Full settings");
    expect(pageText()).toContain("Enable URL rewriting or account auto-pick in Full settings.");
  });

  test("popup dispatches account clearing before it can be dismissed", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(async () => undefined);
    await render(
      <PopupPanel
        settings={settingsWith({ enabled: true, preferredUpn: "user@example.com" })}
        onSave={onSave}
        onOpenSettings={vi.fn()}
      />
    );

    await act(async () => setInputValue(getAccountInput(), ""));

    expect(onSave).toHaveBeenCalledWith({ enabled: false, preferredUpn: "" });
    expect(pageText()).toContain("OFF");
    expect(pageText()).toContain("Saved automatically.");

    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  });

  test("popup ignores stale save failures after a newer edit", async () => {
    vi.useFakeTimers();
    const pending: Array<Deferred<void>> = [];
    const onSave = vi.fn(() => {
      const request = deferred<void>();
      pending.push(request);
      return request.promise;
    });
    await render(
      <PopupPanel
        settings={settingsWith({ enabled: true, preferredUpn: "user@example.com" })}
        onSave={onSave}
        onOpenSettings={vi.fn()}
      />
    );

    await act(async () => setInputValue(getAccountInput(), "first@example.com"));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    await act(async () => setInputValue(getAccountInput(), "latest@example.com"));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending[0].reject(new Error("stale failure"));
      await Promise.resolve();
    });
    expect(pageText()).not.toContain("stale failure");
    expect(pageText()).toContain("Saving changes...");

    await act(async () => {
      pending[1].resolve();
      await Promise.resolve();
    });
    expect(pageText()).toContain("Saved automatically.");
  });

  test("settings page renders top tabs and overview summary", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          diagnostics: [
            {
              ...diagnostic("autoPickedAccount", "Matched configured account.", 1),
              flow: "oauth",
              tenant: "common",
              clientId: "app-123",
              redirectHost: "portal.example.com",
              redirectPath: "/callback",
              ruleId: 1,
              changedParams: ["login_hint", "domain_hint"],
              pickerTileCount: 2,
              pickerMatchCount: 1
            }
          ]
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    const text = pageText();
    expect(getTabs().map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Account",
      "Automation",
      "App rules",
      "Diagnostics",
      "About"
    ]);
    expect(activePanelText()).toContain("Overview");
    expect(activePanelText()).toContain("Automation scope");
    expect(activePanelText()).toContain("Included apps");
    expect(activePanelText()).toContain("Excluded apps");
    expect(activePanelText()).toContain("Recent diagnostics");
    expect(text).toContain("Save settings");
    expect(text).not.toContain("Mode details");
    expect(text).not.toContain(removedProfileLabel);
  });

  test("settings explains when every automation behavior is disabled", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          enabled: true,
          preferredUpn: "user@example.com",
          rewriteEnabled: false,
          autoPickEnabled: false
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    expect(document.querySelector(".save-hint")?.textContent).toBe("Enable an automation behavior");
    expect(pageText()).not.toContain("Account required");
  });

  test("account tab contains account controls only", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("Account").click());

    const panel = activePanelText();
    expect(panel).toContain("Account to auto select");
    expect(panel).toContain("Aliases");
    expect(panel).not.toContain("URL rewrite");
    expect(panel).not.toContain("Included apps");
    expect(panel).not.toContain("Diagnostics");
  });

  test("tabs use roving focus and arrow-key navigation", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    const overview = getTab("Overview");
    overview.focus();
    await act(async () => {
      overview.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(getTab("Account").getAttribute("aria-selected")).toBe("true");
    expect(getTab("Account").tabIndex).toBe(0);
    expect(overview.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(getTab("Account"));
    expect(activePanelText()).toContain("Account to auto select");
    expect(getTab("Account").getAttribute("aria-controls")).toBe("settings-panel");
    expect(document.getElementById("settings-panel")).not.toBeNull();

    await act(async () => {
      getTab("Account").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(getTab("About").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(getTab("About"));
  });

  test("automation scope selector maps to enabled and approval settings", async () => {
    const onSave = vi.fn(async () => undefined);
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={onSave}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("Automation").click());

    expect(activePanelText()).toContain("All Microsoft apps except exclusions");
    expect(activePanelText()).toContain("Approved apps only");

    await act(async () => getRadio("Approved apps only").click());
    await act(async () => getButton("Save settings").click());

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: true,
      requireAppApproval: true
    }));

    await act(async () => getRadio("Off").click());
    await act(async () => getButton("Save settings").click());

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      requireAppApproval: false
    }));
  });

  test("app rules tab separates included and excluded apps", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("App rules").click());

    const panel = activePanelText();
    expect(panel).toContain("Included apps");
    expect(panel).toContain("Excluded apps");
    expect(panel).toContain("Add included app");
    expect(panel).toContain("Add excluded app");
    expect(panel).toContain("No included apps configured.");
    expect(panel).toContain("No excluded apps configured.");
  });

  test("help popovers open and close from question buttons", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("Automation").click());
    await act(async () => getHelpButton("Help: Automation scope").click());

    expect(pageText()).toContain("The scope controls the broad allow policy.");
    expect(getHelpButton("Help: Automation scope").getAttribute("aria-expanded")).toBe("true");
    const tooltip = document.querySelector<HTMLElement>("[role='tooltip']");
    expect(tooltip).not.toBeNull();
    expect(getHelpButton("Help: Automation scope").getAttribute("aria-describedby")).toBe(tooltip?.id);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(pageText()).not.toContain("The scope controls the broad allow policy.");
  });

  test("disabled app rules can be re-enabled from diagnostics", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          appApprovals: [appRule("appr-disabled", "clientId", "app-123", false)],
          appExclusions: [appRule("excl-disabled", "redirectHost", "portal.example.com", false)],
          diagnostics: [{
            ...diagnostic("approvalRequired", "Approval needed.", 1),
            clientId: "app-123",
            redirectHost: "portal.example.com"
          }]
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    expect(getOverviewValue("Included apps")).toBe("0");
    expect(getOverviewValue("Excluded apps")).toBe("0");
    await act(async () => getTab("Diagnostics").click());
    expect(getButton("Enable client ID").disabled).toBe(false);
    expect(getButton("Enable host exclusion").disabled).toBe(false);

    await act(async () => getButton("Enable client ID").click());
    await act(async () => getButton("Enable host exclusion").click());
    expect(getButton("Client ID allowed").disabled).toBe(true);
    expect(getButton("Host excluded").disabled).toBe(true);
    expect(pageText()).toContain("Unsaved changes.");
  });

  test("diagnostics can add approvals without duplicating them", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          diagnostics: [
            {
              ...diagnostic("approvalRequired", "Approval needed.", 1),
              clientId: "app-123",
              redirectHost: "portal.example.com"
            }
          ]
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("Diagnostics").click());
    await act(async () => getButton("Allow client ID").click());

    expect(pageText()).toContain("app-123");
    expect(pageText()).toContain("Unsaved changes.");
    expect(getButton("Client ID allowed").disabled).toBe(true);

    await act(async () => getButton("Allow host").click());

    expect(pageText()).toContain("portal.example.com");
    expect(getButton("Host allowed").disabled).toBe(true);
  });

  test("diagnostics can add exclusions without duplicating them", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({
          preferredUpn: "user@example.com",
          diagnostics: [
            {
              ...diagnostic("noMatchingAccount", "No matching account.", 1),
              clientId: "app-123",
              redirectHost: "portal.example.com"
            }
          ]
        })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("Diagnostics").click());
    await act(async () => getButton("Exclude client ID").click());

    expect(pageText()).toContain("app-123");
    expect(pageText()).toContain("Unsaved changes.");
    expect(getButton("Client ID excluded").disabled).toBe(true);

    await act(async () => getButton("Exclude host").click());

    expect(pageText()).toContain("portal.example.com");
    expect(getButton("Host excluded").disabled).toBe(true);
  });

  test("settings save feedback stays next to the save button", async () => {
    const onSave = vi.fn(async () => undefined);
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={onSave}
        onClearDiagnostics={async () => undefined}
      />
    );

    await act(async () => getTab("Account").click());
    await act(async () => setInputValue(getAccountInput(), "changed@example.com"));
    await act(async () => getButton("Save settings").click());

    const saveBar = document.querySelector<HTMLElement>(".header-command");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saveBar?.querySelector(".save-message")?.textContent).toBe("Settings saved.");
    expect(saveBar?.textContent).toContain("Settings saved.");
    expect(document.querySelector(".control-center > .inline-message")).toBeNull();
    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ diagnostics: expect.anything() }));
  });

  test("settings distinguish clean, dirty, saved, and error states", async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error("Could not persist settings."))
      .mockResolvedValueOnce(undefined);
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={onSave}
        onClearDiagnostics={async () => undefined}
      />
    );

    expect(getButton("Save settings").disabled).toBe(true);
    expect(pageText()).toContain("All changes saved.");
    await act(async () => getTab("Account").click());
    await act(async () => setInputValue(getAccountInput(), "changed@example.com"));
    expect(getButton("Save settings").disabled).toBe(false);
    expect(pageText()).toContain("Unsaved changes.");

    await act(async () => getButton("Save settings").click());
    expect(document.querySelector(".save-message.error")?.textContent).toBe("Could not persist settings.");
    expect(document.querySelector(".save-status")?.getAttribute("role")).toBe("alert");
    expect(getButton("Save settings").disabled).toBe(false);

    await act(async () => getButton("Save settings").click());
    expect(document.querySelector(".save-message.success")?.textContent).toBe("Settings saved.");
    expect(getButton("Save settings").disabled).toBe(true);
  });

  test("settings preserve edits made while an older save is in flight", async () => {
    const request = deferred<void>();
    const initial = settingsWith({ preferredUpn: "user@example.com" });
    const onSave = vi.fn(() => request.promise);
    const onClearDiagnostics = vi.fn(async () => undefined);
    await render(
      <SettingsEditor settings={initial} onSave={onSave} onClearDiagnostics={onClearDiagnostics} />
    );

    await act(async () => getTab("Account").click());
    await act(async () => setInputValue(getAccountInput(), "first@example.com"));
    await act(async () => getButton("Save settings").click());
    await act(async () => setInputValue(getAccountInput(), "latest@example.com"));

    await rerender(
      <SettingsEditor
        settings={settingsWith({ ...initial, preferredUpn: "first@example.com" })}
        onSave={onSave}
        onClearDiagnostics={onClearDiagnostics}
      />
    );
    await act(async () => {
      request.resolve();
      await request.promise;
    });

    expect(getAccountInput().value).toBe("latest@example.com");
    expect(pageText()).toContain("Newer changes are still unsaved.");
    expect(getButton("Save settings").disabled).toBe(false);
  });

  test("clearing diagnostics preserves an unsaved settings draft", async () => {
    const initial = settingsWith({
      preferredUpn: "user@example.com",
      diagnostics: [diagnostic("urlRewritten", "URL prepared.", 1)]
    });
    const onClearDiagnostics = vi.fn(async () => undefined);
    await render(
      <SettingsEditor
        settings={initial}
        onSave={async () => undefined}
        onClearDiagnostics={onClearDiagnostics}
      />
    );

    await act(async () => getTab("Account").click());
    await act(async () => setInputValue(getAccountInput(), "unsaved@example.com"));
    await act(async () => getTab("Diagnostics").click());
    await act(async () => getButton("Clear").click());
    expect(onClearDiagnostics).toHaveBeenCalledTimes(1);

    await rerender(
      <SettingsEditor
        settings={settingsWith({ ...initial, diagnostics: [] })}
        onSave={async () => undefined}
        onClearDiagnostics={onClearDiagnostics}
      />
    );
    await act(async () => getTab("Account").click());
    expect(getAccountInput().value).toBe("unsaved@example.com");
    expect(pageText()).toContain("Unsaved changes.");
  });

  test("alias validation reports invalid, duplicate, and over-limit values", async () => {
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com" })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );
    await act(async () => getTab("Account").click());

    const aliases = getTextArea("Aliases");
    await act(async () => setTextAreaValue(aliases, "alias@example.com\nALIAS@example.com\nnot-an-email"));
    expect(pageText()).toContain("Invalid: not-an-email.");
    expect(pageText()).toContain("Duplicate: ALIAS@example.com.");
    expect(aliases.getAttribute("aria-invalid")).toBe("true");
    expect(getButton("Save settings").disabled).toBe(true);

    const tooMany = Array.from({ length: 21 }, (_, index) => `alias${index}@example.com`).join("\n");
    await act(async () => setTextAreaValue(aliases, tooMany));
    expect(pageText()).toContain("21/20 unique valid aliases");
    expect(pageText()).toContain("Remove 1 alias to meet the 20-alias limit.");
    expect(getButton("Save settings").disabled).toBe(true);

    await act(async () => setTextAreaValue(aliases, "valid@example.com"));
    expect(aliases.getAttribute("aria-invalid")).toBe("false");
    expect(getButton("Save settings").disabled).toBe(false);
  });

  test("diagnostic times expose ISO values and render human-readable local time", async () => {
    const event = diagnostic("urlRewritten", "URL prepared.", 1);
    await render(
      <SettingsEditor
        settings={settingsWith({ preferredUpn: "user@example.com", diagnostics: [event] })}
        onSave={async () => undefined}
        onClearDiagnostics={async () => undefined}
      />
    );

    const time = document.querySelector<HTMLTimeElement>("time");
    expect(time?.dateTime).toBe(event.occurredAt);
    expect(time?.title).toBe(event.occurredAt);
    expect(time?.textContent).not.toBe("2026-06-01 10:00:00");
  });

  test("statistics summarize local usage data", () => {
    const stats = buildUsageStats(settingsWith({
      aliases: ["alias.one@example.com", "alias.two@example.com"],
      diagnostics: [
        diagnostic("urlRewritten", "URL prepared.", 1),
        diagnostic("autoPickedAccount", "Picked.", 2),
        diagnostic("noMatchingAccount", "No match.", 3),
        diagnostic("disabled", "Disabled.", 4),
        diagnostic("excludedApp", "Excluded app.", 5),
        diagnostic("approvalRequired", "Approval needed.", 6)
      ]
    }));
    const values = Object.fromEntries(stats.map((item) => [item.label, item.value]));

    expect(values).toMatchObject({
      "Total events": "6",
      "Approved apps": "0",
      "Auto-picked": "1",
      "Picker misses": "1",
      "Skipped decisions": "3",
      "Picker success": "50%",
      "Aliases": "2",
      "Active controls": "4/5"
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

    await act(async () => getTab("Diagnostics").click());
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

  test("legacy detected profile email is discarded before rendering", async () => {
    await render(
      <PopupPanel
        settings={mergeSettings({ detectedProfileEmail: "legacy@example.com" })}
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

async function rerender(element: ReactElement) {
  if (!mountedRoot) {
    throw new Error("The test root is not mounted.");
  }
  await act(async () => mountedRoot?.render(element));
}

function settingsWith(input: Partial<UseMyCurrentAccountSettings>) {
  return mergeSettings(input);
}

function pageText() {
  return document.body.textContent || "";
}

function activePanelText() {
  return document.querySelector<HTMLElement>("[role='tabpanel']")?.textContent || "";
}

function getTabs() {
  return [...document.querySelectorAll<HTMLButtonElement>("[role='tab']")];
}

function getTab(label: string) {
  const tab = getTabs().find((item) => item.textContent === label);
  if (!tab) {
    throw new Error(`${label} tab was not rendered.`);
  }
  return tab;
}

function getOverviewValue(label: string) {
  const card = [...document.querySelectorAll<HTMLElement>(".overview-card")]
    .find((item) => item.querySelector("dt")?.textContent === label);
  if (!card) {
    throw new Error(`${label} overview card was not rendered.`);
  }
  return card.querySelector("dd")?.textContent;
}

function getAccountInput() {
  const accountInput = document.querySelector<HTMLInputElement>("input[aria-label='Account to auto select']");
  if (!accountInput) {
    throw new Error("Account input was not rendered.");
  }
  return accountInput;
}

function getTextArea(label: string) {
  const textArea = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label='${label}']`);
  if (!textArea) {
    throw new Error(`${label} textarea was not rendered.`);
  }
  return textArea;
}

function getButton(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === label);
  if (!button) {
    throw new Error(`${label} button was not rendered.`);
  }
  return button;
}

function getRadio(label: string) {
  const radio = document.querySelector<HTMLInputElement>(`input[type='radio'][aria-label='${label}']`);
  if (!radio) {
    throw new Error(`${label} radio was not rendered.`);
  }
  return radio;
}

function getHelpButton(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  if (!button) {
    throw new Error(`${label} help button was not rendered.`);
  }
  return button;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextAreaValue(input: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function appRule(id: string, matchType: AppMatchType, value: string, enabled: boolean): AppRule {
  return {
    id,
    enabled,
    matchType,
    value,
    createdAt: "2026-06-01T10:00:00.000Z"
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function diagnostic(kind: DiagnosticKind, message: string, index: number) {
  return {
    id: `event-${index}`,
    kind,
    occurredAt: `2026-06-${String(Math.min(index, 28)).padStart(2, "0")}T10:00:00.000Z`,
    message
  };
}
