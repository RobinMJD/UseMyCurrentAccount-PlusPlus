import { getPreferredDomain } from "./authUrl";
import { type AppApproval, type AppExclusion, type AppMatchType, type UseMyCurrentAccountSettings } from "./settings";

const RULE_AUTHORIZE_HINTS = 1;
const RULE_AUTHORIZE_SELECT_ACCOUNT = 2;
const RULE_SAML_WSFED_WHR = 3;
const RULE_APPLICATION_LOGIN_HINT = 4;
const RULE_APPLICATION_DOMAIN_HINT = 5;
const RULE_APPLICATION_USERNAME_HINT = 6;
const RULE_OAUTH_ENCODED_QUERY_KEY_FAIL_CLOSED = 7;
const EXCLUSION_RULE_ID_START = 1000;
const APPROVAL_RULE_ID_START = 2000;
const MAX_EXCLUSION_RULES = 120;
const MAX_APPROVAL_RULES = 300;

interface ApprovedPromptRule {
  regexFilter: string;
  regexSubstitution: string;
}

export const MANAGED_DYNAMIC_RULE_IDS = [
  RULE_AUTHORIZE_HINTS,
  RULE_AUTHORIZE_SELECT_ACCOUNT,
  RULE_SAML_WSFED_WHR,
  RULE_APPLICATION_LOGIN_HINT,
  RULE_APPLICATION_DOMAIN_HINT,
  RULE_APPLICATION_USERNAME_HINT,
  RULE_OAUTH_ENCODED_QUERY_KEY_FAIL_CLOSED,
  ...Array.from({ length: MAX_EXCLUSION_RULES }, (_, index) => EXCLUSION_RULE_ID_START + index),
  ...Array.from({ length: MAX_APPROVAL_RULES }, (_, index) => APPROVAL_RULE_ID_START + index)
];

const MAIN_FRAME = "main_frame" as chrome.declarativeNetRequest.ResourceType;
const REDIRECT = "redirect" as chrome.declarativeNetRequest.RuleActionType;
const ALLOW = "allow" as chrome.declarativeNetRequest.RuleActionType;

export function buildDynamicRules(settings: UseMyCurrentAccountSettings): chrome.declarativeNetRequest.Rule[] {
  const preferredUpn = settings.preferredUpn || "";
  const preferredDomain = getPreferredDomain(preferredUpn) || "";
  const authorizeParamUpdates = [
    { key: "login_hint", value: preferredUpn },
    { key: "domain_hint", value: preferredDomain }
  ];

  return [
    ...buildApplicationOAuthHintAllowRules(),
    ...buildExclusionAllowRules(settings.appExclusions),
    ...(settings.requireAppApproval
      ? buildApprovalRedirectRules(
          settings.appApprovals,
          authorizeParamUpdates,
          preferredDomain,
          settings.suppressSelectAccountPrompt
        )
      : buildBroadRedirectRules(settings, authorizeParamUpdates, preferredDomain))
  ];
}

function buildApplicationOAuthHintAllowRules(): chrome.declarativeNetRequest.Rule[] {
  // Chromium matches transform keys as raw bytes, while Microsoft normalizes case and percent encoding.
  // Literal aliases are guarded directly. Any encoded top-level key fails closed because DNR cannot decode
  // it precisely within Chrome's compiled-regex limit; preserving the source request is safer than duplication.
  return [
    buildApplicationOAuthHintAllowRule(RULE_APPLICATION_LOGIN_HINT, "login_hint"),
    buildApplicationOAuthHintAllowRule(RULE_APPLICATION_DOMAIN_HINT, "domain_hint"),
    buildApplicationOAuthHintAllowRule(RULE_APPLICATION_USERNAME_HINT, "username"),
    buildOAuthEncodedQueryKeyFailClosedAllowRule()
  ];
}

function buildApplicationOAuthHintAllowRule(
  id: number,
  key: "login_hint" | "domain_hint" | "username"
): chrome.declarativeNetRequest.Rule {
  const encodedSpace = "(?:\\+|%20)*";

  return {
    id,
    priority: 10,
    action: { type: ALLOW },
    condition: {
      regexFilter:
        `^https://login\\.microsoftonline\\.com/[^/?#]+/oauth2(?:/v2\\.0)?/authorize\\?` +
        `(?:[^#&]*&)*${encodedSpace}${key}${encodedSpace}(?:=[^&#]*)?(?:[&#]|$)`,
      isUrlFilterCaseSensitive: false,
      resourceTypes: [MAIN_FRAME]
    }
  };
}

