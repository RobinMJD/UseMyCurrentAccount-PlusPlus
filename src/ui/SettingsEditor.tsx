import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { sanitizeStoredDiagnosticUrl } from "../lib/appContext";
import { getBadgeState } from "../lib/badge";
import {
  createAppApproval,
  createAppExclusion,
  mergeSettings,
  normalizeAppExclusionValue,
  normalizeUpn,
  type AppExclusionMatchType,
  type AppRule,
  type DiagnosticEvent,
  type UserEditableSettings,
  type UseMyCurrentAccountSettings
} from "../lib/settings";

const DIAGNOSTICS_PAGE_SIZE = 10;
const MAX_ALIASES = 20;
const MAX_APP_APPROVALS = 30;
const MAX_APP_EXCLUSIONS = 30;

type SettingsTab = "overview" | "account" | "automation" | "appRules" | "diagnostics" | "about";
type AutomationScope = "off" | "allApps" | "approvedOnly";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "account", label: "Account" },
  { id: "automation", label: "Automation" },
  { id: "appRules", label: "App rules" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "about", label: "About" }
];

const AUTOMATION_SCOPE_OPTIONS: Array<{
  id: AutomationScope;
  title: string;
  description: string;
  helpTitle: string;
  help: string;
}> = [
  {
    id: "off",
    title: "Off",
    description: "Do not rewrite URLs or click account tiles.",
    helpTitle: "Off mode",
    help: "Turns the extension automation off while keeping your account, included apps, excluded apps, and diagnostics saved."
  },
  {
    id: "allApps",
    title: "All Microsoft apps except exclusions",
    description: "Automate Microsoft sign-ins unless an app is blocked.",
    helpTitle: "All apps mode",
    help: "Best for trusted browser profiles. The extension can rewrite and auto-pick for Microsoft sign-ins, but excluded apps are always skipped."
  },
  {
    id: "approvedOnly",
    title: "Approved apps only",
    description: "Observe unknown apps first, then approve them from diagnostics.",
    helpTitle: "Approved apps only mode",
    help: "Best for scripts and mixed profiles. Unknown app contexts are logged but not rewritten or auto-picked until you add an included app rule."
  }
];

interface SettingsEditorProps {
  settings: UseMyCurrentAccountSettings;
  onSave: (settings: EditableSettingsPatch) => Promise<void>;
  onClearDiagnostics: () => Promise<void>;
}

export type EditableSettingsPatch = UserEditableSettings;

type SettingsDraft = ReturnType<typeof settingsToDraft>;
type FeedbackKind = "success" | "error" | "info";

interface Feedback {
  kind: FeedbackKind;
  text: string;
}

interface UsageStat {
  label: string;
  value: string;
  hint: string;
}

