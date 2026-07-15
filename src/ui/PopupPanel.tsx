import { useEffect, useMemo, useRef, useState } from "react";
import { getBadgeState } from "../lib/badge";
import { mergeSettings, normalizeUpn, type UseMyCurrentAccountSettings } from "../lib/settings";

interface PopupPanelProps {
  settings: UseMyCurrentAccountSettings;
  onSave: (settings: PopupSettingsPatch) => Promise<void>;
  onOpenSettings: () => void;
}

export type PopupSettingsPatch = Pick<UseMyCurrentAccountSettings, "enabled"> & {
  preferredUpn?: string;
};

export function PopupPanel({ settings, onSave, onOpenSettings }: PopupPanelProps) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [account, setAccount] = useState(settings.preferredUpn || "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const lastSavedSignature = useRef(getPopupSignature(settings));
  const lastSavedValues = useRef({
    enabled: settings.enabled,
    preferredUpn: normalizeUpn(settings.preferredUpn)
  });
  const latestSaveAttempt = useRef(0);
  const onSaveRef = useRef(onSave);
  const accountEdited = useRef(false);

  onSaveRef.current = onSave;

  useEffect(() => {
    const incomingSignature = getPopupSignature(settings);
    if (incomingSignature === lastSavedSignature.current) {
      return;
    }
    setEnabled(settings.enabled);
    setAccount(settings.preferredUpn || "");
    setSaveState("idle");
    setMessage("");
    accountEdited.current = false;
    lastSavedSignature.current = incomingSignature;
    lastSavedValues.current = {
      enabled: settings.enabled,
      preferredUpn: normalizeUpn(settings.preferredUpn)
    };
  }, [settings]);

  const normalizedAccount = normalizeUpn(account);
  const accountIsEmpty = !account.trim();
  const saveCandidate = useMemo(() => {
    if (accountIsEmpty) {
      if (!accountEdited.current && !lastSavedValues.current.preferredUpn) {
        return undefined;
      }
      return {
        patch: { enabled: false, preferredUpn: "" },
        signature: getPopupSignature({ enabled: false, preferredUpn: undefined })
      };
    }
    if (normalizedAccount) {
      return {
        patch: { enabled, preferredUpn: normalizedAccount },
        signature: getPopupSignature({ enabled, preferredUpn: normalizedAccount })
      };
    }
    if (enabled !== lastSavedValues.current.enabled) {
      return {
        patch: { enabled },
        signature: getPopupSignature({
          enabled,
          preferredUpn: lastSavedValues.current.preferredUpn
        })
      };
    }
    return undefined;
  }, [accountIsEmpty, enabled, normalizedAccount]);
  const badge = getBadgeState(
    mergeSettings({
      ...settings,
      enabled,
      preferredUpn: normalizedAccount
    })
  );
  const noAutomationBehaviors = !settings.rewriteEnabled && !settings.autoPickEnabled;
  const accountInvalid = Boolean(account.trim()) && !normalizedAccount;
  const accountRequired = enabled && !normalizedAccount;
  const helperText = accountInvalid
    ? "Enter a valid account. The invalid value has not been saved."
    : accountRequired
    ? "Enter a valid account to turn ON. It saves automatically once valid."
    : saveState === "saving"
      ? "Saving changes..."
      : saveState === "saved"
        ? "Saved automatically."
        : saveState === "error"
          ? message
          : noAutomationBehaviors
            ? "Automation is paused. Enable URL rewriting or account auto-pick in Full settings."
          : badge.isOperational
            ? "Ready. Valid changes save automatically."
            : "Automation is paused.";

  useEffect(() => {
    const attempt = ++latestSaveAttempt.current;
    if (!saveCandidate) {
      return;
    }

    const { patch, signature } = saveCandidate;
    if (signature === lastSavedSignature.current) {
      return;
    }

    setSaveState("saving");
    setMessage("");
    void onSaveRef.current(patch)
      .then(() => {
        if (attempt !== latestSaveAttempt.current) {
          return;
        }
        lastSavedSignature.current = signature;
        lastSavedValues.current = {
          enabled: patch.enabled,
          preferredUpn: "preferredUpn" in patch
            ? normalizeUpn(patch.preferredUpn)
            : lastSavedValues.current.preferredUpn
        };
        setSaveState("saved");
      })
      .catch((error: unknown) => {
        if (attempt !== latestSaveAttempt.current) {
          return;
        }
        setMessage(error instanceof Error ? error.message : "Could not save settings.");
        setSaveState("error");
      });
  }, [saveCandidate]);

  const turnOnBlocked = !enabled && !normalizedAccount;
  const toggleUnavailable = noAutomationBehaviors || turnOnBlocked;
  const toggleButtonLabel = noAutomationBehaviors
    ? "Enable an automation behavior in Full settings"
    : badge.isOperational || enabled
      ? "Turn extension off"
      : turnOnBlocked
        ? "Enter a valid account before turning on"
        : "Turn extension on";

  function toggleEnabled() {
    if (noAutomationBehaviors) {
      return;
    }
    setSaveState("idle");
    setEnabled((current) => {
      if (current) {
        return false;
      }
      return Boolean(normalizedAccount);
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
          disabled={toggleUnavailable}
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
              const nextAccount = event.currentTarget.value;
              accountEdited.current = true;
              setSaveState("idle");
              setMessage("");
              setAccount(nextAccount);
              if (!nextAccount.trim()) {
                setEnabled(false);
              }
            }}
            aria-invalid={accountInvalid}
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

function getPopupSignature(settings: Pick<UseMyCurrentAccountSettings, "enabled" | "preferredUpn">): string {
  return JSON.stringify({
    enabled: settings.enabled,
    preferredUpn: normalizeUpn(settings.preferredUpn)
  });
}
