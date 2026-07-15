import type { RuntimeResponse } from "../lib/messages";
import { findMatchingAppApproval, findMatchingAppExclusion, getAppContextFromUrl } from "../lib/appContext";
import type { DiagnosticKind, UseMyCurrentAccountSettings } from "../lib/settings";

export interface AccountTile {
  element: HTMLElement;
  upn: string;
  text: string;
}

export interface PickerResult {
  action:
    | "picked"
    | "noMatch"
    | "multipleMatches"
    | "disabled"
    | "missingPreferredAccount"
    | "excludedApp"
    | "approvalRequired"
    | "notPicker";
  matchedUpns: string[];
  tile?: AccountTile;
  message: string;
  exclusionId?: string;
  exclusionValue?: string;
  pickerTileCount?: number;
  pickerMatchCount?: number;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CLICKABLE_SELECTOR = "button, [role='button'], [tabindex='0'], [data-test-id], .table, .row, .accountButton";
const HEADING_SELECTOR = "h1, h2, [role='heading']";
const UPN_PATTERN = /^[^\s@<>()[\]\\,;:"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const APP_CONTEXT_SESSION_KEY = "useMyCurrentAccountPlus.appContext.v1";
const APP_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
const PICKER_HEADING_PATTERNS = [
  /^pick an account$/iu,
  /^(?:choisir|sélectionner) un compte$/iu,
  /^(?:elige|elegir) una cuenta$/iu,
  /^konto auswählen$/iu,
  /^scegli un account$/iu,
  /^escolh(?:a|er) uma conta$/iu,
  /^een account kiezen$/iu,
  /^wybierz konto$/iu,
  /^アカウントを選択$/u,
  /^계정 선택$/u,
  /^选择(?:帐户|账户)$/u
];
const OTHER_ACCOUNT_PATTERNS = [
  /^use another account(?:$|\s)/iu,
  /^utiliser un autre compte(?:$|\s)/iu,
  /^usar otra cuenta(?:$|\s)/iu,
  /^anderes konto verwenden(?:$|\s)/iu,
  /^usa un altro account(?:$|\s)/iu,
  /^usar outra conta(?:$|\s)/iu,
  /^een ander account gebruiken(?:$|\s)/iu,
  /^użyj innego konta(?:$|\s)/iu,
  /^別のアカウントを使用する(?:$|\s)/u,
  /^다른 계정 사용(?:$|\s)/u,
  /^使用其他(?:帐户|账户)(?:$|\s)/u
];
let lastClickKey: string | undefined;
const recordedDiagnosticKeys = new Set<string>();

export function isAccountPickerPage(root: ParentNode = document): boolean {
  const headings = [...root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)];
  if (headings.some((heading) => isVisible(heading) && matchesAnyText(heading.textContent, PICKER_HEADING_PATTERNS))) {
    return true;
  }

  const hasAccountTile = findAccountTiles(root).length > 0;
  if (!hasAccountTile) {
    return false;
  }
  return [...root.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)].some(
    (candidate) => isVisible(candidate) && matchesAnyText(candidate.textContent, OTHER_ACCOUNT_PATTERNS)
  );
}

export function findAccountTiles(root: ParentNode = document): AccountTile[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)];
  const seenElements = new Set<HTMLElement>();
  const tiles: AccountTile[] = [];

  for (const candidate of candidates) {
    const element = getClickableElement(candidate);
    if (!element || seenElements.has(element) || !isVisible(element)) {
      continue;
    }
    seenElements.add(element);
    const text = normalizeWhitespace(element.textContent || "");
    if (!text || matchesAnyText(text, OTHER_ACCOUNT_PATTERNS)) {
      continue;
    }
    const upn = extractUpn(text);
    if (!upn) {
      continue;
    }
    tiles.push({ element, upn, text });
  }

  return dedupeTiles(tiles);
}

