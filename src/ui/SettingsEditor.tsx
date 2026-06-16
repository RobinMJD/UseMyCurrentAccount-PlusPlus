import { useMemo, useState } from "react";
import { DEFAULT_SETTINGS, mergeSettings, normalizeUpn, type UseMyCurrentAccountSettings } from "../lib/settings";

interface SettingsEditorProps {
  settings: UseMyCurrentAccountSettings;
  onSave: (settings: UseMyCurrentAccountSettings) => Promise<void>;
  onRefreshIdentity: () => Promise<void>;
  onClearDiagnostics: () => Promise<void>;
  onOpenSettings?: () => void;
  compact?: boolean;
}

export function SettingsEditor({
  settings,
  onSave,
  onRefreshIdentity,
  onClearDiagnostics,
  onOpenSettings,
  compact = false
}: SettingsEditorProps) {
  const [draft, setDraft] = useState(() => settingsToDraft(settings));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const preferredUpn = normalizeUpn(draft.preferredUpn);
  const canSave = Boolean(preferredUpn || !draft.enabled);
  const status = useMemo(() => {
    if (!draft.enabled) return { tone: "danger", text: "Disabled" };
    if (!preferredUpn) return { tone: "warning", text: "Preferred account needed" };
    return { tone: "success", text: "Ready" };
  }, [draft.enabled, preferredUpn]);

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await onSave(
        mergeSettings({
          ...settings,
          ...draft,
          preferredUpn,
          aliases: draft.aliasesText.split(/[\n,]+/).map((item) => item.trim()),
          diagnostics: settings.diagnostics
        })
      );
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshIdentity() {
    setBusy(true);
    setMessage("");
    try {
      await onRefreshIdentity();
      setMessage("Profile identity refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Identity refresh failed.");
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
    <main className={compact ? "app compact" : "app"}>
      <header className="app-header">
        <div>
          <h1>UseMyCurrentAccount++</h1>
          <p>Pin Microsoft sign-ins to the account configured for this browser profile.</p>
        </div>
        <span className={`status ${status.tone}`}>{status.text}</span>
      </header>

      <section className="panel controls-panel">
        <label className="switch-row">
          <span>
            <strong>Enabled</strong>
            <small>Apply rewrite rules and picker automation.</small>
          </span>
          <input
            aria-label="Enabled"
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })}
          />
        </label>
        <label className="field">
          <span>Detected profile email</span>
          <input value={settings.detectedProfileEmail || "Not available"} readOnly />
        </label>
        <label className="field">
          <span>Preferred Microsoft account</span>
          <input
            aria-label="Preferred Microsoft account"
            placeholder="name@example.com"
            value={draft.preferredUpn}
            onChange={(event) => setDraft({ ...draft, preferredUpn: event.currentTarget.value })}
          />
        </label>
        <label className="field">
          <span>Aliases</span>
          <textarea
            aria-label="Aliases"
            rows={compact ? 2 : 4}
            placeholder="Alternate UPNs, one per line"
            value={draft.aliasesText}
            onChange={(event) => setDraft({ ...draft, aliasesText: event.currentTarget.value })}
          />
        </label>
      </section>

      <section className="panel toggles-grid">
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

      <section className="action-row">
        <button type="button" className="primary" disabled={!canSave || busy} onClick={save}>
          Save
        </button>
        <button type="button" disabled={busy} onClick={refreshIdentity}>
          Refresh identity
        </button>
        {onOpenSettings ? (
          <button type="button" disabled={busy} onClick={onOpenSettings}>
            Settings
          </button>
        ) : null}
      </section>
      {message ? <p className="message">{message}</p> : null}

      <section className="panel">
        <div className="section-title">
          <h2>Recent Diagnostics</h2>
          <button type="button" disabled={busy || !settings.diagnostics.length} onClick={clearDiagnostics}>
            Clear
          </button>
        </div>
        {settings.diagnostics.length ? (
          <ol className="diagnostics">
            {settings.diagnostics.slice(0, compact ? 6 : 20).map((item) => (
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
