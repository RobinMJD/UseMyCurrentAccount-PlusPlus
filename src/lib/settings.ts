export const SETTINGS_KEY = "useMyCurrentAccountPlus.settings.v1";

export type DiagnosticKind =
  | "urlRewritten"
  | "autoPickedAccount"
  | "noMatchingAccount"
  | "multipleMatchingAccounts"
  | "disabled"
  | "missingPreferredAccount"
  | "pickerSkipped"
  | "rulesUpdated"
  | "identityRefreshed"
  | "excludedApp"
  | "approvalRequired";

export type AppMatchType = "clientId" | "redirectHost";
export type AppExclusionMatchType = AppMatchType;
export type AppApprovalMatchType = AppMatchType;
export type AuthFlow = "oauth" | "saml" | "wsfed" | "unknown";

export interface AppRule {
  id: string;
  enabled: boolean;
  matchType: AppMatchType;
  value: string;
  label?: string;
  createdAt: string;
  sourceDiagnosticId?: string;
}

export type AppExclusion = AppRule;
export type AppApproval = AppRule;

export interface DiagnosticEvent {
  id: string;
  kind: DiagnosticKind;
  occurredAt: string;
  message: string;
  url?: string;
  sanitizedUrl?: string;
  preferredUpn?: string;
  matchedUpn?: string;
  flow?: AuthFlow;
  tenant?: string;
  clientId?: string;
  redirectHost?: string;
  redirectPath?: string;
  ruleId?: number;
  changedParams?: string[];
  exclusionId?: string;
  exclusionValue?: string;
  pickerTileCount?: number;
  pickerMatchCount?: number;
}

export interface UseMyCurrentAccountSettings {
  enabled: boolean;
  preferredUpn?: string;
  aliases: string[];
  rewriteEnabled: boolean;
  autoPickEnabled: boolean;
  suppressSelectAccountPrompt: boolean;
  requireAppApproval: boolean;
  appApprovals: AppApproval[];
  appExclusions: AppExclusion[];
  diagnostics: DiagnosticEvent[];
}

export type UserEditableSettings = Pick<
  UseMyCurrentAccountSettings,
  | "enabled"
  | "preferredUpn"
  | "aliases"
  | "rewriteEnabled"
  | "autoPickEnabled"
  | "suppressSelectAccountPrompt"
  | "requireAppApproval"
  | "appApprovals"
  | "appExclusions"
>;

export type UseMyCurrentAccountSettingsPatch = Partial<UserEditableSettings>;

export const DEFAULT_SETTINGS: UseMyCurrentAccountSettings = {
  enabled: true,
  preferredUpn: undefined,
  aliases: [],
  rewriteEnabled: true,
  autoPickEnabled: true,
  suppressSelectAccountPrompt: true,
  requireAppApproval: false,
  appApprovals: [],
  appExclusions: [],
  diagnostics: []
};