export function chooseAccountTile(
  root: ParentNode,
  settings: Pick<UseMyCurrentAccountSettings, "enabled" | "preferredUpn" | "aliases" | "autoPickEnabled"> &
    Partial<Pick<UseMyCurrentAccountSettings, "appApprovals" | "appExclusions" | "requireAppApproval">>,
  inputUrl = typeof location !== "undefined" ? location.href : ""
): PickerResult {
  if (!isAccountPickerPage(root)) {
    return { action: "notPicker", matchedUpns: [], message: "No Microsoft account picker was detected." };
  }
  if (!settings.enabled || !settings.autoPickEnabled) {
    return { action: "disabled", matchedUpns: [], message: "Auto-pick is disabled." };
  }
  if (!settings.preferredUpn) {
    return {
      action: "missingPreferredAccount",
      matchedUpns: [],
      message: "Auto-pick skipped because no account to auto select is configured."
    };
  }

  const appContext = getAppContextFromUrl(inputUrl);
  const exclusionMatch = findMatchingAppExclusion(appContext, settings.appExclusions || []);
  if (exclusionMatch) {
    return {
      action: "excludedApp",
      matchedUpns: [],
      message: "Auto-pick skipped because this app is excluded.",
      exclusionId: exclusionMatch.exclusion.id,
      exclusionValue: exclusionMatch.value,
      pickerTileCount: findAccountTiles(root).length,
      pickerMatchCount: 0
    };
  }

  if (settings.requireAppApproval && !findMatchingAppApproval(appContext, settings.appApprovals || [])) {
    return {
      action: "approvalRequired",
      matchedUpns: [],
      message: "Auto-pick skipped because this app is waiting for approval.",
      pickerTileCount: findAccountTiles(root).length,
      pickerMatchCount: 0
    };
  }

  const acceptedUpns = new Set([settings.preferredUpn, ...settings.aliases].map(normalizeUpn).filter(Boolean) as string[]);
  const tiles = findAccountTiles(root);
  const matches = tiles.filter((tile) => acceptedUpns.has(tile.upn));
  const matchedUpns = [...new Set(matches.map((match) => match.upn))];

  if (!matches.length) {
    return {
      action: "noMatch",
      matchedUpns: [],
      message: `No account tile matched the account to auto select.`,
      pickerTileCount: tiles.length,
      pickerMatchCount: 0
    };
  }
  if (matches.length > 1) {
    return {
      action: "multipleMatches",
      matchedUpns,
      message: "Multiple account tiles matched the account to auto select; no account was clicked.",
      pickerTileCount: tiles.length,
      pickerMatchCount: matches.length
    };
  }

  return {
    action: "picked",
    matchedUpns,
    tile: matches[0],
    message: "Selected the matching account tile.",
    pickerTileCount: tiles.length,
    pickerMatchCount: 1
  };
}

export function shouldRequestAppApproval(
  settings: Pick<UseMyCurrentAccountSettings, "enabled" | "preferredUpn"> &
    Partial<Pick<UseMyCurrentAccountSettings, "appApprovals" | "appExclusions" | "requireAppApproval">>,
  inputUrl = typeof location !== "undefined" ? location.href : ""
): boolean {
  if (!settings.enabled || !settings.preferredUpn || !settings.requireAppApproval) {
    return false;
  }

  const appContext = getAppContextFromUrl(inputUrl);
  if (appContext.flow === "unknown") {
    return false;
  }
  if (findMatchingAppExclusion(appContext, settings.appExclusions || [])) {
    return false;
  }
  return !findMatchingAppApproval(appContext, settings.appApprovals || []);
}

export async function runAccountPicker(root: ParentNode = document): Promise<PickerResult> {
  const settings = await getSettings();
  const appContextUrl = resolveAppContextUrl(location.href);
  await recordApprovalRequiredDiagnostic(root, settings, appContextUrl);
  const result = chooseAccountTile(root, settings, appContextUrl);
  await recordPickerDiagnostic(result, appContextUrl);

  if (result.action !== "picked" || !result.tile) {
    return result;
  }

  const clickKey = `${location.href}|${result.tile.upn}`;
  if (lastClickKey === clickKey) {
    return result;
  }
  lastClickKey = clickKey;
  clearRememberedAppContext();
  result.tile.element.click();
  return result;
}

