import type { RuntimeResponse } from "../lib/messages";
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
    | "notPicker";
  matchedUpns: string[];
  tile?: AccountTile;
  message: string;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CLICKABLE_SELECTOR = "button, [role='button'], [tabindex='0'], [data-test-id], .table, .row, .accountButton";
const UPN_PATTERN = /^[^\s@<>()[\]\\,;:"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
let lastClickKey: string | undefined;
const recordedDiagnosticKeys = new Set<string>();

export function isAccountPickerPage(root: ParentNode = document): boolean {
  const text = (root instanceof Document ? root.body?.textContent : root.textContent) || "";
  return /\bpick an account\b/i.test(text);
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
    if (!text || /use another account/i.test(text)) {
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
  settings: Pick<UseMyCurrentAccountSettings, "enabled" | "preferredUpn" | "aliases" | "autoPickEnabled">
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
      message: "Auto-pick skipped because no preferred account is configured."
    };
  }

  const acceptedUpns = new Set([settings.preferredUpn, ...settings.aliases].map(normalizeUpn).filter(Boolean) as string[]);
  const matches = findAccountTiles(root).filter((tile) => acceptedUpns.has(tile.upn));
  const matchedUpns = [...new Set(matches.map((match) => match.upn))];

  if (!matches.length) {
    return {
      action: "noMatch",
      matchedUpns: [],
      message: `No account tile matched ${settings.preferredUpn}.`
    };
  }
  if (matches.length > 1) {
    return {
      action: "multipleMatches",
      matchedUpns,
      message: `Multiple account tiles matched ${settings.preferredUpn}; no account was clicked.`
    };
  }

  return {
    action: "picked",
    matchedUpns,
    tile: matches[0],
    message: `Selected ${matches[0].upn}.`
  };
}

export async function runAccountPicker(root: ParentNode = document): Promise<PickerResult> {
  const settings = await getSettings();
  await recordUrlPreparedDiagnostic(settings);
  const result = chooseAccountTile(root, settings);
  await recordPickerDiagnostic(result, settings);

  if (result.action !== "picked" || !result.tile) {
    return result;
  }

  const clickKey = `${location.href}|${result.tile.upn}`;
  if (lastClickKey === clickKey) {
    return result;
  }
  lastClickKey = clickKey;
  result.tile.element.click();
  return result;
}

async function getSettings(): Promise<UseMyCurrentAccountSettings> {
  const response = await sendRuntimeMessage<UseMyCurrentAccountSettings>({ action: "getSettings" });
  if (!response.success || !response.data) {
    throw new Error(response.error || "Could not load UseMyCurrentAccount++ settings.");
  }
  return response.data;
}

async function recordPickerDiagnostic(result: PickerResult, settings: UseMyCurrentAccountSettings): Promise<void> {
  const kind = getDiagnosticKind(result.action);
  if (!kind) {
    return;
  }
  await sendDiagnostic(kind, result.message, settings, result.matchedUpns[0]);
}

async function recordUrlPreparedDiagnostic(settings: UseMyCurrentAccountSettings): Promise<void> {
  if (!settings.enabled || !settings.rewriteEnabled || !settings.preferredUpn) {
    return;
  }
  const url = parseCurrentUrl();
  if (!url || url.hostname.toLowerCase() !== "login.microsoftonline.com") {
    return;
  }
  const domain = getPreferredDomain(settings.preferredUpn);
  const path = url.pathname.toLowerCase();
  const hasAuthorizeHint =
    /\/oauth2(?:\/v2\.0)?\/authorize$/.test(path) &&
    (url.searchParams.get("login_hint") === settings.preferredUpn || url.searchParams.get("domain_hint") === domain);
  const hasFederationHint =
    (path.endsWith("/saml2") || path.endsWith("/wsfed")) &&
    Boolean(domain && url.searchParams.get("whr") === domain);
  if (!hasAuthorizeHint && !hasFederationHint) {
    return;
  }
  await sendDiagnostic("urlRewritten", `Microsoft sign-in URL is prepared for ${settings.preferredUpn}.`, settings);
}

async function sendDiagnostic(
  kind: DiagnosticKind,
  message: string,
  settings: UseMyCurrentAccountSettings,
  matchedUpn?: string
): Promise<void> {
  const diagnostic = {
    id: `${new Date().toISOString()}:${kind}`,
    kind,
    occurredAt: new Date().toISOString(),
    message,
    url: location.href,
    preferredUpn: settings.preferredUpn,
    matchedUpn
  };
  const diagnosticKey = `${kind}|${diagnostic.url}|${diagnostic.preferredUpn || ""}|${diagnostic.matchedUpn || ""}`;
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

function getPreferredDomain(preferredUpn: string | undefined): string | undefined {
  return preferredUpn?.split("@").at(1)?.trim().toLowerCase() || undefined;
}

function parseCurrentUrl(): URL | undefined {
  try {
    return new URL(location.href);
  } catch {
    return undefined;
  }
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
