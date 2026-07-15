import {
  findMatchingAppApproval,
  findMatchingAppExclusion,
  getAppContextFromUrl,
  type AppApprovalMatch,
  type AppContext,
  type AppExclusionMatch
} from "./appContext";
import type { UseMyCurrentAccountSettings } from "./settings";

export interface AuthUrlTransform {
  shouldRedirect: boolean;
  redirectUrl?: string;
  changedParams: string[];
  skippedReason?:
    | "disabled"
    | "missingPreferredAccount"
    | "unsupportedUrl"
    | "unchanged"
    | "excludedApp"
    | "approvalRequired";
  appContext?: AppContext;
  exclusionMatch?: AppExclusionMatch;
  approvalMatch?: AppApprovalMatch;
}

const MICROSOFT_LOGIN_HOST = "login.microsoftonline.com";

export function getPreferredDomain(preferredUpn: string | undefined): string | undefined {
  const domain = preferredUpn?.split("@").at(1)?.trim().toLowerCase();
  return domain || undefined;
}

export function shouldRewriteMicrosoftLoginUrl(inputUrl: string): boolean {
  const url = parseUrl(inputUrl);
  if (!url || url.hostname.toLowerCase() !== MICROSOFT_LOGIN_HOST) {
    return false;
  }
  const path = url.pathname.toLowerCase();
  return isAuthorizePath(path) || isSamlOrWsfedPath(path);
}

export function buildAuthUrlTransform(
  inputUrl: string,
  settings: Pick<
    UseMyCurrentAccountSettings,
    "enabled" | "preferredUpn" | "rewriteEnabled" | "suppressSelectAccountPrompt"
  > &
    Partial<Pick<UseMyCurrentAccountSettings, "appApprovals" | "appExclusions" | "requireAppApproval">>
): AuthUrlTransform {
  if (!settings.enabled || !settings.rewriteEnabled) {
    return { shouldRedirect: false, changedParams: [], skippedReason: "disabled" };
  }
  if (!settings.preferredUpn) {
    return { shouldRedirect: false, changedParams: [], skippedReason: "missingPreferredAccount" };
  }

  const url = parseUrl(inputUrl);
  if (!url || url.hostname.toLowerCase() !== MICROSOFT_LOGIN_HOST) {
    return { shouldRedirect: false, changedParams: [], skippedReason: "unsupportedUrl" };
  }

  const changedParams: string[] = [];
  const path = url.pathname.toLowerCase();
  const domain = getPreferredDomain(settings.preferredUpn);
  const appContext = getAppContextFromUrl(inputUrl);
  const exclusionMatch = findMatchingAppExclusion(appContext, settings.appExclusions);
  const approvalMatch = findMatchingAppApproval(appContext, settings.appApprovals);

  if (exclusionMatch) {
    return {
      shouldRedirect: false,
      changedParams: [],
      skippedReason: "excludedApp",
      appContext,
      exclusionMatch
    };
  }

  if (settings.requireAppApproval && !approvalMatch) {
    return {
      shouldRedirect: false,
      changedParams: [],
      skippedReason: "approvalRequired",
      appContext
    };
  }

  if (isAuthorizePath(path)) {
    setSearchParam(url, "login_hint", settings.preferredUpn, changedParams);
    if (domain) {
      setSearchParam(url, "domain_hint", domain, changedParams);
    }
    if (settings.suppressSelectAccountPrompt) {
      removeSelectAccountPrompt(url, changedParams);
    }
  } else if (isSamlOrWsfedPath(path)) {
    if (domain) {
      setSearchParam(url, "whr", domain, changedParams);
    }
  } else {
    return { shouldRedirect: false, changedParams: [], skippedReason: "unsupportedUrl" };
  }

  if (!changedParams.length || url.toString() === inputUrl) {
    return { shouldRedirect: false, changedParams, skippedReason: "unchanged" };
  }

  return {
    shouldRedirect: true,
    redirectUrl: url.toString(),
    changedParams,
    appContext,
    ...(approvalMatch ? { approvalMatch } : {})
  };
}

function setSearchParam(url: URL, name: string, value: string, changedParams: string[]): void {
  const currentValues = url.searchParams.getAll(name);
  if (currentValues.length === 1 && currentValues[0] === value) {
    return;
  }
  url.searchParams.set(name, value);
  changedParams.push(name);
}

function removeSelectAccountPrompt(url: URL, changedParams: string[]): void {
  const prompts = url.searchParams.getAll("prompt");
  if (!prompts.includes("select_account")) {
    return;
  }
  url.searchParams.delete("prompt");
  for (const prompt of prompts) {
    if (prompt !== "select_account") {
      url.searchParams.append("prompt", prompt);
    }
  }
  changedParams.push("prompt");
}

function isAuthorizePath(path: string): boolean {
  return /\/oauth2(?:\/v2\.0)?\/authorize$/.test(path);
}

function isSamlOrWsfedPath(path: string): boolean {
  return path.endsWith("/saml2") || path.endsWith("/wsfed");
}

function parseUrl(inputUrl: string): URL | undefined {
  try {
    return new URL(inputUrl);
  } catch {
    return undefined;
  }
}
