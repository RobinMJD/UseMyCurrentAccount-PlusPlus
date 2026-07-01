import {
  createDiagnostic,
  mergeSettings,
  type DiagnosticEvent,
  type DiagnosticKind,
  type UseMyCurrentAccountSettings
} from "./settings";

export type UseMyCurrentAccountMessage =
  | { action: "getSettings" }
  | { action: "saveSettings"; settings: UseMyCurrentAccountSettings }
  | { action: "recordPickerResult"; diagnostic: DiagnosticEvent }
  | { action: "clearDiagnostics" };

export interface RuntimeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export function validateUseMyCurrentAccountMessage(message: unknown): UseMyCurrentAccountMessage {
  if (!isRecord(message) || typeof message.action !== "string") {
    throw new Error("Unsupported UseMyCurrentAccount++ message.");
  }

  if (message.action === "getSettings" || message.action === "clearDiagnostics") {
    return { action: message.action };
  }

  if (message.action === "saveSettings") {
    return {
      action: "saveSettings",
      settings: mergeSettings(isRecord(message.settings) ? message.settings : undefined)
    };
  }

  if (message.action === "recordPickerResult") {
    if (!isRecord(message.diagnostic) || !isDiagnosticKind(message.diagnostic.kind)) {
      throw new Error("Picker diagnostic is malformed.");
    }
    return {
      action: "recordPickerResult",
      diagnostic: createDiagnostic(message.diagnostic.kind, {
        message: typeof message.diagnostic.message === "string" ? message.diagnostic.message : String(message.diagnostic.kind),
        url: typeof message.diagnostic.url === "string" ? message.diagnostic.url : undefined,
        preferredUpn: typeof message.diagnostic.preferredUpn === "string" ? message.diagnostic.preferredUpn : undefined,
        matchedUpn: typeof message.diagnostic.matchedUpn === "string" ? message.diagnostic.matchedUpn : undefined
      })
    };
  }

  throw new Error("Unsupported UseMyCurrentAccount++ message.");
}

export function isTrustedRuntimeSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id;
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
