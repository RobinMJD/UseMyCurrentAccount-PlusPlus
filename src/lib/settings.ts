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
  | "identityRefreshed";

export interface DiagnosticEvent {
  id: string;
  kind: DiagnosticKind;
  occurredAt: string;
  message: string;
  url?: string;
  preferredUpn?: string;
  matchedUpn?: string;
}

export interface UseMyCurrentAccountSettings {
  enabled: boolean;
  preferredUpn?: string;
  detectedProfileEmail?: string;
  aliases: string[];
  rewriteEnabled: boolean;
  autoPickEnabled: boolean;
  suppressSelectAccountPrompt: boolean;
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
  diagnostics: []
};

const MAX_ALIASES = 20;
const MAX_DIAGNOSTICS = 60;
const MAX_MESSAGE_LENGTH = 220;
const MAX_URL_LENGTH = 500;
const UPN_PATTERN = /^[^\s@<>()[\]\\,;:"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

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
    diagnostics: sanitizeDiagnostics(source.diagnostics)
  };
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
    message: string;
    url?: string;
    preferredUpn?: string;
    matchedUpn?: string;
  },
  now = new Date()
): DiagnosticEvent {
  return {
    id: `${now.toISOString()}:${kind}:${Math.random().toString(36).slice(2, 10)}`,
    kind,
    occurredAt: now.toISOString(),
    message: sanitizeText(input.message, MAX_MESSAGE_LENGTH) || kind,
    ...(sanitizeText(input.url, MAX_URL_LENGTH) ? { url: sanitizeText(input.url, MAX_URL_LENGTH) } : {}),
    ...(normalizeUpn(input.preferredUpn) ? { preferredUpn: normalizeUpn(input.preferredUpn) } : {}),
    ...(normalizeUpn(input.matchedUpn) ? { matchedUpn: normalizeUpn(input.matchedUpn) } : {})
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
    preferredUpn?: string;
    matchedUpn?: string;
  }
): Promise<UseMyCurrentAccountSettings> {
  const settings = await loadSettings();
  const next = addDiagnostic(settings, createDiagnostic(kind, input));
  return saveSettings(next);
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
        ...(normalizeUpn(item.preferredUpn) ? { preferredUpn: normalizeUpn(item.preferredUpn) } : {}),
        ...(normalizeUpn(item.matchedUpn) ? { matchedUpn: normalizeUpn(item.matchedUpn) } : {})
      }
    ];
  });
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
    value === "identityRefreshed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
