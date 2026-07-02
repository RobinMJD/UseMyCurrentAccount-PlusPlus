import { useEffect, useMemo, useRef, useState } from "react";
import { getBadgeState } from "../lib/badge";
import { mergeSettings, normalizeUpn, type UseMyCurrentAccountSettings } from "../lib/settings";

interface PopupPanelProps {
  settings: UseMyCurrentAccountSettings;
  onSave: (settings: UseMyCurrentAccountSettings) => Promise<void>;
  onOpenSettings: () => void;
}

export function PopupPanel({ settings, onSave, onOpenSettings }: PopupPanelProps) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [account, setAccount] = useState(settings.preferredUpn || "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const lastSavedSignature = useRef(getPopupSignature(settings));

  useEffect(() => {
    setEnabled(settings.enabled);
    setAccount(settings.preferredUpn || "");
    lastSavedSignature.current = getPopupSignature(settings);
  }, [settings]);

  const normalizedAccount = normalizeUpn(account);
  const canSaveAutomatically = !enabled || Boolean(normalizedAccount);
  const draftSettings = useMemo(() => {
    if (!canSaveAutomatically) {
      return undefined;
    }
    return mergeSettings({
      ...settings,
      enabled,
      preferredUpn: normalizedAccount || settings.preferredUpn
    });
  }, [canSaveAutomatically, enabled, normalizedAccount, settings]);
  const badge = getBadgeState(
    mergeSettings({
      ...settings,
      enabled,
      preferredUpn: normalizedAccount
    })
  );
  const accountRequired = enabled && !normalizedAccount;
  const helperText = accountRequired
    ? "Enter a valid account to turn ON. It saves automatically once valid."
    : saveState === "saving"
      ? "Saving changes..."
      : saveState === "saved"
        ? "Saved automatically."
        : saveState === "error"
          ? message
          : badge.isOperational
            ? "Ready. Valid changes save automatically."
            : "Automation is paused.";

  useEffect(() => {
    if (!draftSettings) {
      return;
    }

    const signature = getPopupSignature(draftSettings);
    if (signature === lastSavedSignature.current) {
      return;
    }

    setSaveState("saving");
    setMessage("");
    const timer = window.setTimeout(() => {
      void onSave(draftSettings)
        .then(() => {
          lastSavedSignature.current = signature;
          setSaveState("saved");
        })
        .catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : "Could not save settings.");
          setSaveState("error");
        });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [draftSettings, onSave]);

  const toggleButtonLabel = badge.isOperational
    ? "Turn extension off"
    : accountRequired
      ? "Account required before turning on"
      : "Turn extension on";

  function toggleEnabled() {
    setSaveState("idle");
    setEnabled((current) => {
      if (badge.isOperational || current) {
        return false;
      }
      return true;
    });
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <img className="app-icon" src="img/UseMyCurrentAccountPlusPlus.svg" alt="" />
        <div>
          <h1>UseMyCurrentAccount++</h1>
          <p>Pin Microsoft sign-ins to one account.</p>
        </div>
        <button
          type="button"
          className={`toggle-button header-toggle ${badge.isOperational ? "selected" : ""}`}
          aria-label={toggleButtonLabel}
          aria-pressed={badge.isOperational}
          onClick={toggleEnabled}
        >
          {badge.text}
        </button>
      </header>

      <section className="popup-card">
        <label className="field compact-field">
          <span>Account to auto select</span>
          <input
            aria-label="Account to auto select"
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            value={account}
            onChange={(event) => {
              setSaveState("idle");
              setAccount(event.currentTarget.value);
            }}
          />
        </label>

        <p className={accountRequired || saveState === "error" ? "inline-warning" : "inline-note"}>
          {helperText}
        </p>
      </section>

      <div className="popup-actions single">
        <button type="button" onClick={onOpenSettings}>
          Full settings
        </button>
      </div>
    </main>
  );
}

function getPopupSignature(settings: UseMyCurrentAccountSettings): string {
  return JSON.stringify({
    enabled: settings.enabled,
    preferredUpn: normalizeUpn(settings.preferredUpn)
  });
}
