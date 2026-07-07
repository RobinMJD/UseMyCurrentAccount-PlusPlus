import {
  normalizeAppExclusionValue,
  type AppExclusion,
  type AppExclusionMatchType,
  type AuthFlow
} from "./settings";

export interface AppContext {
  flow: AuthFlow;
  tenant?: string;
  clientId?: string;
  redirectHost?: string;
  redirectPath?: string;
  sanitizedUrl?: string;
}

export interface AppExclusionMatch {
  exclusion: AppExclusion;
  matchType: AppExclusionMatchType;
  value: string;
}

const MICROSOFT_LOGIN_HOST = "login.microsoftonline.com";
const SAFE_QUERY_PARAMS = new Set(["client_id", "login_hint", "domain_hint", "whr"]);
const URL_PARAM_NAMES = ["redirect_uri", "wreply", "wtrealm", "realm"];

export function getAppContextFromUrl(inputUrl: string): AppContext {
  const url = parseUrl(inputUrl);
  if (!url) {
    return { flow: "unknown" };
  }

  const path = url.pathname.toLowerCase();
  const tenant = sanitizeTenant(url.pathname.split("/").filter(Boolean)[0]);
  const flow = getFlow(path);
  const clientId = normalizeAppExclusionValue("clientId", getSearchParam(url, "client_id"));
  const redirectInfo = getRedirectInfo(url);
  const context: AppContext = {
    flow,
    ...(tenant ? { tenant } : {}),
    ...(clientId ? { clientId } : {}),
    ...(redirectInfo.host ? { redirectHost: redirectInfo.host } : {}),
    ...(redirectInfo.path ? { redirectPath: redirectInfo.path } : {})
  };
  return {
    ...context,
    sanitizedUrl: buildSanitizedDisplayUrl(url, context)
  };
}

export function findMatchingAppExclusion(
  context: AppContext,
  exclusions: AppExclusion[] = []
): AppExclusionMatch | undefined {
  for (const exclusion of exclusions) {
    if (!exclusion.enabled) {
      continue;
    }
    if (exclusion.matchType === "clientId" && context.clientId === exclusion.value) {
      return { exclusion, matchType: "clientId", value: exclusion.value };
    }
    if (exclusion.matchType === "redirectHost" && context.redirectHost === exclusion.value) {
      return { exclusion, matchType: "redirectHost", value: exclusion.value };
    }
  }
  return undefined;
}

export function sanitizeStoredDiagnosticUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return getAppContextFromUrl(value).sanitizedUrl || sanitizeText(value, 500);
}

function getFlow(path: string): AuthFlow {
  if (/\/oauth2(?:\/v2\.0)?\/authorize$/.test(path)) {
    return "oauth";
  }
  if (path.endsWith("/saml2")) {
    return "saml";
  }
  if (path.endsWith("/wsfed")) {
    return "wsfed";
  }
  return "unknown";
}

function getRedirectInfo(url: URL): { host?: string; path?: string } {
  for (const name of URL_PARAM_NAMES) {
    const value = getSearchParam(url, name);
    const parsed = parseUrlLikeValue(value);
    if (parsed.host) {
      return parsed;
    }
  }
  return {};
}

function parseUrlLikeValue(value: string | undefined): { host?: string; path?: string } {
  if (!value) {
    return {};
  }
  const directUrl = parseUrl(value);
  if (directUrl) {
    return {
      host: normalizeAppExclusionValue("redirectHost", directUrl.hostname),
      path: sanitizePath(directUrl.pathname)
    };
  }

  const schemeMatch = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)?/i);
  if (!schemeMatch) {
    return {};
  }
  return {
    host: normalizeAppExclusionValue("redirectHost", schemeMatch[1]),
    path: sanitizePath(schemeMatch[2])
  };
}

function buildSanitizedDisplayUrl(url: URL, context: AppContext): string | undefined {
  if (url.hostname.toLowerCase() !== MICROSOFT_LOGIN_HOST) {
    return sanitizeText(`${url.origin}${url.pathname}`, 500);
  }

  const display = new URL(`${url.origin}${url.pathname}`);
  for (const [key, value] of url.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (SAFE_QUERY_PARAMS.has(normalizedKey)) {
      display.searchParams.set(normalizedKey, sanitizeText(value, 120) || "");
    }
  }
  if (context.redirectHost) {
    display.searchParams.set("redirect_host", context.redirectHost);
  }
  return display.toString();
}

function getSearchParam(url: URL, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLowerCase() === target && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function sanitizeTenant(value: string | undefined): string | undefined {
  return sanitizeText(value, 120)?.replace(/[^A-Za-z0-9._-]/g, "").toLowerCase() || undefined;
}

function sanitizePath(value: string | undefined): string | undefined {
  const path = sanitizeText(value, 160);
  if (!path || path === "/") {
    return undefined;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parseUrl(input: string | undefined): URL | undefined {
  if (!input) {
    return undefined;
  }
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}