export function resolveAppContextUrl(
  inputUrl: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = getSessionStorage(),
  now = Date.now()
): string {
  const currentContext = getAppContextFromUrl(inputUrl);
  if (currentContext.flow !== "unknown") {
    if (currentContext.clientId || currentContext.redirectHost) {
      const safeContextUrl = buildSafeAppContextUrl(inputUrl);
      if (safeContextUrl && storage) {
        try {
          storage.setItem(APP_CONTEXT_SESSION_KEY, JSON.stringify({ url: safeContextUrl, recordedAt: now }));
        } catch {
          // Session storage can be unavailable in restricted browser contexts.
        }
      }
      return inputUrl;
    }
    removeRememberedAppContext(storage);
    return inputUrl;
  }

  if (!storage) {
    return inputUrl;
  }
  try {
    const stored = JSON.parse(storage.getItem(APP_CONTEXT_SESSION_KEY) || "null") as {
      url?: unknown;
      recordedAt?: unknown;
    } | null;
    if (
      !stored ||
      typeof stored.url !== "string" ||
      typeof stored.recordedAt !== "number" ||
      now - stored.recordedAt > APP_CONTEXT_MAX_AGE_MS ||
      now < stored.recordedAt
    ) {
      removeRememberedAppContext(storage);
      return inputUrl;
    }
    const rememberedContext = getAppContextFromUrl(stored.url);
    if (rememberedContext.flow === "unknown" || (!rememberedContext.clientId && !rememberedContext.redirectHost)) {
      removeRememberedAppContext(storage);
      return inputUrl;
    }
    return stored.url;
  } catch {
    removeRememberedAppContext(storage);
    return inputUrl;
  }
}

async function getSettings(): Promise<UseMyCurrentAccountSettings> {
  const response = await sendRuntimeMessage<UseMyCurrentAccountSettings>({ action: "getSettings" });
  if (!response.success || !response.data) {
    throw new Error(response.error || "Could not load UseMyCurrentAccount++ settings.");
  }
  return response.data;
}

async function recordPickerDiagnostic(result: PickerResult, appContextUrl: string): Promise<void> {
  const kind = getDiagnosticKind(result.action);
  if (!kind) {
    return;
  }
  await sendDiagnostic(kind, result.message, appContextUrl, {
    exclusionId: result.exclusionId,
    exclusionValue: result.exclusionValue,
    pickerTileCount: result.pickerTileCount,
    pickerMatchCount: result.pickerMatchCount
  });
}

async function recordApprovalRequiredDiagnostic(
  root: ParentNode,
  settings: UseMyCurrentAccountSettings,
  appContextUrl: string
): Promise<void> {
  if (isAccountPickerPage(root) || !shouldRequestAppApproval(settings, appContextUrl)) {
    return;
  }

  await sendDiagnostic(
    "approvalRequired",
    "App automation is waiting for approval for this Microsoft sign-in request.",
    appContextUrl
  );
}

async function sendDiagnostic(
  kind: DiagnosticKind,
  message: string,
  appContextUrl: string,
  input: {
    ruleId?: number;
    changedParams?: string[];
    exclusionId?: string;
    exclusionValue?: string;
    pickerTileCount?: number;
    pickerMatchCount?: number;
  } = {}
): Promise<void> {
  const appContext = getAppContextFromUrl(appContextUrl);
  const diagnostic = {
    kind,
    occurredAt: new Date().toISOString(),
    message,
    sanitizedUrl: appContext.sanitizedUrl,
    flow: appContext.flow,
    tenant: appContext.tenant,
    clientId: appContext.clientId,
    redirectHost: appContext.redirectHost,
    redirectPath: appContext.redirectPath,
    ruleId: input.ruleId,
    changedParams: input.changedParams,
    exclusionId: input.exclusionId,
    exclusionValue: input.exclusionValue,
    pickerTileCount: input.pickerTileCount,
    pickerMatchCount: input.pickerMatchCount
  };
  const diagnosticKey = `${kind}|${diagnostic.sanitizedUrl || ""}|${diagnostic.exclusionValue || ""}|${diagnostic.pickerTileCount ?? ""}|${diagnostic.pickerMatchCount ?? ""}`;
  if (recordedDiagnosticKeys.has(diagnosticKey)) {
    return;
  }
  recordedDiagnosticKeys.add(diagnosticKey);
  await sendRuntimeMessage({ action: "recordPickerResult", diagnostic });
}