const MAX_ALIASES = 20;
const MAX_APP_APPROVALS = 30;
const MAX_APP_EXCLUSIONS = 30;
const MAX_DIAGNOSTICS = 60;
const MAX_MESSAGE_LENGTH = 220;
const MAX_URL_LENGTH = 500;
const MAX_SHORT_TEXT_LENGTH = 160;
const MAX_CHANGED_PARAMS = 10;
const UPN_PATTERN = /^[^\s@<>()[\]\\,;:"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const APP_EXCLUSION_VALUE_PATTERN = /^[A-Za-z0-9._~:/-]{1,160}$/;

export function isValidUpn(value: unknown): value is string {
  return typeof value === "string" && UPN_PATTERN.test(value.trim());
}

export function normalizeUpn(value: unknown): string | undefined {
  if (!isValidUpn(value)) {
    return undefined;
  }
  return value.trim().toLowerCase();
}

export function mergeSettings(input: unknown): UseMyCurrentAccountSettings {
  const source = isRecord(input) ? input : {};
  return {
    enabled: source.enabled !== false,
    preferredUpn: normalizeUpn(source.preferredUpn),
    aliases: sanitizeAliases(source.aliases),
    rewriteEnabled: source.rewriteEnabled !== false,
    autoPickEnabled: source.autoPickEnabled !== false,
    suppressSelectAccountPrompt: source.suppressSelectAccountPrompt !== false,
    requireAppApproval: source.requireAppApproval === true,
    appApprovals: sanitizeAppApprovals(source.appApprovals),
    appExclusions: sanitizeAppExclusions(source.appExclusions),
    diagnostics: sanitizeDiagnostics(source.diagnostics)
  };
}

export function sanitizeSettingsPatch(input: unknown): UseMyCurrentAccountSettingsPatch {
  const source = isRecord(input) ? input : {};
  const patch: UseMyCurrentAccountSettingsPatch = {};

  copyBooleanSetting(source, patch, "enabled");
  copyBooleanSetting(source, patch, "rewriteEnabled");
  copyBooleanSetting(source, patch, "autoPickEnabled");
  copyBooleanSetting(source, patch, "suppressSelectAccountPrompt");
  copyBooleanSetting(source, patch, "requireAppApproval");

  if (hasOwn(source, "preferredUpn")) {
    patch.preferredUpn = normalizeUpn(source.preferredUpn);
  }
  if (hasOwn(source, "aliases") && Array.isArray(source.aliases)) {
    patch.aliases = sanitizeAliases(source.aliases);
  }
  if (hasOwn(source, "appApprovals") && Array.isArray(source.appApprovals)) {
    patch.appApprovals = sanitizeAppApprovals(source.appApprovals);
  }
  if (hasOwn(source, "appExclusions") && Array.isArray(source.appExclusions)) {
    patch.appExclusions = sanitizeAppExclusions(source.appExclusions);
  }

  return patch;
}

export function applyProfileEmailPrefill(
  settings: UseMyCurrentAccountSettings,
  profileEmail: unknown
): UseMyCurrentAccountSettings {
  const preferredUpn = settings.preferredUpn || normalizeUpn(profileEmail);
  return mergeSettings({
    ...settings,
    preferredUpn
  });
}

export async function loadSettings(): Promise<UseMyCurrentAccountSettings> {
  const snapshot = await readSettingsSnapshot();
  return snapshot.settings;
}

let settingsMutationQueue: Promise<void> = Promise.resolve();

interface SettingsMutationContext {
  hasStoredSettingsRecord: boolean;
}

interface SettingsMutationOptions {
  writeIfMissing?: boolean;
}

export function mutateSettings(
  mutation: (
    settings: UseMyCurrentAccountSettings,
    context: SettingsMutationContext
  ) => UseMyCurrentAccountSettings,
  options: SettingsMutationOptions = {}
): Promise<UseMyCurrentAccountSettings> {
  const pendingMutation = settingsMutationQueue.then(async () => {
    const snapshot = await readSettingsSnapshot();
    const current = snapshot.settings;
    const next = mergeSettings(mutation(current, {
      hasStoredSettingsRecord: snapshot.hasStoredSettingsRecord
    }));
    if (
      snapshot.needsLegacyMigration ||
      !areSettingsEqual(current, next) ||
      (options.writeIfMissing !== false && !snapshot.hasStoredSettingsRecord)
    ) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    }
    return next;
  });

  settingsMutationQueue = pendingMutation.then(
    () => undefined,
    () => undefined
  );
  return pendingMutation;
}

export function migrateLegacySettings(): Promise<UseMyCurrentAccountSettings> {
  return mutateSettings((settings) => settings, { writeIfMissing: false });
}

export function prefillProfileEmailOnFreshInstall(
  profileEmail: unknown
): Promise<UseMyCurrentAccountSettings> {
  return mutateSettings(
    (settings, context) => context.hasStoredSettingsRecord
      ? settings
      : applyProfileEmailPrefill(settings, profileEmail),
    { writeIfMissing: false }
  );
}

export function updateSettings(
  patch: UseMyCurrentAccountSettingsPatch
): Promise<UseMyCurrentAccountSettings> {
  const sanitizedPatch = sanitizeSettingsPatch(patch);
  return mutateSettings((current) => ({ ...current, ...sanitizedPatch }));
}

