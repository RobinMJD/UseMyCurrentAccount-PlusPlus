import { useEffect, useMemo, useState } from "react";
import { sanitizeStoredDiagnosticUrl } from "../lib/appContext";
import { getBadgeState } from "../lib/badge";
import {
  createAppExclusion,
  mergeSettings,
  normalizeAppExclusionValue,
  normalizeUpn,
  type AppExclusion,
  type AppExclusionMatchType,
  type DiagnosticEvent,
  type UseMyCurrentAccountSettings
} from "../lib/settings";

const DIAGNOSTICS_PAGE_SIZE = 10;

interface SettingsEditorProps {
  settings: UseMyCurrentAccountSettings;
  onSave: (settings: UseMyCurrentAccountSettings) => Promise<void>;
  onClearDiagnostics: () => Promise<void>;
}

interface UsageStat {
  label: string;
  value: string;
  hint: string;
}

export function SettingsEditor({ settings, onSave, onClearDiagnostics }: SettingsEditorProps) {
  const [draft, setDraft] = useState(() => settingsToDraft(settings));
  const [newExclusionType, setNewExclusionType] = useState<AppExclusionMatchType>("clientId");
  const [newExclusionValue, setNewExclusionValue] = useState("");
  const [diagnosticsPage, setDiagnosticsPage] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(settingsToDraft(settings));
  }, [settings]);

  useEffect(() => {
    setDiagnosticsPage(0);
  }, [settings.diagnostics.length]);

  const preferredUpn = normalizeUpn(draft.preferredUpn);
  const previewSettings = useMemo(
    () =>
      mergeSettings({
        ...settings,
        ...draft,
        preferredUpn,
        aliases: draft.aliasesText.split(/[\n,]+/).map((item) => item.trim()),
        appExclusions: draft.appExclusions,
        diagnostics: settings.diagnostics
      }),
    [draft, preferredUpn, settings]
  );
  const badge = getBadgeState(previewSettings);
  const accountRequired = draft.enabled && !preferredUpn;
  const canSave = !busy && !accountRequired;
  const usageStats = useMemo(() => buildUsageStats(previewSettings), [previewSettings]);
  const diagnosticsPageCount = Math.max(1, Math.ceil(settings.diagnostics.length / DIAGNOSTICS_PAGE_SIZE));
  const currentDiagnosticsPage = Math.min(diagnosticsPage, diagnosticsPageCount - 1);
  const diagnosticsStart = currentDiagnosticsPage * DIAGNOSTICS_PAGE_SIZE;
  const diagnosticsEnd = Math.min(diagnosticsStart + DIAGNOSTICS_PAGE_SIZE, settings.diagnostics.length);
  const visibleDiagnostics = settings.diagnostics.slice(diagnosticsStart, diagnosticsEnd);

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

  function addManualExclusion() {
    if (addExclusion(newExclusionType, newExclusionValue)) {
      setNewExclusionValue("");
    }
  }

  function addExclusion(
    matchType: AppExclusionMatchType,
    value: string | undefined,
    sourceDiagnosticId?: string
  ): boolean {
    const exclusion = createAppExclusion(matchType, value, { sourceDiagnosticId });
    if (!exclusion) {
      setMessage(matchType === "clientId" ? "Enter a valid client ID." : "Enter a valid redirect or reply host.");
      return false;
    }
    if (hasDraftExclusion(draft.appExclusions, matchType, exclusion.value)) {
      setMessage("Exclusion already added.");
      return false;
    }
    setDraft({
      ...draft,
      appExclusions: [exclusion, ...draft.appExclusions]
    });
    setMessage("Save settings to apply.");
    return true;
  }

  function toggleExclusion(id: string, enabled: boolean) {
    setDraft({
      ...draft,
      appExclusions: draft.appExclusions.map((item) => item.id === id ? { ...item, enabled } : item)
    });
    setMessage("Save settings to apply.");
  }

  function removeExclusion(id: string) {
    setDraft({
      ...draft,
      appExclusions: draft.appExclusions.filter((item) => item.id !== id)
    });
    setMessage("Save settings to apply.");
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

          <details className="mode-details">
            <summary>Mode details</summary>
            <div className="mode-detail-list">
              <div className="mode-detail-item">
                <strong>URL rewrite</strong>
                <p>
                  Adds or replaces Microsoft sign-in hints before the page loads. This is the cleanest way to skip the picker
                  when the app accepts hints.
                </p>
              </div>
              <div className="mode-detail-item">
                <strong>Auto-pick account</strong>
                <p>
                  Clicks exactly one matching visible account tile. It does nothing on no match, multiple matches, or
                  "Use another account."
                </p>
              </div>
              <div className="mode-detail-item">
                <strong>Suppress select account prompt</strong>
                <p>
                  Removes only <code>prompt=select_account</code>, while leaving <code>prompt=login</code>,{" "}
                  <code>prompt=consent</code>, and <code>prompt=none</code> unchanged.
                </p>
              </div>
            </div>
          </details>
        </section>

        <section className="panel exclusions-panel wide-panel">
          <div className="section-title">
            <div>
              <h2>App exclusions</h2>
              <p>Skip URL rewrite and auto-pick for specific Microsoft apps.</p>
            </div>
          </div>

          <div className="exclusion-form">
            <label className="field">
              <span>Match by</span>
              <select
                aria-label="Exclusion type"
                value={newExclusionType}
                onChange={(event) => setNewExclusionType(event.currentTarget.value as AppExclusionMatchType)}
              >
                <option value="clientId">Client ID</option>
                <option value="redirectHost">Redirect/reply host</option>
              </select>
            </label>
            <label className="field">
              <span>Value</span>
              <input
                aria-label="Exclusion value"
                placeholder={newExclusionType === "clientId" ? "application-client-id" : "app.example.com"}
                value={newExclusionValue}
                onChange={(event) => setNewExclusionValue(event.currentTarget.value)}
              />
            </label>
            <button type="button" onClick={addManualExclusion}>Add exclusion</button>
          </div>

          {draft.appExclusions.length ? (
            <ul className="exclusion-list">
              {draft.appExclusions.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      aria-label={`Enable exclusion ${item.value}`}
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) => toggleExclusion(item.id, event.currentTarget.checked)}
                    />
                    <span>{formatExclusionType(item.matchType)}</span>
                  </label>
                  <strong>{item.value}</strong>
                  <small>{item.sourceDiagnosticId ? `From ${item.sourceDiagnosticId}` : item.id}</small>
                  <button type="button" onClick={() => removeExclusion(item.id)}>Remove</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No app exclusions configured.</p>
          )}
        </section>

        <section className="save-bar wide-panel">
          <button type="button" className="primary" disabled={!canSave} onClick={() => void save()}>
            Save settings
          </button>
          <span className={badge.isOperational ? "save-hint on" : "save-hint off"}>
            {badge.reason === "enabled" ? "Ready to operate" : badge.reason === "disabled" ? "Extension is off" : "Account required"}
          </span>
        </section>

        <section className="panel statistics-panel wide-panel">
          <div className="section-title">
            <div>
              <h2>Statistics</h2>
              <p>Usage numbers calculated from local settings and diagnostics.</p>
            </div>
          </div>

          <dl className="stats-grid">
            {usageStats.map((item) => (
              <div className="stat-item" key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
                <span>{item.hint}</span>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel diagnostics-panel wide-panel">
          <div className="section-title">
            <div>
              <h2>Diagnostics data</h2>
              <p>Local events for rewrite and picker decisions, shown in pages of {DIAGNOSTICS_PAGE_SIZE}.</p>
            </div>
            <button type="button" disabled={busy || !settings.diagnostics.length} onClick={() => void clearDiagnostics()}>
              Clear
            </button>
          </div>
          {settings.diagnostics.length ? (
            <>
              <ol className="diagnostics">
                {visibleDiagnostics.map((item) => (
                  <li key={item.id}>
                    <div className="diagnostic-heading">
                      <span>{item.kind}</span>
                      <time>{item.occurredAt.slice(0, 19).replace("T", " ")}</time>
                    </div>
                    <strong>{item.message}</strong>
                    <dl className="diagnostic-details">
                      {getDiagnosticDetails(item).map((detail) => (
                        <div key={detail.label}>
                          <dt>{detail.label}</dt>
                          <dd>{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {getDiagnosticExclusionActions(item).length ? (
                      <div className="diagnostic-actions">
                        {getDiagnosticExclusionActions(item).map((action) => {
                          const isAdded = hasDraftExclusion(draft.appExclusions, action.matchType, action.value);
                          return (
                            <button
                              type="button"
                              key={`${item.id}:${action.matchType}`}
                              disabled={isAdded}
                              onClick={() => addExclusion(action.matchType, action.value, item.id)}
                            >
                              {isAdded ? action.addedLabel : action.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              <div className="pagination-row">
                <span>
                  Showing {diagnosticsStart + 1}-{diagnosticsEnd} of {settings.diagnostics.length}
                </span>
                <div>
                  <button
                    type="button"
                    disabled={currentDiagnosticsPage === 0}
                    onClick={() => setDiagnosticsPage((page) => Math.max(0, page - 1))}
                  >
                    Previous
                  </button>
                  <strong>Page {currentDiagnosticsPage + 1} of {diagnosticsPageCount}</strong>
                  <button
                    type="button"
                    disabled={currentDiagnosticsPage >= diagnosticsPageCount - 1}
                    onClick={() => setDiagnosticsPage((page) => Math.min(diagnosticsPageCount - 1, page + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="empty">No diagnostics yet.</p>
          )}
        </section>
      </div>

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
    suppressSelectAccountPrompt: settings.suppressSelectAccountPrompt,
    appExclusions: settings.appExclusions
  };
}

export function buildUsageStats(settings: UseMyCurrentAccountSettings): UsageStat[] {
  const counts = countDiagnostics(settings.diagnostics);
  const pickerAttempts = counts.autoPickedAccount + counts.noMatchingAccount + counts.multipleMatchingAccounts;
  const pickerSuccessRate = pickerAttempts
    ? `${Math.round((counts.autoPickedAccount / pickerAttempts) * 100)}%`
    : "n/a";
  const skippedDecisions = counts.disabled + counts.missingPreferredAccount + counts.pickerSkipped;
  const activeControls = [
    settings.enabled,
    settings.rewriteEnabled,
    settings.autoPickEnabled,
    settings.suppressSelectAccountPrompt
  ].filter(Boolean).length;

  return [
    {
      label: "Total events",
      value: String(settings.diagnostics.length),
      hint: "Stored local diagnostics"
    },
    {
      label: "Last 7 days",
      value: String(counts.lastSevenDays),
      hint: "Recent local events"
    },
    {
      label: "URL rewrites",
      value: String(counts.urlRewritten),
      hint: "Prepared Microsoft sign-in URLs"
    },
    {
      label: "Auto-picked",
      value: String(counts.autoPickedAccount),
      hint: "Picker tiles selected"
    },
    {
      label: "Picker misses",
      value: String(counts.noMatchingAccount + counts.multipleMatchingAccounts),
      hint: "No-match or multiple-match outcomes"
    },
    {
      label: "Skipped decisions",
      value: String(skippedDecisions),
      hint: "Disabled, missing account, or skipped picker"
    },
    {
      label: "Picker success",
      value: pickerSuccessRate,
      hint: "Auto-picks across decisive picker outcomes"
    },
    {
      label: "Aliases",
      value: String(settings.aliases.length),
      hint: "Alternate accounts configured"
    },
    {
      label: "Active controls",
      value: `${activeControls}/4`,
      hint: "Enabled behavior toggles"
    }
  ];
}

function countDiagnostics(diagnostics: DiagnosticEvent[]) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {
    autoPickedAccount: 0,
    disabled: 0,
    lastSevenDays: 0,
    missingPreferredAccount: 0,
    multipleMatchingAccounts: 0,
    noMatchingAccount: 0,
    pickerSkipped: 0,
    urlRewritten: 0
  };

  for (const diagnostic of diagnostics) {
    const occurredAt = Date.parse(diagnostic.occurredAt);
    if (Number.isFinite(occurredAt) && occurredAt >= sevenDaysAgo) {
      counts.lastSevenDays += 1;
    }

    switch (diagnostic.kind) {
      case "autoPickedAccount":
        counts.autoPickedAccount += 1;
        break;
      case "disabled":
        counts.disabled += 1;
        break;
      case "missingPreferredAccount":
        counts.missingPreferredAccount += 1;
        break;
      case "multipleMatchingAccounts":
        counts.multipleMatchingAccounts += 1;
        break;
      case "noMatchingAccount":
        counts.noMatchingAccount += 1;
        break;
      case "pickerSkipped":
        counts.pickerSkipped += 1;
        break;
      case "urlRewritten":
        counts.urlRewritten += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function hasDraftExclusion(exclusions: AppExclusion[], matchType: AppExclusionMatchType, value: string | undefined): boolean {
  const normalizedValue = normalizeAppExclusionValue(matchType, value);
  return Boolean(normalizedValue && exclusions.some((item) => item.matchType === matchType && item.value === normalizedValue));
}

function getDiagnosticExclusionActions(item: DiagnosticEvent) {
  const actions: Array<{
    matchType: AppExclusionMatchType;
    value: string;
    label: string;
    addedLabel: string;
  }> = [];

  if (item.clientId) {
    actions.push({
      matchType: "clientId",
      value: item.clientId,
      label: "Exclude client ID",
      addedLabel: "Client ID excluded"
    });
  }
  if (item.redirectHost) {
    actions.push({
      matchType: "redirectHost",
      value: item.redirectHost,
      label: "Exclude host",
      addedLabel: "Host excluded"
    });
  }
  return actions;
}

function getDiagnosticDetails(item: DiagnosticEvent): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string | undefined }> = [
    { label: "Event ID", value: item.id },
    { label: "Flow", value: formatFlow(item.flow) },
    { label: "Tenant", value: item.tenant },
    { label: "Client ID", value: item.clientId },
    { label: "Host", value: item.redirectHost },
    { label: "Path", value: item.redirectPath },
    { label: "Rule", value: item.ruleId ? String(item.ruleId) : undefined },
    { label: "Params", value: item.changedParams?.join(", ") },
    { label: "Exclusion", value: formatExclusionDetail(item) },
    { label: "Picker", value: formatPickerCounts(item) },
    { label: "URL", value: sanitizeStoredDiagnosticUrl(item.sanitizedUrl || item.url) }
  ];
  return details.flatMap((detail) => detail.value ? [{ label: detail.label, value: detail.value }] : []);
}

function formatExclusionType(matchType: AppExclusionMatchType): string {
  return matchType === "clientId" ? "Client ID" : "Redirect/reply host";
}

function formatFlow(flow: DiagnosticEvent["flow"]): string | undefined {
  if (flow === "oauth") return "OAuth/OIDC";
  if (flow === "saml") return "SAML";
  if (flow === "wsfed") return "WS-Fed";
  return flow === "unknown" ? "Unknown" : undefined;
}

function formatExclusionDetail(item: DiagnosticEvent): string | undefined {
  if (!item.exclusionValue && !item.exclusionId) {
    return undefined;
  }
  return [item.exclusionValue, item.exclusionId].filter(Boolean).join(" / ");
}

function formatPickerCounts(item: DiagnosticEvent): string | undefined {
  if (item.pickerTileCount === undefined && item.pickerMatchCount === undefined) {
    return undefined;
  }
  return `${item.pickerMatchCount ?? 0} match(es) from ${item.pickerTileCount ?? 0} tile(s)`;
}
