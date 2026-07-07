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
  | "excludedApp";

export type AppExclusionMatchType = "clientId" | "redirectHost";
export type AuthFlow = "oauth" | "saml" | "wsfed" | "unknown";

export interface AppExclusion {
  id: string;
  enabled: boolean;
  matchType: AppExclusionMatchType;
  value: string;
  label?: string;
  createdAt: string;
  sourceDiagnosticId?: string;
}

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
  detectedProfileEmail?: string;
  aliases: string[];
  rewriteEnabled: boolean;
  autoPickEnabled: boolean;
  suppressSelectAccountPrompt: boolean;
  appExclusions: AppExclusion[];
  diagnostics: DiagnosticEvent[];
}

export const DEFAULT_SETTINGS: UseMyCurrentAccountSettings = {
  enabled: true,
  preferredUpn: undefined,
  detectedProfileEmail: undefined,
  aliases: [],
  rewriteEnabled: true,
  autoPickEnabled: true,
  suppressSelectAccountPrompt: true,
  appExclusions: [],
  diagnostics: []
};

const MAX_ALIASES = 20;
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

export function mergeSettings(input: Partial<UseMyCurrentAccountSettings> | undefined): UseMyCurrentAccountSettings {
  const source = isRecord(input) ? input : {};
  return {
    enabled: source.enabled !== false,
    preferredUpn: normalizeUpn(source.preferredUpn),
    detectedProfileEmail: normalizeUpn(source.detectedProfileEmail),
    aliases: sanitizeAliases(source.aliases),
    rewriteEnabled: source.rewriteEnabled !== false,
    autoPickEnabled: source.autoPickEnabled !== false,
    suppressSelectAccountPrompt: source.suppressSelectAccountPrompt !== false,
    appExclusions: sanitizeAppExclusions(source.appExclusions),
    diagnostics: sanitizeDiagnostics(source.diagnostics)
  };
}

export function applyDetectedProfileEmailPrefill(
  settings: UseMyCurrentAccountSettings,
  detectedEmail: unknown
): UseMyCurrentAccountSettings {
  const detectedProfileEmail = normalizeUpn(detectedEmail);
  return mergeSettings({
    ...settings,
    detectedProfileEmail,
    preferredUpn: settings.preferredUpn || detectedProfileEmail
  });
}

export async function loadSettings(): Promise<UseMyCurrentAccountSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY] as Partial<UseMyCurrentAccountSettings> | undefined);
}

export async function saveSettings(settings: UseMyCurrentAccountSettings): Promise<UseMyCurrentAccountSettings> {
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
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
  const url = sanitizeText(input.url, MAX_URL_LENGTH);
  const sanitizedUrl = sanitizeText(input.sanitizedUrl, MAX_URL_LENGTH);
  const clientId = normalizeAppExclusionValue("clientId", input.clientId);
  const redirectHost = normalizeAppExclusionValue("redirectHost", input.redirectHost);
  const exclusionValue = normalizeAppExclusionValue("clientId", input.exclusionValue) ||
    normalizeAppExclusionValue("redirectHost", input.exclusionValue) ||
    sanitizeText(input.exclusionValue, MAX_SHORT_TEXT_LENGTH);
  const id = sanitizeText(input.id, 120) || createDiagnosticId(kind, occurredAt, [
    url,
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
    ...(url ? { url } : {}),
    ...(sanitizedUrl ? { sanitizedUrl } : {}),
    ...(normalizeUpn(input.preferredUpn) ? { preferredUpn: normalizeUpn(input.preferredUpn) } : {}),
    ...(normalizeUpn(input.matchedUpn) ? { matchedUpn: normalizeUpn(input.matchedUpn) } : {}),
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
  const settings = await loadSettings();
  const next = addDiagnostic(settings, createDiagnostic(kind, input));
  return saveSettings(next);
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
  const id = createExclusionId(matchType, normalizedValue);
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

function sanitizeAppExclusions(value: unknown): AppExclusion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: AppExclusion[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isAppExclusionMatchType(item.matchType)) {
      continue;
    }
    const exclusion = createAppExclusion(item.matchType, item.value, {
      label: typeof item.label === "string" ? item.label : undefined,
      sourceDiagnosticId: typeof item.sourceDiagnosticId === "string" ? item.sourceDiagnosticId : undefined,
      enabled: item.enabled !== false,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "1970-01-01T00:00:00.000Z"
    });
    if (!exclusion) {
      continue;
    }
    const key = `${exclusion.matchType}:${exclusion.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(exclusion);
    if (result.length >= MAX_APP_EXCLUSIONS) {
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
    return [
      {
        id: sanitizeText(item.id, 120) || `${occurredAt}:${item.kind}`,
        kind: item.kind,
        occurredAt,
        message,
        ...(sanitizeText(item.url, MAX_URL_LENGTH) ? { url: sanitizeText(item.url, MAX_URL_LENGTH) } : {}),
        ...(sanitizeText(item.sanitizedUrl, MAX_URL_LENGTH) ? { sanitizedUrl: sanitizeText(item.sanitizedUrl, MAX_URL_LENGTH) } : {}),
        ...(normalizeUpn(item.preferredUpn) ? { preferredUpn: normalizeUpn(item.preferredUpn) } : {}),
        ...(normalizeUpn(item.matchedUpn) ? { matchedUpn: normalizeUpn(item.matchedUpn) } : {}),
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
    value === "excludedApp"
  );
}

function isAppExclusionMatchType(value: unknown): value is AppExclusionMatchType {
  return value === "clientId" || value === "redirectHost";
}

function isAuthFlow(value: unknown): value is AuthFlow {
  return value === "oauth" || value === "saml" || value === "wsfed" || value === "unknown";
}

function createExclusionId(matchType: AppExclusionMatchType, value: string): string {
  return `excl-${matchType}-${hashString(value)}`;
}

function createDiagnosticId(kind: DiagnosticKind, occurredAt: string, values: Array<string | undefined>): string {
  const stamp = occurredAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `diag-${stamp}-${kind}-${hashString(values.filter(Boolean).join("|"))}`;
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