export function appendDiagnostic(diagnostic: DiagnosticEvent): Promise<UseMyCurrentAccountSettings> {
  return mutateSettings((current) => addDiagnostic(current, diagnostic));
}

export function clearStoredDiagnostics(): Promise<UseMyCurrentAccountSettings> {
  return mutateSettings((current) => ({ ...current, diagnostics: [] }));
}

export function createDiagnostic(
  kind: DiagnosticKind,
  input: {
    id?: string;
    message: string;
    url?: string;
    sanitizedUrl?: string;
    preferredUpn?: string;
    matchedUpn?: string;
    flow?: AuthFlow;
    tenant?: string;
    clientId?: string;
    redirectHost?: string;
    redirectPath?: string;
    ruleId?: number;
    changedParams?: string[];
    exclusionId?: string;
    exclusionValue?: string;
    pickerTileCount?: number;
    pickerMatchCount?: number;
  },
  now = new Date()
): DiagnosticEvent {
  const occurredAt = now.toISOString();
  const sanitizedUrl = sanitizeDiagnosticUrl(input.sanitizedUrl) || sanitizeDiagnosticUrl(input.url);
  const clientId = normalizeAppExclusionValue("clientId", input.clientId);
  const redirectHost = normalizeAppExclusionValue("redirectHost", input.redirectHost);
  const exclusionValue = normalizeAppExclusionValue("clientId", input.exclusionValue) ||
    normalizeAppExclusionValue("redirectHost", input.exclusionValue) ||
    sanitizeText(input.exclusionValue, MAX_SHORT_TEXT_LENGTH);
  const id = sanitizeText(input.id, 120) || createDiagnosticId(kind, occurredAt, [
    sanitizedUrl,
    clientId,
    redirectHost,
    input.message
  ]);

  return {
    id,
    kind,
    occurredAt,
    message: sanitizeText(input.message, MAX_MESSAGE_LENGTH) || kind,
    ...(sanitizedUrl ? { sanitizedUrl } : {}),
    ...(isAuthFlow(input.flow) ? { flow: input.flow } : {}),
    ...(sanitizeText(input.tenant, MAX_SHORT_TEXT_LENGTH) ? { tenant: sanitizeText(input.tenant, MAX_SHORT_TEXT_LENGTH) } : {}),
    ...(clientId ? { clientId } : {}),
    ...(redirectHost ? { redirectHost } : {}),
    ...(sanitizeText(input.redirectPath, MAX_SHORT_TEXT_LENGTH) ? { redirectPath: sanitizeText(input.redirectPath, MAX_SHORT_TEXT_LENGTH) } : {}),
    ...(sanitizeRuleId(input.ruleId) !== undefined ? { ruleId: sanitizeRuleId(input.ruleId) } : {}),
    ...(sanitizeChangedParams(input.changedParams).length ? { changedParams: sanitizeChangedParams(input.changedParams) } : {}),
    ...(sanitizeText(input.exclusionId, 120) ? { exclusionId: sanitizeText(input.exclusionId, 120) } : {}),
    ...(exclusionValue ? { exclusionValue } : {}),
    ...(sanitizeCount(input.pickerTileCount) !== undefined ? { pickerTileCount: sanitizeCount(input.pickerTileCount) } : {}),
    ...(sanitizeCount(input.pickerMatchCount) !== undefined ? { pickerMatchCount: sanitizeCount(input.pickerMatchCount) } : {})
  };
}

export function addDiagnostic(
  settings: UseMyCurrentAccountSettings,
  diagnostic: DiagnosticEvent
): UseMyCurrentAccountSettings {
  return {
    ...settings,
    diagnostics: [diagnostic, ...settings.diagnostics].slice(0, MAX_DIAGNOSTICS)
  };
}