function getDiagnosticKind(action: PickerResult["action"]): DiagnosticKind | undefined {
  if (action === "picked") return "autoPickedAccount";
  if (action === "noMatch") return "noMatchingAccount";
  if (action === "multipleMatches") return "multipleMatchingAccounts";
  if (action === "disabled") return "disabled";
  if (action === "missingPreferredAccount") return "missingPreferredAccount";
  if (action === "excludedApp") return "excludedApp";
  if (action === "approvalRequired") return "approvalRequired";
  return undefined;
}

function sendRuntimeMessage<T>(message: unknown): Promise<RuntimeResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
      void chrome.runtime.lastError;
      resolve(response || { success: false, error: "No response from extension background." });
    });
  });
}

function getClickableElement(element: HTMLElement): HTMLElement | undefined {
  const clickable = element.closest<HTMLElement>(CLICKABLE_SELECTOR);
  return clickable || element;
}

function extractUpn(text: string): string | undefined {
  const matches = text.match(EMAIL_PATTERN) || [];
  for (const match of matches) {
    const normalized = normalizeUpn(match);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function normalizeUpn(value: unknown): string | undefined {
  if (typeof value !== "string" || !UPN_PATTERN.test(value.trim())) {
    return undefined;
  }
  return value.trim().toLowerCase();
}

function dedupeTiles(tiles: AccountTile[]): AccountTile[] {
  const result: AccountTile[] = [];
  for (const tile of tiles) {
    const existing = result.find((item) => item.upn === tile.upn && (item.element.contains(tile.element) || tile.element.contains(item.element)));
    if (!existing) {
      result.push(tile);
    }
  }
  return result;
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.offsetParent !== null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function matchesAnyText(value: string | null | undefined, patterns: RegExp[]): boolean {
  const text = normalizeWhitespace(value || "");
  return Boolean(text && patterns.some((pattern) => pattern.test(text)));
}

function buildSafeAppContextUrl(inputUrl: string): string | undefined {
  const context = getAppContextFromUrl(inputUrl);
  if (context.flow === "unknown" || (!context.clientId && !context.redirectHost)) {
    return undefined;
  }
  let source: URL;
  try {
    source = new URL(inputUrl);
  } catch {
    return undefined;
  }
  if (source.hostname.toLowerCase() !== "login.microsoftonline.com") {
    return undefined;
  }

  const safe = new URL(`${source.origin}${source.pathname}`);
  if (context.clientId) {
    safe.searchParams.set("client_id", context.clientId);
  }
  if (context.redirectHost) {
    safe.searchParams.set("redirect_uri", `https://${context.redirectHost}${context.redirectPath || ""}`);
  }
  return safe.toString();
}

function clearRememberedAppContext(): void {
  removeRememberedAppContext(getSessionStorage());
}

function removeRememberedAppContext(
  storage: Pick<Storage, "removeItem"> | undefined
): void {
  try {
    storage?.removeItem(APP_CONTEXT_SESSION_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

function getSessionStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

function start(): void {
  let timer: number | undefined;
  const schedule = () => {
    if (timer) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      void runAccountPicker().catch(() => undefined);
    }, 250);
  };

  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener("hashchange", schedule);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      schedule();
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.id && typeof document !== "undefined") {
  start();
}