function buildOAuthEncodedQueryKeyFailClosedAllowRule(): chrome.declarativeNetRequest.Rule {
  return {
    id: RULE_OAUTH_ENCODED_QUERY_KEY_FAIL_CLOSED,
    priority: 10,
    action: { type: ALLOW },
    condition: {
      regexFilter:
        "^https://login\\.microsoftonline\\.com/[^/?#]+/oauth2(?:/v2\\.0)?/authorize\\?" +
        "(?:[^#&]*&)*(?:\\+|%20)*[^=&#]*%[0-9a-f]{2}[^=&#]*(?:=[^&#]*)?(?:[&#]|$)",
      isUrlFilterCaseSensitive: false,
      resourceTypes: [MAIN_FRAME]
    }
  };
}

export function buildActiveDynamicRules(
  settings: UseMyCurrentAccountSettings
): chrome.declarativeNetRequest.Rule[] {
  return settings.enabled && settings.rewriteEnabled && Boolean(settings.preferredUpn)
    ? buildDynamicRules(settings)
    : [];
}

export function getDynamicRulesStateKey(settings: UseMyCurrentAccountSettings): string {
  return JSON.stringify(buildActiveDynamicRules(settings));
}

function buildBroadRedirectRules(
  settings: UseMyCurrentAccountSettings,
  authorizeParamUpdates: chrome.declarativeNetRequest.QueryKeyValue[],
  preferredDomain: string
): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: RULE_AUTHORIZE_HINTS,
      priority: 1,
      action: {
        type: REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              removeParams: authorizeParamUpdates.map(({ key }) => key),
              addOrReplaceParams: authorizeParamUpdates
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://login\\.microsoftonline\\.com/[^?#]+/oauth2(/v2\\.0)?/authorize([?#].*)?$",
        resourceTypes: [MAIN_FRAME]
      }
    },
    {
      id: RULE_SAML_WSFED_WHR,
      priority: 1,
      action: {
        type: REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              removeParams: ["whr"],
              addOrReplaceParams: [{ key: "whr", value: preferredDomain }]
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://login\\.microsoftonline\\.com/[^?#]+/(saml2|wsfed)([?#].*)?$",
        resourceTypes: [MAIN_FRAME]
      }
    }
  ];

  if (settings.suppressSelectAccountPrompt) {
    rules.push({
      id: RULE_AUTHORIZE_SELECT_ACCOUNT,
      priority: 2,
      action: {
        type: REDIRECT,
        redirect: {
          regexSubstitution: "\\1\\2\\3"
        }
      },
      condition: {
        regexFilter: buildExactSelectAccountRegexFilter(),
        resourceTypes: [MAIN_FRAME]
      }
    });
  }

  return rules;
}

function buildApprovalRedirectRules(
  approvals: AppApproval[] = [],
  authorizeParamUpdates: chrome.declarativeNetRequest.QueryKeyValue[],
  preferredDomain: string,
  suppressSelectAccountPrompt: boolean
): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let ruleOffset = 0;

  for (const approval of approvals.filter((item) => item.enabled)) {
    if (ruleOffset >= MAX_APPROVAL_RULES) {
      break;
    }
    for (const oauthRegexFilter of buildAppMatchRegexFilters(approval, "oauth")) {
      if (ruleOffset >= MAX_APPROVAL_RULES) {
        break;
      }
      rules.push({
        id: APPROVAL_RULE_ID_START + ruleOffset,
        priority: 1,
        action: {
          type: REDIRECT,
          redirect: {
            transform: {
              queryTransform: {
                removeParams: authorizeParamUpdates.map(({ key }) => key),
                addOrReplaceParams: authorizeParamUpdates
              }
            }
          }
        },
        condition: {
          regexFilter: oauthRegexFilter,
          isUrlFilterCaseSensitive: false,
          resourceTypes: [MAIN_FRAME]
        }
      });
      ruleOffset += 1;
    }

    const exactPromptRules = suppressSelectAccountPrompt
      ? buildApprovedExactSelectAccountRegexFilters(approval)
      : [];
    for (const exactPromptRule of exactPromptRules) {
      if (ruleOffset >= MAX_APPROVAL_RULES) {
        break;
      }
      rules.push({
        id: APPROVAL_RULE_ID_START + ruleOffset,
        priority: 2,
        action: {
          type: REDIRECT,
          redirect: {
            regexSubstitution: exactPromptRule.regexSubstitution
          }
        },
        condition: {
          regexFilter: exactPromptRule.regexFilter,
          isUrlFilterCaseSensitive: false,
          requestDomains: ["login.microsoftonline.com"],
          resourceTypes: [MAIN_FRAME]
        }
      });
      ruleOffset += 1;
    }

    for (const federationRegexFilter of buildAppMatchRegexFilters(approval, "federation")) {
      if (ruleOffset >= MAX_APPROVAL_RULES) {
        break;
      }
      rules.push({
        id: APPROVAL_RULE_ID_START + ruleOffset,
        priority: 1,
        action: {
          type: REDIRECT,
          redirect: {
            transform: {
              queryTransform: {
                removeParams: ["whr"],
                addOrReplaceParams: [{ key: "whr", value: preferredDomain }]
              }
            }
          }
        },
        condition: {
          regexFilter: federationRegexFilter,
          isUrlFilterCaseSensitive: false,
          resourceTypes: [MAIN_FRAME]
        }
      });
      ruleOffset += 1;
    }
  }

  return rules;
}

