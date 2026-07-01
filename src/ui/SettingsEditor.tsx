import { useEffect, useMemo, useState } from "react";
import { getBadgeState } from "../lib/badge";
import { DEFAULT_SETTINGS, mergeSettings, normalizeUpn, type UseMyCurrentAccountSettings } from "../lib/settings";

interface SettingsEditorProps {
  settings: UseMyCurrentAccountSettings;
  onSave: (settings: UseMyCurrentAccountSettings) => Promise<void>;
  onClearDiagnostics: () => Promise<void>;
}

export function SettingsEditor({ settings, onSave, onClearDiagnostics }: SettingsEditorProps) {
  const [draft, setDraft] = useState(() => settingsToDraft(settings));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(settingsToDraft(settings));
  }, [settings]);

  const preferredUpn = normalizeUpn(draft.preferredUpn);
  const previewSettings = useMemo(
    () =>
      mergeSettings({
        ...settings,
        ...draft,
        preferredUpn,
        aliases: draft.aliasesText.split(/[\n,]+/).map((item) => item.trim()),
        diagnostics: settings.diagnostics
      }),
    [draft, preferredUpn, settings]
  );
  const badge = getBadgeState(previewSettings);
  const accountRequired = draft.enabled && !preferredUpn;
  const canSave = !busy && !accountRequired;

  async function save() {
    if (!canSave) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await onSave(previewSettings);
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearDiagnostics() {
    setBusy(true);
    setMessage("");
    try {
      await onClearDiagnostics();
      setMessage("Diagnostics cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear diagnostics.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="control-center">
      <header className="control-hero">
        <div className="brand-lockup">
          <img className="app-icon large" src="img/UseMyCurrentAccountPlusPlus.svg" alt="" />
          <div>
            <h1>UseMyCurrentAccount++</h1>
            <p>Control how Microsoft sign-in flows are rewritten and auto-selected on this browser profile.</p>
          </div>
        </div>
        <span className={`state-pill ${badge.isOperational ? "on" : "off"}`}>{badge.text}</span>
      </header>

      <div className="settings-grid">
        <section className="panel account-panel">
          <div className="section-title">
            <div>
              <h2>Account</h2>
              <p>Manual entry is the reliable path. Browser identity may prefill this quietly when supported.</p>
            </div>
          </div>

          <label className="switch-row">
            <span>
              <strong>Enabled</strong>
              <small>Runs URL rewrite rules and picker automation when a valid account is configured.</small>
            </span>
            <input
              aria-label="Enabled"
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })}
            />
          </label>

          <label className="field">
            <span>Account to auto select</span>
            <input
              aria-label="Account to auto select"
              autoComplete="email"
              inputMode="email"
              placeholder="name@example.com"
              value={draft.preferredUpn}
              onChange={(event) => setDraft({ ...draft, preferredUpn: event.currentTarget.value })}
            />
          </label>

          <label className="field">
            <span>Aliases</span>
            <textarea
              aria-label="Aliases"
              rows={5}
              placeholder="Alternate UPNs, one per line"
              value={draft.aliasesText}
              onChange={(event) => setDraft({ ...draft, aliasesText: event.currentTarget.value })}
            />
          </label>

          {accountRequired ? <p className="inline-warning">Enter a valid account before enabling automation.</p> : null}
        </section>

        <section className="panel behavior-panel">
          <div className="section-title">
            <div>
              <h2>Behavior</h2>
              <p>Advanced controls for the rewrite layer and picker fallback.</p>
            </div>
          </div>

          <label className="switch-row">
            <span>
              <strong>URL rewrite</strong>
              <small>Add login and domain hints before Microsoft renders the sign-in page.</small>
            </span>
            <input
              aria-label="URL rewrite"
              type="checkbox"
              checked={draft.rewriteEnabled}
              onChange={(event) => setDraft({ ...draft, rewriteEnabled: event.currentTarget.checked })}
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Auto-pick account</strong>
              <small>Click one exact matching account tile when the picker still appears.</small>
            </span>
            <input
              aria-label="Auto-pick account"
              type="checkbox"
              checked={draft.autoPickEnabled}
              onChange={(event) => setDraft({ ...draft, autoPickEnabled: event.currentTarget.checked })}
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Suppress select account prompt</strong>
              <small>Remove only prompt=select_account from OAuth URLs.</small>
            </span>
            <input
              aria-label="Suppress select account prompt"
              type="checkbox"
              checked={draft.suppressSelectAccountPrompt}
              onChange={(event) => setDraft({ ...draft, suppressSelectAccountPrompt: event.currentTarget.checked })}
            />
          </label>
        </section>

        <section className="panel diagnostics-panel wide-panel">
          <div className="section-title">
            <div>
              <h2>Diagnostics</h2>
              <p>Local events for rewrite and picker decisions. These stay in browser storage.</p>
            </div>
            <button type="button" disabled={busy || !settings.diagnostics.length} onClick={() => void clearDiagnostics()}>
              Clear
            </button>
          </div>
          {settings.diagnostics.length ? (
            <ol className="diagnostics">
              {settings.diagnostics.slice(0, 20).map((item) => (
                <li key={item.id}>
                  <span>{item.kind}</span>
                  <strong>{item.message}</strong>
                  <time>{item.occurredAt.slice(0, 19).replace("T", " ")}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty">No diagnostics yet.</p>
          )}
        </section>
      </div>

      <section className="save-bar">
        <button type="button" className="primary" disabled={!canSave} onClick={() => void save()}>
          Save settings
        </button>
        <span className={badge.isOperational ? "save-hint on" : "save-hint off"}>
          {badge.reason === "enabled" ? "Ready to operate" : badge.reason === "disabled" ? "Extension is off" : "Account required"}
        </span>
      </section>

      {message ? <p className="inline-message">{message}</p> : null}
    </main>
  );
}

export function settingsToDraft(settings: UseMyCurrentAccountSettings) {
  return {
    enabled: settings.enabled,
    preferredUpn: settings.preferredUpn || "",
    aliasesText: settings.aliases.join("\n"),
    rewriteEnabled: settings.rewriteEnabled,
    autoPickEnabled: settings.autoPickEnabled,
    suppressSelectAccountPrompt: settings.suppressSelectAccountPrompt
  };
}

export function createResetSettings(): UseMyCurrentAccountSettings {
  return structuredClone(DEFAULT_SETTINGS);
}