export async function recordDiagnostic(
  kind: DiagnosticKind,
  input: {
    message: string;
    url?: string;
    sanitizedUrl?: string;
    preferredUpn?: string;
    matchedUpn?: string;
    flow?: AuthFlow;
    tenant?: string;
    clientId?: string;
    redirectHost?: string;
    redirectPath?: string;
    ruleId?: number;
    changedParams?: string[];
    exclusionId?: string;
    exclusionValue?: string;
    pickerTileCount?: number;
    pickerMatchCount?: number;
  }
): Promise<UseMyCurrentAccountSettings> {
  return appendDiagnostic(createDiagnostic(kind, input));
}

export function normalizeAppExclusionValue(matchType: AppExclusionMatchType, value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (matchType === "redirectHost") {
    return normalizeHost(trimmed);
  }
  const normalized = trimmed.toLowerCase();
  return APP_EXCLUSION_VALUE_PATTERN.test(normalized) ? normalized : undefined;
}

export function createAppExclusion(
  matchType: AppExclusionMatchType,
  value: unknown,
  input: {
    label?: string;
    sourceDiagnosticId?: string;
    enabled?: boolean;
    createdAt?: string;
  } = {}
): AppExclusion | undefined {
  const normalizedValue = normalizeAppExclusionValue(matchType, value);
  if (!normalizedValue) {
    return undefined;
  }
  const createdAt = typeof input.createdAt === "string"
    ? sanitizeIsoDate(input.createdAt) || "1970-01-01T00:00:00.000Z"
    : new Date().toISOString();
  const id = createAppRuleId("excl", matchType, normalizedValue);
  return {
    id,
    enabled: input.enabled !== false,
    matchType,
    value: normalizedValue,
    ...(sanitizeText(input.label, 80) ? { label: sanitizeText(input.label, 80) } : {}),
    createdAt,
    ...(sanitizeText(input.sourceDiagnosticId, 120) ? { sourceDiagnosticId: sanitizeText(input.sourceDiagnosticId, 120) } : {})
  };
}

export function createAppApproval(
  matchType: AppApprovalMatchType,
  value: unknown,
  input: {
    label?: string;
    sourceDiagnosticId?: string;
    enabled?: boolean;
    createdAt?: string;
  } = {}
): AppApproval | undefined {
  const normalizedValue = normalizeAppExclusionValue(matchType, value);
  if (!normalizedValue) {
    return undefined;
  }
  const createdAt = typeof input.createdAt === "string"
    ? sanitizeIsoDate(input.createdAt) || "1970-01-01T00:00:00.000Z"
    : new Date().toISOString();
  const id = createAppRuleId("appr", matchType, normalizedValue);
  return {
    id,
    enabled: input.enabled !== false,
    matchType,
    value: normalizedValue,
    ...(sanitizeText(input.label, 80) ? { label: sanitizeText(input.label, 80) } : {}),
    createdAt,
    ...(sanitizeText(input.sourceDiagnosticId, 120) ? { sourceDiagnosticId: sanitizeText(input.sourceDiagnosticId, 120) } : {})
  };
}

function sanitizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const alias = normalizeUpn(item);
    if (!alias || seen.has(alias)) {
      continue;
    }
    seen.add(alias);
    result.push(alias);
    if (result.length >= MAX_ALIASES) {
      break;
    }
  }
  return result;
}

function copyBooleanSetting<K extends keyof UseMyCurrentAccountSettingsPatch>(
  source: Record<string, unknown>,
  patch: UseMyCurrentAccountSettingsPatch,
  key: K
): void {
  if (hasOwn(source, key) && typeof source[key] === "boolean") {
    (patch as Record<string, unknown>)[key] = source[key];
  }
}

function areSettingsEqual(
  first: UseMyCurrentAccountSettings,
  second: UseMyCurrentAccountSettings
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function readSettingsSnapshot(): Promise<{
  settings: UseMyCurrentAccountSettings;
  hasStoredSettingsRecord: boolean;
  needsLegacyMigration: boolean;
}> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const hasStoredSettingsRecord = hasOwn(result, SETTINGS_KEY);
  const stored = result[SETTINGS_KEY];
  return {
    settings: mergeSettings(stored),
    hasStoredSettingsRecord,
    needsLegacyMigration: isRecord(stored) && hasOwn(stored, "detectedProfileEmail")
  };
}