function buildExclusionAllowRules(exclusions: AppExclusion[]): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let ruleOffset = 0;

  for (const exclusion of exclusions.filter((item) => item.enabled).slice(0, 30)) {
    for (const regexFilter of buildAppMatchRegexFilters(exclusion, "any")) {
      if (ruleOffset >= MAX_EXCLUSION_RULES) {
        return rules;
      }
      rules.push({
        id: EXCLUSION_RULE_ID_START + ruleOffset,
        priority: 100,
        action: { type: ALLOW },
        condition: {
          regexFilter,
          isUrlFilterCaseSensitive: false,
          resourceTypes: [MAIN_FRAME]
        }
      });
      ruleOffset += 1;
    }
  }

  return rules;
}

function buildAppMatchRegexFilters(
  rule: { matchType: AppMatchType; value: string },
  flow: "any" | "oauth" | "federation"
): string[] {
  if (rule.matchType === "clientId") {
    if (flow === "federation") {
      return [];
    }
    const value = escapeRegex(encodeURIComponent(rule.value));
    return [
      `^https://login\\.microsoftonline\\.com/[^?#]+/oauth2(?:/v2\\.0)?/authorize\\?(?:[^#&]+&)*client_id=${value}(?:[&#]|$)`
    ];
  }

  const host = escapeRegex(rule.value);
  if (flow === "any") {
    return [
      ...buildRedirectHostRegexFilters(host, "oauth"),
      ...buildRedirectHostRegexFilters(host, "federation")
    ];
  }
  return buildRedirectHostRegexFilters(host, flow);
}

function buildRedirectHostRegexFilters(
  escapedHost: string,
  flow: "oauth" | "federation"
): string[] {
  const pathPattern = flow === "oauth" ? "oauth2(?:/v2\\.0)?/authorize" : "(?:saml2|wsfed)";
  const parameterPattern = flow === "oauth" ? "redirect_uri" : "(?:wreply|wtrealm|realm)";
  const prefix = `^https://login\\.microsoftonline\\.com/[^?#]+/${pathPattern}\\?(?:[^#&]+&)*${parameterPattern}=`;

  return [
    `${prefix}https?://${escapedHost}(?::[0-9]+)?(?:[/?#&]|$)`,
    `${prefix}https?%3a%2f%2f${escapedHost}(?:%3a[0-9]+)?(?:%2f|%3f|%23|[&#]|$)`
  ];
}

function buildExactSelectAccountRegexFilter(): string {
  const authorizeUrl = "https://login\\.microsoftonline\\.com/[^?#]+/oauth2(?:/v2\\.0)?/authorize";
  return `^(${authorizeUrl}\\?(?:[^#&]+&)*)prompt=select_account(?:&([^#]*))?(#.*)?$`;
}

function buildApprovedExactSelectAccountRegexFilters(
  approval: Pick<AppApproval, "matchType" | "value">
): ApprovedPromptRule[] {
  return buildAppQueryParamPatterns(approval).flatMap((appParam) => [
    {
      regexFilter: `([?&]${appParam}&(?:[^#&]+&)*)prompt=select_account&`,
      regexSubstitution: "\\1"
    },
    {
      regexFilter: `([?&]${appParam}&(?:[^#&]+&)*)prompt=select_account(#|$)`,
      regexSubstitution: "\\1\\2"
    },
    {
      regexFilter: `([?&])prompt=select_account&((?:[^#&]+&)*${appParam})([&#]|$)`,
      regexSubstitution: "\\1\\2\\3"
    }
  ]);
}

function buildAppQueryParamPatterns(
  rule: Pick<AppApproval, "matchType" | "value">
): string[] {
  if (rule.matchType === "clientId") {
    return [`client_id=${escapeRegex(encodeURIComponent(rule.value))}`];
  }

  const host = escapeRegex(rule.value);
  return [
    `redirect_uri=https?://${host}(?::[0-9]+)?(?:[/?#][^&#]*|)`,
    `redirect_uri=https?%3a%2f%2f${host}(?:%3a[0-9]+)?(?:%(?:2f|3f|23)[^&#]*|)`
  ];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