export function SettingsEditor({ settings, onSave, onClearDiagnostics }: SettingsEditorProps) {
  const incomingDraft = settingsToDraft(settings);
  const incomingSignature = getDraftSignature(incomingDraft);
  const [draft, setDraft] = useState(() => incomingDraft);
  const [savedSignature, setSavedSignature] = useState(() => incomingSignature);
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");
  const [openHelpId, setOpenHelpId] = useState<string | undefined>();
  const [newApprovalType, setNewApprovalType] = useState<AppExclusionMatchType>("clientId");
  const [newApprovalValue, setNewApprovalValue] = useState("");
  const [newExclusionType, setNewExclusionType] = useState<AppExclusionMatchType>("clientId");
  const [newExclusionValue, setNewExclusionValue] = useState("");
  const [diagnosticsPage, setDiagnosticsPage] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | undefined>();
  const [approvalInputError, setApprovalInputError] = useState("");
  const [exclusionInputError, setExclusionInputError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastIncomingSignature = useRef(incomingSignature);
  const savedSignatureRef = useRef(incomingSignature);
  const draftRef = useRef(draft);

  draftRef.current = draft;

  useEffect(() => {
    if (incomingSignature === lastIncomingSignature.current) {
      return;
    }

    const previousSavedSignature = savedSignatureRef.current;
    setDraft((current) => getDraftSignature(current) === previousSavedSignature ? incomingDraft : current);
    lastIncomingSignature.current = incomingSignature;
    savedSignatureRef.current = incomingSignature;
    setSavedSignature(incomingSignature);
  }, [incomingSignature]);

  useEffect(() => {
    setDiagnosticsPage(0);
  }, [settings.diagnostics.length]);

  const preferredUpn = normalizeUpn(draft.preferredUpn);
  const preferredUpnInvalid = Boolean(draft.preferredUpn.trim()) && !preferredUpn;
  const aliasAnalysis = useMemo(() => analyzeAliases(draft.aliasesText), [draft.aliasesText]);
  const draftSignature = getDraftSignature(draft);
  const isDirty = draftSignature !== savedSignature;
  const editablePatch = useMemo<EditableSettingsPatch>(() => ({
    enabled: draft.enabled,
    preferredUpn: preferredUpn || "",
    aliases: aliasAnalysis.aliases,
    rewriteEnabled: draft.rewriteEnabled,
    autoPickEnabled: draft.autoPickEnabled,
    suppressSelectAccountPrompt: draft.suppressSelectAccountPrompt,
    requireAppApproval: draft.requireAppApproval,
    appApprovals: draft.appApprovals,
    appExclusions: draft.appExclusions
  }), [aliasAnalysis.aliases, draft, preferredUpn]);
  const previewSettings = useMemo(
    () =>
      mergeSettings({
        ...settings,
        ...editablePatch,
        diagnostics: settings.diagnostics
      }),
    [editablePatch, settings]
  );
  const badge = getBadgeState(previewSettings);
  const accountRequired = draft.enabled && !preferredUpn;
  const hasAliasErrors = aliasAnalysis.invalid.length > 0 || aliasAnalysis.duplicates.length > 0 || aliasAnalysis.overLimit > 0;
  const canSave = !busy && isDirty && !accountRequired && !preferredUpnInvalid && !hasAliasErrors;
  const usageStats = useMemo(() => buildUsageStats(previewSettings), [previewSettings]);
  const diagnosticsPageCount = Math.max(1, Math.ceil(settings.diagnostics.length / DIAGNOSTICS_PAGE_SIZE));
  const currentDiagnosticsPage = Math.min(diagnosticsPage, diagnosticsPageCount - 1);
  const diagnosticsStart = currentDiagnosticsPage * DIAGNOSTICS_PAGE_SIZE;
  const diagnosticsEnd = Math.min(diagnosticsStart + DIAGNOSTICS_PAGE_SIZE, settings.diagnostics.length);
  const visibleDiagnostics = settings.diagnostics.slice(diagnosticsStart, diagnosticsEnd);
  const automationScope = getAutomationScope(draft.enabled, draft.requireAppApproval);
  const currentScopeLabel = getAutomationScopeLabel(automationScope);
  const recentDiagnostics = settings.diagnostics.slice(0, 3);
  const activeApprovalCount = draft.appApprovals.filter((item) => item.enabled).length;
  const activeExclusionCount = draft.appExclusions.filter((item) => item.enabled).length;
  const statusFeedback: Feedback = feedback?.kind === "error"
    ? feedback
    : busy
      ? { kind: "info", text: "Saving changes..." }
      : preferredUpnInvalid
        ? { kind: "error", text: "Enter a valid account email or clear the field." }
        : accountRequired
          ? { kind: "error", text: "Enter a valid account before enabling automation." }
          : hasAliasErrors
            ? { kind: "error", text: "Resolve the alias validation issues before saving." }
            : isDirty
              ? feedback?.text.includes("Newer changes")
                ? feedback
                : { kind: "info", text: "Unsaved changes." }
              : feedback || { kind: "success", text: "All changes saved." };

  function updateDraft(next: SettingsDraft | ((current: SettingsDraft) => SettingsDraft)) {
    setDraft((current) => typeof next === "function" ? next(current) : next);
    setFeedback(undefined);
  }

  function activateTab(tab: SettingsTab, focus: boolean) {
    setActiveTab(tab);
    setOpenHelpId(undefined);
    if (focus) {
      document.getElementById(`settings-tab-${tab}`)?.focus();
    }
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % SETTINGS_TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SETTINGS_TABS.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }
    event.preventDefault();
    activateTab(SETTINGS_TABS[nextIndex].id, true);
  }

  async function save() {
    if (!canSave) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    const submittedSignature = draftSignature;
    try {
      await onSave(editablePatch);
      savedSignatureRef.current = submittedSignature;
      setSavedSignature(submittedSignature);
      setFeedback({
        kind: "success",
        text: getDraftSignature(draftRef.current) === submittedSignature
          ? "Settings saved."
          : "Earlier changes were saved. Newer changes are still unsaved."
      });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Save failed." });
    } finally {
      setBusy(false);
    }
  }

  async function clearDiagnostics() {
    setBusy(true);
    setFeedback(undefined);
    try {
      await onClearDiagnostics();
      setFeedback({ kind: "success", text: "Diagnostics cleared. Unsaved settings were preserved." });
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Could not clear diagnostics." });
    } finally {
      setBusy(false);
    }
  }

  function addManualExclusion() {
    if (addExclusion(newExclusionType, newExclusionValue)) {
      setNewExclusionValue("");
      setExclusionInputError("");
    }
  }

  function addManualApproval() {
    if (addApproval(newApprovalType, newApprovalValue)) {
      setNewApprovalValue("");
      setApprovalInputError("");
    }
  }

  function addApproval(
    matchType: AppExclusionMatchType,
    value: string | undefined,
    sourceDiagnosticId?: string
  ): boolean {
    const approval = createAppApproval(matchType, value, { sourceDiagnosticId });
    if (!approval) {
      const text = matchType === "clientId" ? "Enter a valid client ID." : "Enter a valid redirect or reply host.";
      if (!sourceDiagnosticId) setApprovalInputError(text);
      setFeedback({ kind: "error", text });
      return false;
    }
    const existing = findDraftRule(draft.appApprovals, matchType, approval.value);
    if (existing?.enabled) {
      const text = "This included-app rule is already enabled.";
      if (!sourceDiagnosticId) setApprovalInputError(text);
      setFeedback({ kind: "error", text });
      return false;
    }
    if (existing) {
      updateDraft({
        ...draft,
        appApprovals: draft.appApprovals.map((item) => item.id === existing.id ? { ...item, enabled: true } : item)
      });
      return true;
    }
    if (draft.appApprovals.length >= MAX_APP_APPROVALS) {
      const text = `Remove an included-app rule before adding another. The limit is ${MAX_APP_APPROVALS}.`;
      if (!sourceDiagnosticId) setApprovalInputError(text);
      setFeedback({ kind: "error", text });
      return false;
    }
    updateDraft({ ...draft, appApprovals: [approval, ...draft.appApprovals] });
    return true;
  }

  function toggleApproval(id: string, enabled: boolean) {
    updateDraft({
      ...draft,
      appApprovals: draft.appApprovals.map((item) => item.id === id ? { ...item, enabled } : item)
    });
  }

  function removeApproval(id: string) {
    updateDraft({
      ...draft,
      appApprovals: draft.appApprovals.filter((item) => item.id !== id)
    });
  }

  function addExclusion(
    matchType: AppExclusionMatchType,
    value: string | undefined,
    sourceDiagnosticId?: string
  ): boolean {
    const exclusion = createAppExclusion(matchType, value, { sourceDiagnosticId });
    if (!exclusion) {
      const text = matchType === "clientId" ? "Enter a valid client ID." : "Enter a valid redirect or reply host.";
      if (!sourceDiagnosticId) setExclusionInputError(text);
      setFeedback({ kind: "error", text });
      return false;
    }
    const existing = findDraftRule(draft.appExclusions, matchType, exclusion.value);
    if (existing?.enabled) {
      const text = "This excluded-app rule is already enabled.";
      if (!sourceDiagnosticId) setExclusionInputError(text);
      setFeedback({ kind: "error", text });
      return false;
    }
    if (existing) {
      updateDraft({
        ...draft,
        appExclusions: draft.appExclusions.map((item) => item.id === existing.id ? { ...item, enabled: true } : item)
      });
      return true;
    }
    if (draft.appExclusions.length >= MAX_APP_EXCLUSIONS) {
      const text = `Remove an excluded-app rule before adding another. The limit is ${MAX_APP_EXCLUSIONS}.`;
      if (!sourceDiagnosticId) setExclusionInputError(text);
      setFeedback({ kind: "error", text });
      return false;
    }
    updateDraft({ ...draft, appExclusions: [exclusion, ...draft.appExclusions] });
    return true;
  }

  function toggleExclusion(id: string, enabled: boolean) {
    updateDraft({
      ...draft,
      appExclusions: draft.appExclusions.map((item) => item.id === id ? { ...item, enabled } : item)
    });
  }

  function removeExclusion(id: string) {
    updateDraft({
      ...draft,
      appExclusions: draft.appExclusions.filter((item) => item.id !== id)
    });
  }

  function changeAutomationScope(scope: AutomationScope) {
    updateDraft({
      ...draft,
      enabled: scope !== "off",
      requireAppApproval: scope === "approvedOnly"
    });
  }

  return (
    <main className="control-center">
      <header className="control-hero settings-hero">
        <div className="brand-lockup">
          <img className="app-icon large" src="img/UseMyCurrentAccountPlusPlus.svg" alt="" />
          <div>
            <h1>UseMyCurrentAccount++</h1>
            <p>Control how Microsoft sign-in flows are rewritten and auto-selected on this browser profile.</p>
          </div>
        </div>
        <div className="header-command">
          <span className={`state-pill ${badge.isOperational ? "on" : "off"}`}>{badge.text}</span>
          <button type="button" className="primary" disabled={!canSave} onClick={() => void save()}>
            Save settings
          </button>
          <div
            className="save-status"
            role={statusFeedback.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {badge.reason !== "enabled" ? (
              <span className="save-hint off">
                {badge.reason === "disabled"
                  ? "Extension is off"
                  : badge.reason === "missingAccount"
                    ? "Account required"
                    : "Enable an automation behavior"}
              </span>
            ) : null}
            <p className={`inline-message save-message ${statusFeedback.kind}`}>{statusFeedback.text}</p>
          </div>
        </div>
      </header>

      <nav className="settings-tabs" aria-label="Settings sections" aria-orientation="horizontal" role="tablist">
        {SETTINGS_TABS.map((tab, index) => (
          <button
            aria-controls="settings-panel"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "selected" : ""}
            id={`settings-tab-${tab.id}`}
            key={tab.id}
            onClick={() => activateTab(tab.id, false)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby={`settings-tab-${activeTab}`}
        className="settings-tab-panel"
        id="settings-panel"
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "overview" ? (
          <div className="tab-layout">
            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Overview</h2>
                  <p>Current state, automation scope, and recent local activity for this browser profile.</p>
                </div>
              </div>
              <dl className="overview-grid">
                <div className="overview-card">
                  <dt>Status</dt>
                  <dd>{badge.text}</dd>
                  <span>{badge.title}</span>
                </div>
                <div className="overview-card">
                  <dt>Account</dt>
                  <dd>{preferredUpn || "Not configured"}</dd>
                  <span>{preferredUpn ? "Used for hints and picker matching" : "Required before automation can run"}</span>
                </div>
                <div className="overview-card">
                  <dt>Automation scope</dt>
                  <dd>{currentScopeLabel}</dd>
                  <span>{automationScope === "approvedOnly" ? "New app contexts wait for approval" : automationScope === "off" ? "Automation is paused" : "Exclusions still skip selected apps"}</span>
                </div>
                <div className="overview-card">
                  <dt>Included apps</dt>
                  <dd>{activeApprovalCount}</dd>
                  <span>{draft.appApprovals.length} configured; used by approved-apps-only mode</span>
                </div>
                <div className="overview-card">
                  <dt>Excluded apps</dt>
                  <dd>{activeExclusionCount}</dd>
                  <span>{draft.appExclusions.length} configured; active rules are always skipped</span>
                </div>
                <div className="overview-card">
                  <dt>Diagnostics</dt>
                  <dd>{settings.diagnostics.length}</dd>
                  <span>{recentDiagnostics.length ? "Recent events available" : "No local events yet"}</span>
                </div>
              </dl>
              {accountRequired ? <p className="inline-warning">Enter a valid account before enabling automation.</p> : null}
            </section>

            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Local activity</h2>
                  <p>A compact usage summary from local diagnostics.</p>
                </div>
              </div>
              <dl className="stats-grid compact">
                {usageStats.slice(0, 6).map((item) => (
                  <div className="stat-item" key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                    <span>{item.hint}</span>
                  </div>
                ))}
              </dl>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Recent diagnostics</h2>
                  <p>The newest decisions recorded by the extension.</p>
                </div>
                <button type="button" onClick={() => setActiveTab("diagnostics")}>View all</button>
              </div>
              {recentDiagnostics.length ? (
                <ol className="recent-list">
                  {recentDiagnostics.map((item) => (
                    <li key={item.id}>
                      <span>{item.kind}</span>
                      <strong>{item.message}</strong>
                      <time dateTime={item.occurredAt} title={item.occurredAt}>{formatDiagnosticTime(item.occurredAt)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">No diagnostics yet.</p>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "account" ? (
          <div className="tab-layout narrow">
            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Account</h2>
                  <p>Manual entry is the reliable path. Browser identity may prefill this field once on initial installation when supported.</p>
                </div>
              </div>
              <label className="field">
                <span className="label-with-help">
                  Account to auto select
                  <HelpButton
                    id="account-upn"
                    openHelpId={openHelpId}
                    setOpenHelpId={setOpenHelpId}
                    title="Account to auto select"
                  >
                    Enter the exact Microsoft account UPN or email this browser profile should use for sign-in hints and picker matching.
                  </HelpButton>
                </span>
                <input
                  aria-label="Account to auto select"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  value={draft.preferredUpn}
                  aria-invalid={preferredUpnInvalid}
                  aria-describedby="preferred-upn-validation"
                  onChange={(event) => updateDraft({ ...draft, preferredUpn: event.currentTarget.value })}
                />
              </label>
              <p
                className={preferredUpnInvalid || accountRequired ? "field-feedback error" : "field-feedback"}
                id="preferred-upn-validation"
              >
                {preferredUpnInvalid
                  ? "Use a complete email-style account, such as name@example.com, or clear the field."
                  : accountRequired
                    ? "An account is required while automation is on."
                    : "This account is stored only in the current browser profile."}
              </p>

              <label className="field">
                <span className="label-with-help">
                  Aliases
                  <HelpButton id="aliases" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Aliases">
                    Add alternate UPNs for the same person or admin account, one per line. Aliases are used only for visible picker tile matching.
                  </HelpButton>
                </span>
                <textarea
                  aria-label="Aliases"
                  rows={5}
                  placeholder="Alternate UPNs, one per line"
                  value={draft.aliasesText}
                  aria-invalid={hasAliasErrors}
                  aria-describedby="aliases-validation"
                  onChange={(event) => updateDraft({ ...draft, aliasesText: event.currentTarget.value })}
                />
              </label>
              <div
                className={hasAliasErrors ? "field-feedback error" : "field-feedback"}
                id="aliases-validation"
              >
                <span>{aliasAnalysis.totalValid}/{MAX_ALIASES} unique valid aliases.</span>
                {aliasAnalysis.invalid.length ? (
                  <span> Invalid: {aliasAnalysis.invalid.join(", ")}.</span>
                ) : null}
                {aliasAnalysis.duplicates.length ? (
                  <span> Duplicate: {aliasAnalysis.duplicates.join(", ")}.</span>
                ) : null}
                {aliasAnalysis.overLimit ? (
                  <span> Remove {aliasAnalysis.overLimit} alias{aliasAnalysis.overLimit === 1 ? "" : "es"} to meet the {MAX_ALIASES}-alias limit.</span>
                ) : null}
              </div>

              {accountRequired ? <p className="inline-warning">Enter a valid account before enabling automation.</p> : null}
            </section>
          </div>
        ) : null}

        {activeTab === "automation" ? (
          <div className="tab-layout">
            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Automation scope</h2>
                  <p>Choose where this browser profile is allowed to automate Microsoft sign-ins.</p>
                </div>
                <HelpButton id="automation-scope" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Automation scope">
                  The scope controls the broad allow policy. Exclusions still win over included apps, and Off keeps your saved rules for later.
                </HelpButton>
              </div>

              <div className="mode-grid" role="radiogroup" aria-label="Automation scope">
                {AUTOMATION_SCOPE_OPTIONS.map((option) => (
                  <label className={`mode-card ${automationScope === option.id ? "selected" : ""}`} key={option.id}>
                    <input
                      aria-label={option.title}
                      checked={automationScope === option.id}
                      name="automation-scope"
                      onChange={() => changeAutomationScope(option.id)}
                      type="radio"
                    />
                    <span>
                      <strong>{option.title}</strong>
                      <small>{option.description}</small>
                    </span>
                    <HelpButton
                      id={`mode-${option.id}`}
                      openHelpId={openHelpId}
                      setOpenHelpId={setOpenHelpId}
                      title={option.helpTitle}
                    >
                      {option.help}
                    </HelpButton>
                  </label>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Mechanics</h2>
                  <p>Fine-tune how the selected scope is applied.</p>
                </div>
              </div>

              <label className="switch-row">
                <span>
                  <strong className="label-with-help">
                    URL rewrite
                    <HelpButton id="rewrite-help" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="URL rewrite">
                      Adds Microsoft OAuth/OIDC sign-in hints before the page loads when the application did not provide its own account or domain hint. Application-provided OAuth/OIDC hints and prompts stay unchanged.
                    </HelpButton>
                  </strong>
                  <small>Add OAuth/OIDC login and domain hints only when the application did not already provide one.</small>
                </span>
                <input
                  aria-label="URL rewrite"
                  type="checkbox"
                  checked={draft.rewriteEnabled}
                  onChange={(event) => updateDraft({ ...draft, rewriteEnabled: event.currentTarget.checked })}
                />
              </label>
              <label className="switch-row">
                <span>
                  <strong className="label-with-help">
                    Auto-pick account
                    <HelpButton id="autopick-help" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Auto-pick account">
                      Clicks exactly one matching visible account tile. It does nothing on no match, multiple matches, or "Use another account."
                    </HelpButton>
                  </strong>
                  <small>Click one exact matching account tile when the picker still appears.</small>
                </span>
                <input
                  aria-label="Auto-pick account"
                  type="checkbox"
                  checked={draft.autoPickEnabled}
                  onChange={(event) => updateDraft({ ...draft, autoPickEnabled: event.currentTarget.checked })}
                />
              </label>
              <label className="switch-row">
                <span>
                  <strong className="label-with-help">
                    Suppress select account prompt
                    <HelpButton
                      id="prompt-help"
                      openHelpId={openHelpId}
                      setOpenHelpId={setOpenHelpId}
                      title="Suppress select account prompt"
                    >
                      Removes only prompt=select_account. It leaves prompt=login, prompt=consent, prompt=none, and mixed prompt values unchanged.
                    </HelpButton>
                  </strong>
                  <small>Remove the prompt only when it is exactly prompt=select_account.</small>
                </span>
                <input
                  aria-label="Suppress select account prompt"
                  type="checkbox"
                  checked={draft.suppressSelectAccountPrompt}
                  onChange={(event) => updateDraft({ ...draft, suppressSelectAccountPrompt: event.currentTarget.checked })}
                />
              </label>
            </section>
          </div>
        ) : null}

        {activeTab === "appRules" ? (
          <div className="tab-layout">
            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Included apps</h2>
                  <p>{activeApprovalCount} active, {draft.appApprovals.length}/{MAX_APP_APPROVALS} configured. Included apps apply only in Approved apps only mode.</p>
                </div>
                <HelpButton id="included-apps" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Included apps">
                  Included apps are used only in Approved apps only mode. They let the same client ID or redirect/reply host automate next time.
                </HelpButton>
              </div>

              <div className="exclusion-form">
                <label className="field">
                  <span className="label-with-help">
                    Match by
                    <HelpButton id="approval-match" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Client ID or host">
                      Client ID is precise for OAuth apps. Redirect/reply host is useful when the same app returns to a stable web address.
                    </HelpButton>
                  </span>
                  <select
                    aria-label="Approval type"
                    value={newApprovalType}
                    onChange={(event) => {
                      setNewApprovalType(event.currentTarget.value as AppExclusionMatchType);
                      setApprovalInputError("");
                      setFeedback(undefined);
                    }}
                  >
                    <option value="clientId">Client ID</option>
                    <option value="redirectHost">Redirect/reply host</option>
                  </select>
                </label>
                <label className="field">
                  <span>Value</span>
                  <input
                    aria-label="Approval value"
                    placeholder={newApprovalType === "clientId" ? "application-client-id" : "app.example.com"}
                    value={newApprovalValue}
                    aria-invalid={Boolean(approvalInputError)}
                    aria-describedby="approval-value-validation"
                    onChange={(event) => {
                      setNewApprovalValue(event.currentTarget.value);
                      setApprovalInputError("");
                      setFeedback(undefined);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={draft.appApprovals.length >= MAX_APP_APPROVALS}
                  onClick={addManualApproval}
                >
                  Add included app
                </button>
              </div>
              <p
                className={approvalInputError ? "field-feedback error" : "field-feedback"}
                id="approval-value-validation"
              >
                {approvalInputError || `Client IDs and redirect/reply hosts must be unique. ${MAX_APP_APPROVALS - draft.appApprovals.length} slot${MAX_APP_APPROVALS - draft.appApprovals.length === 1 ? "" : "s"} available.`}
              </p>

              {draft.appApprovals.length ? (
                <ul className="exclusion-list">
                  {draft.appApprovals.map((item) => (
                    <li key={item.id}>
                      <label>
                        <input
                          aria-label={`Enable approval ${item.value}`}
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => toggleApproval(item.id, event.currentTarget.checked)}
                        />
                        <span>{formatExclusionType(item.matchType)}</span>
                      </label>
                      <strong>{item.value}</strong>
                      <small>{item.sourceDiagnosticId ? `From ${item.sourceDiagnosticId}` : item.id}</small>
                      <button type="button" onClick={() => removeApproval(item.id)}>Remove</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No included apps configured.</p>
              )}
            </section>

            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Excluded apps</h2>
                  <p>{activeExclusionCount} active, {draft.appExclusions.length}/{MAX_APP_EXCLUSIONS} configured. Active exclusions always skip URL rewrite and auto-pick.</p>
                </div>
                <HelpButton id="excluded-apps" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Excluded apps">
                  Exclusions are strongest. If an app is both included and excluded, the extension skips it.
                </HelpButton>
              </div>

              <div className="exclusion-form">
                <label className="field">
                  <span className="label-with-help">
                    Match by
                    <HelpButton id="exclusion-match" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Client ID or host">
                      Client ID blocks one OAuth application. Redirect/reply host blocks app contexts returning to that host.
                    </HelpButton>
                  </span>
                  <select
                    aria-label="Exclusion type"
                    value={newExclusionType}
                    onChange={(event) => {
                      setNewExclusionType(event.currentTarget.value as AppExclusionMatchType);
                      setExclusionInputError("");
                      setFeedback(undefined);
                    }}
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
                    aria-invalid={Boolean(exclusionInputError)}
                    aria-describedby="exclusion-value-validation"
                    onChange={(event) => {
                      setNewExclusionValue(event.currentTarget.value);
                      setExclusionInputError("");
                      setFeedback(undefined);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={draft.appExclusions.length >= MAX_APP_EXCLUSIONS}
                  onClick={addManualExclusion}
                >
                  Add excluded app
                </button>
              </div>
              <p
                className={exclusionInputError ? "field-feedback error" : "field-feedback"}
                id="exclusion-value-validation"
              >
                {exclusionInputError || `Client IDs and redirect/reply hosts must be unique. ${MAX_APP_EXCLUSIONS - draft.appExclusions.length} slot${MAX_APP_EXCLUSIONS - draft.appExclusions.length === 1 ? "" : "s"} available.`}
              </p>

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
                <p className="empty">No excluded apps configured.</p>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "diagnostics" ? (
          <div className="tab-layout">
            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Diagnostics</h2>
                  <p>Local events for approval, exclusion, and picker decisions, shown in pages of {DIAGNOSTICS_PAGE_SIZE}.</p>
                </div>
                <div className="section-actions">
                  <HelpButton id="diagnostics-help" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Diagnostics">
                    Diagnostics stay local. Use allow or exclude actions to turn a captured auth context into a draft app rule.
                  </HelpButton>
                  <button type="button" disabled={busy || !settings.diagnostics.length} onClick={() => void clearDiagnostics()}>
                    Clear
                  </button>
                </div>
              </div>
              {settings.diagnostics.length ? (
                <>
                  <ol className="diagnostics">
                    {visibleDiagnostics.map((item) => (
                      <li key={item.id}>
                        <div className="diagnostic-heading">
                          <span>{item.kind}</span>
                          <time dateTime={item.occurredAt} title={item.occurredAt}>{formatDiagnosticTime(item.occurredAt)}</time>
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
                        {getDiagnosticApprovalActions(item).length || getDiagnosticExclusionActions(item).length ? (
                          <div className="diagnostic-actions">
                            {getDiagnosticApprovalActions(item).map((action) => {
                              const existing = findDraftRule(draft.appApprovals, action.matchType, action.value);
                              const isEnabled = existing?.enabled === true;
                              const isAtLimit = !existing && draft.appApprovals.length >= MAX_APP_APPROVALS;
                              return (
                                <button
                                  type="button"
                                  key={`${item.id}:approval:${action.matchType}`}
                                  disabled={isEnabled || isAtLimit}
                                  title={isAtLimit ? `Included-app limit of ${MAX_APP_APPROVALS} reached` : undefined}
                                  onClick={() => existing
                                    ? toggleApproval(existing.id, true)
                                    : addApproval(action.matchType, action.value, item.id)}
                                >
                                  {isEnabled ? action.addedLabel : existing ? action.enableLabel : action.label}
                                </button>
                              );
                            })}
                            {getDiagnosticExclusionActions(item).map((action) => {
                              const existing = findDraftRule(draft.appExclusions, action.matchType, action.value);
                              const isEnabled = existing?.enabled === true;
                              const isAtLimit = !existing && draft.appExclusions.length >= MAX_APP_EXCLUSIONS;
                              return (
                                <button
                                  type="button"
                                  key={`${item.id}:${action.matchType}`}
                                  disabled={isEnabled || isAtLimit}
                                  title={isAtLimit ? `Excluded-app limit of ${MAX_APP_EXCLUSIONS} reached` : undefined}
                                  onClick={() => existing
                                    ? toggleExclusion(existing.id, true)
                                    : addExclusion(action.matchType, action.value, item.id)}
                                >
                                  {isEnabled ? action.addedLabel : existing ? action.enableLabel : action.label}
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
        ) : null}

        {activeTab === "about" ? (
          <div className="tab-layout">
            <section className="settings-section about">
              <h2>About</h2>
              <p>
                UseMyCurrentAccount++ is a local-first rewrite of Claire Novotny LLC's original Use My Current Account
                extension. It updates the extension for Chromium Manifest V3 and adds fail-closed account-picker behavior.
              </p>
              <p>
                Repository: <a href="https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus" target="_blank" rel="noreferrer">RobinMJD/UseMyCurrentAccount-PlusPlus</a>
              </p>
              <p>
                <a href="https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Privacy policy</a>
                {" · "}
                <a href="https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/blob/main/TERMS.md" target="_blank" rel="noreferrer">Terms of use</a>
                {" · "}
                <a href="https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/issues" target="_blank" rel="noreferrer">Support</a>
              </p>
            </section>
            <section className="settings-section">
              <div className="section-title">
                <div>
                  <h2>Privacy and limits</h2>
                  <p>Settings and diagnostics stay local to this browser profile.</p>
                </div>
                <HelpButton id="privacy-help" openHelpId={openHelpId} setOpenHelpId={setOpenHelpId} title="Privacy and limits">
                  The extension can control its own URL hints and picker clicks. It cannot clear cookies or prevent Microsoft from accepting an already-valid browser session.
                </HelpButton>
              </div>
              <ul className="plain-list">
                <li>No analytics, remote storage, or developer server.</li>
                <li>Diagnostics redact sensitive OAuth values such as state, nonce, claims, redirect_uri, and login_hint.</li>
                <li>App policies, MFA, consent, and existing sessions can still require or complete Microsoft prompts.</li>
              </ul>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

interface HelpButtonProps {
  children: ReactNode;
  id: string;
  openHelpId: string | undefined;
  setOpenHelpId: (id: string | undefined) => void;
  title: string;
}

function HelpButton({ children, id, openHelpId, setOpenHelpId, title }: HelpButtonProps) {
  const isOpen = openHelpId === id;
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverId = `help-popover-${id}`;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeOnOutsideClick(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpenHelpId(undefined);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenHelpId(undefined);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, setOpenHelpId]);

  return (
    <span
      className="help-wrapper"
      ref={wrapperRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpenHelpId(undefined);
        }
      }}
    >
      <button
        aria-describedby={isOpen ? popoverId : undefined}
        aria-expanded={isOpen}
        aria-label={`Help: ${title}`}
        className="help-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpenHelpId(isOpen ? undefined : id);
        }}
        type="button"
      >
        ?
      </button>
      {isOpen ? (
        <span className="help-popover" id={popoverId} role="tooltip">
          <strong>{title}</strong>
          <span>{children}</span>
        </span>
      ) : null}
    </span>
  );
}

function getAutomationScope(enabled: boolean, requireAppApproval: boolean): AutomationScope {
  if (!enabled) {
    return "off";
  }
  return requireAppApproval ? "approvedOnly" : "allApps";
}

function getAutomationScopeLabel(scope: AutomationScope): string {
  switch (scope) {
    case "off":
      return "Off";
    case "approvedOnly":
      return "Approved apps only";
    case "allApps":
    default:
      return "All Microsoft apps except exclusions";
  }
}

export function settingsToDraft(settings: UseMyCurrentAccountSettings) {
  return {
    enabled: settings.enabled,
    preferredUpn: settings.preferredUpn || "",
    aliasesText: settings.aliases.join("\n"),
    rewriteEnabled: settings.rewriteEnabled,
    autoPickEnabled: settings.autoPickEnabled,
    suppressSelectAccountPrompt: settings.suppressSelectAccountPrompt,
    requireAppApproval: settings.requireAppApproval,
    appApprovals: settings.appApprovals,
    appExclusions: settings.appExclusions
  };
}

function getDraftSignature(draft: SettingsDraft): string {
  return JSON.stringify(draft);
}

function analyzeAliases(value: string) {
  const aliases: string[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeUpn(rawValue);
    if (!normalized) {
      invalid.push(rawValue);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push(rawValue);
      continue;
    }
    seen.add(normalized);
    aliases.push(normalized);
  }

  return {
    aliases: aliases.slice(0, MAX_ALIASES),
    duplicates,
    invalid,
    totalValid: aliases.length,
    overLimit: Math.max(0, aliases.length - MAX_ALIASES)
  };
}

function formatDiagnosticTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

export function buildUsageStats(settings: UseMyCurrentAccountSettings): UsageStat[] {
  const counts = countDiagnostics(settings.diagnostics);
  const pickerAttempts = counts.autoPickedAccount + counts.noMatchingAccount + counts.multipleMatchingAccounts;
  const pickerSuccessRate = pickerAttempts
    ? `${Math.round((counts.autoPickedAccount / pickerAttempts) * 100)}%`
    : "n/a";
  const skippedDecisions =
    counts.approvalRequired + counts.disabled + counts.excludedApp + counts.missingPreferredAccount + counts.pickerSkipped;
  const activeControls = [
    settings.enabled,
    settings.rewriteEnabled,
    settings.autoPickEnabled,
    settings.suppressSelectAccountPrompt,
    settings.requireAppApproval
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
      label: "Approved apps",
      value: String(settings.appApprovals.filter((item) => item.enabled).length),
      hint: "Active application approval rules"
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
      hint: "Approval required, disabled, excluded app, missing account, or skipped picker"
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
      value: `${activeControls}/5`,
      hint: "Enabled behavior toggles"
    }
  ];
}

function countDiagnostics(diagnostics: DiagnosticEvent[]) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {
    approvalRequired: 0,
    autoPickedAccount: 0,
    disabled: 0,
    excludedApp: 0,
    lastSevenDays: 0,
    missingPreferredAccount: 0,
    multipleMatchingAccounts: 0,
    noMatchingAccount: 0,
    pickerSkipped: 0
  };

  for (const diagnostic of diagnostics) {
    const occurredAt = Date.parse(diagnostic.occurredAt);
    if (Number.isFinite(occurredAt) && occurredAt >= sevenDaysAgo) {
      counts.lastSevenDays += 1;
    }

    switch (diagnostic.kind) {
      case "approvalRequired":
        counts.approvalRequired += 1;
        break;
      case "autoPickedAccount":
        counts.autoPickedAccount += 1;
        break;
      case "disabled":
        counts.disabled += 1;
        break;
      case "excludedApp":
        counts.excludedApp += 1;
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
      default:
        break;
    }
  }

  return counts;
}

function findDraftRule<T extends AppRule>(
  rules: T[],
  matchType: AppExclusionMatchType,
  value: string | undefined
): T | undefined {
  const normalizedValue = normalizeAppExclusionValue(matchType, value);
  return normalizedValue
    ? rules.find((item) => item.matchType === matchType && item.value === normalizedValue)
    : undefined;
}

function getDiagnosticApprovalActions(item: DiagnosticEvent) {
  const actions: Array<{
    matchType: AppExclusionMatchType;
    value: string;
    label: string;
    addedLabel: string;
    enableLabel: string;
  }> = [];

  if (item.clientId) {
    actions.push({
      matchType: "clientId",
      value: item.clientId,
      label: "Allow client ID",
      addedLabel: "Client ID allowed",
      enableLabel: "Enable client ID"
    });
  }
  if (item.redirectHost) {
    actions.push({
      matchType: "redirectHost",
      value: item.redirectHost,
      label: "Allow host",
      addedLabel: "Host allowed",
      enableLabel: "Enable host"
    });
  }
  return actions;
}

function getDiagnosticExclusionActions(item: DiagnosticEvent) {
  const actions: Array<{
    matchType: AppExclusionMatchType;
    value: string;
    label: string;
    addedLabel: string;
    enableLabel: string;
  }> = [];

  if (item.clientId) {
    actions.push({
      matchType: "clientId",
      value: item.clientId,
      label: "Exclude client ID",
      addedLabel: "Client ID excluded",
      enableLabel: "Enable client ID exclusion"
    });
  }
  if (item.redirectHost) {
    actions.push({
      matchType: "redirectHost",
      value: item.redirectHost,
      label: "Exclude host",
      addedLabel: "Host excluded",
      enableLabel: "Enable host exclusion"
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