function hasOwn(source: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function sanitizeAppExclusions(value: unknown): AppExclusion[] {
  return sanitizeAppRules(value, createAppExclusion, MAX_APP_EXCLUSIONS);
}

function sanitizeAppApprovals(value: unknown): AppApproval[] {
  return sanitizeAppRules(value, createAppApproval, MAX_APP_APPROVALS);
}

function sanitizeAppRules<T extends AppRule>(
  value: unknown,
  createRule: (
    matchType: AppMatchType,
    ruleValue: unknown,
    input: { label?: string; sourceDiagnosticId?: string; enabled?: boolean; createdAt?: string }
  ) => T | undefined,
  maxItems: number
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isAppExclusionMatchType(item.matchType)) {
      continue;
    }
    const rule = createRule(item.matchType, item.value, {
      label: typeof item.label === "string" ? item.label : undefined,
      sourceDiagnosticId: typeof item.sourceDiagnosticId === "string" ? item.sourceDiagnosticId : undefined,
      enabled: item.enabled !== false,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "1970-01-01T00:00:00.000Z"
    });
    if (!rule) {
      continue;
    }
    const key = `${rule.matchType}:${rule.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(rule);
    if (result.length >= maxItems) {
      break;
    }
  }
  return result;
}

function sanitizeDiagnostics(value: unknown): DiagnosticEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_DIAGNOSTICS).flatMap((item) => {
    if (!isRecord(item) || !isDiagnosticKind(item.kind)) {
      return [];
    }
    const occurredAt = sanitizeIsoDate(item.occurredAt);
    const message = sanitizeText(item.message, MAX_MESSAGE_LENGTH);
    if (!occurredAt || !message) {
      return [];
    }
    const sanitizedUrl = sanitizeDiagnosticUrl(item.sanitizedUrl) || sanitizeDiagnosticUrl(item.url);
    return [
      {
        id: sanitizeText(item.id, 120) || `${occurredAt}:${item.kind}`,
        kind: item.kind,
        occurredAt,
        message,
        ...(sanitizedUrl ? { sanitizedUrl } : {}),
        ...(isAuthFlow(item.flow) ? { flow: item.flow } : {}),
        ...(sanitizeText(item.tenant, MAX_SHORT_TEXT_LENGTH) ? { tenant: sanitizeText(item.tenant, MAX_SHORT_TEXT_LENGTH) } : {}),
        ...(normalizeAppExclusionValue("clientId", item.clientId) ? { clientId: normalizeAppExclusionValue("clientId", item.clientId) } : {}),
        ...(normalizeAppExclusionValue("redirectHost", item.redirectHost) ? { redirectHost: normalizeAppExclusionValue("redirectHost", item.redirectHost) } : {}),
        ...(sanitizeText(item.redirectPath, MAX_SHORT_TEXT_LENGTH) ? { redirectPath: sanitizeText(item.redirectPath, MAX_SHORT_TEXT_LENGTH) } : {}),
        ...(sanitizeRuleId(item.ruleId) !== undefined ? { ruleId: sanitizeRuleId(item.ruleId) } : {}),
        ...(sanitizeChangedParams(item.changedParams).length ? { changedParams: sanitizeChangedParams(item.changedParams) } : {}),
        ...(sanitizeText(item.exclusionId, 120) ? { exclusionId: sanitizeText(item.exclusionId, 120) } : {}),
        ...(sanitizeText(item.exclusionValue, MAX_SHORT_TEXT_LENGTH) ? { exclusionValue: sanitizeText(item.exclusionValue, MAX_SHORT_TEXT_LENGTH) } : {}),
        ...(sanitizeCount(item.pickerTileCount) !== undefined ? { pickerTileCount: sanitizeCount(item.pickerTileCount) } : {}),
        ...(sanitizeCount(item.pickerMatchCount) !== undefined ? { pickerMatchCount: sanitizeCount(item.pickerMatchCount) } : {})
      }
    ];
  });
}

function sanitizeDiagnosticUrl(value: unknown): string | undefined {
  const text = sanitizeText(value, MAX_URL_LENGTH);
  if (!text) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }

  if (url.hostname.toLowerCase() !== "login.microsoftonline.com") {
    return sanitizeText(`${url.origin}${url.pathname}`, MAX_URL_LENGTH);
  }

  const display = new URL(`${url.origin}${url.pathname}`);
  for (const [key, paramValue] of url.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "client_id" ||
      normalizedKey === "domain_hint" ||
      normalizedKey === "redirect_host" ||
      normalizedKey === "whr"
    ) {
      display.searchParams.set(normalizedKey, sanitizeText(paramValue, MAX_SHORT_TEXT_LENGTH) || "");
    }
  }

  const redirectHost = getDiagnosticRedirectHost(url);
  if (redirectHost) {
    display.searchParams.set("redirect_host", redirectHost);
  }

  return sanitizeText(display.toString(), MAX_URL_LENGTH);
}

function getDiagnosticRedirectHost(url: URL): string | undefined {
  for (const name of ["redirect_uri", "wreply", "wtrealm", "realm"]) {
    const value = url.searchParams.get(name);
    if (!value) {
      continue;
    }
    const parsed = parseUrlLikeDiagnosticValue(value);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function parseUrlLikeDiagnosticValue(value: string): string | undefined {
  try {
    return normalizeAppExclusionValue("redirectHost", new URL(value).hostname);
  } catch {
    const schemeMatch = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
    return schemeMatch ? normalizeAppExclusionValue("redirectHost", schemeMatch[1]) : undefined;
  }
}

function normalizeHost(value: string): string | undefined {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.trim().toLowerCase();
    return APP_EXCLUSION_VALUE_PATTERN.test(host) && host.includes(".") ? host : undefined;
  } catch {
    const host = value.split(/[/:?#]/)[0]?.trim().toLowerCase();
    return host && APP_EXCLUSION_VALUE_PATTERN.test(host) && host.includes(".") ? host : undefined;
  }
}

function sanitizeChangedParams(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const param = sanitizeText(item, 40)?.replace(/[^A-Za-z0-9_.-]/g, "");
    if (!param || seen.has(param)) {
      continue;
    }
    seen.add(param);
    result.push(param);
    if (result.length >= MAX_CHANGED_PARAMS) {
      break;
    }
  }
  return result;
}

function sanitizeRuleId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function sanitizeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function sanitizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function isDiagnosticKind(value: unknown): value is DiagnosticKind {
  return (
    value === "urlRewritten" ||
    value === "autoPickedAccount" ||
    value === "noMatchingAccount" ||
    value === "multipleMatchingAccounts" ||
    value === "disabled" ||
    value === "missingPreferredAccount" ||
    value === "pickerSkipped" ||
    value === "rulesUpdated" ||
    value === "identityRefreshed" ||
    value === "excludedApp" ||
    value === "approvalRequired"
  );
}

function isAppExclusionMatchType(value: unknown): value is AppMatchType {
  return value === "clientId" || value === "redirectHost";
}

function isAuthFlow(value: unknown): value is AuthFlow {
  return value === "oauth" || value === "saml" || value === "wsfed" || value === "unknown";
}

function createAppRuleId(prefix: string, matchType: AppMatchType, value: string): string {
  return `${prefix}-${matchType}-${hashString(value)}`;
}

function createDiagnosticId(kind: DiagnosticKind, occurredAt: string, values: Array<string | undefined>): string {
  const stamp = occurredAt.replace(/\D/g, "");
  return `diag-${stamp}-${kind}-${hashString(values.filter(Boolean).join("|"))}-${createDiagnosticNonce()}`;
}

function createDiagnosticNonce(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) {
      return uuid.replace(/-/g, "").slice(0, 10);
    }
  } catch {
    // Fall back only in browser contexts where randomUUID is unavailable.
  }
  return Math.random().toString(36).slice(2, 12).padEnd(10, "0");
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
