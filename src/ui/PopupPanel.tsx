import { useEffect, useMemo, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setEnabled(settings.enabled);
    setAccount(settings.preferredUpn || "");
  }, [settings]);

  const normalizedAccount = normalizeUpn(account);
  const draftSettings = useMemo(
    () =>
      mergeSettings({
        ...settings,
        enabled,
        preferredUpn: normalizedAccount
      }),
    [enabled, normalizedAccount, settings]
  );
  const badge = getBadgeState(draftSettings);
  const accountRequired = enabled && !normalizedAccount;
  const canApply = !busy && !accountRequired;
  const extensionHint = badge.isOperational
    ? "Automation is ready after apply."
    : accountRequired
      ? "Add an account to turn on."
      : "Automation is paused.";

  async function apply() {
    if (!canApply) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await onSave(draftSettings);
      setMessage(badge.isOperational ? "Ready for Microsoft sign-ins." : "Extension is off.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <img className="app-icon" src="img/UseMyCurrentAccountPlusPlus.svg" alt="" />
        <div>
          <h1>UseMyCurrentAccount++</h1>
          <p>Pin Microsoft sign-ins to one account.</p>
        </div>
        <span className={`state-pill ${badge.isOperational ? "on" : "off"}`}>{badge.text}</span>
      </header>

      <section className="popup-card">
        <div className="popup-row">
          <div>
            <strong>Extension</strong>
            <small>{extensionHint}</small>
          </div>
          <button
            type="button"
            className={`toggle-button ${badge.isOperational ? "selected" : ""}`}
            aria-pressed={badge.isOperational}
            onClick={() => setEnabled((current) => (badge.isOperational ? false : !current))}
          >
            {badge.text}
          </button>
        </div>

        <label className="field compact-field">
          <span>Account to auto select</span>
          <input
            aria-label="Account to auto select"
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            value={account}
            onChange={(event) => setAccount(event.currentTarget.value)}
          />
        </label>

        {accountRequired ? <p className="inline-warning">Enter a valid account to turn ON.</p> : null}
      </section>

      <div className="popup-actions">
        <button type="button" className="primary" disabled={!canApply} onClick={() => void apply()}>
          Apply
        </button>
        <button type="button" onClick={onOpenSettings}>
          Full settings
        </button>
      </div>

      {message ? <p className="inline-message">{message}</p> : null}
    </main>
  );
}
