import { getPreferredDomain } from "./authUrl";
import { type AppExclusion, type UseMyCurrentAccountSettings } from "./settings";

const RULE_AUTHORIZE_HINTS = 1;
const RULE_AUTHORIZE_SELECT_ACCOUNT = 2;
const RULE_SAML_WSFED_WHR = 3;
const EXCLUSION_RULE_ID_START = 1000;
const MAX_EXCLUSION_RULES = 30;

export const MANAGED_DYNAMIC_RULE_IDS = [
  RULE_AUTHORIZE_HINTS,
  RULE_AUTHORIZE_SELECT_ACCOUNT,
  RULE_SAML_WSFED_WHR,
  ...Array.from({ length: MAX_EXCLUSION_RULES }, (_, index) => EXCLUSION_RULE_ID_START + index)
];

const MAIN_FRAME = "main_frame" as chrome.declarativeNetRequest.ResourceType;
const SUB_FRAME = "sub_frame" as chrome.declarativeNetRequest.ResourceType;
const REDIRECT = "redirect" as chrome.declarativeNetRequest.RuleActionType;
const ALLOW = "allow" as chrome.declarativeNetRequest.RuleActionType;

export function buildDynamicRules(settings: UseMyCurrentAccountSettings): chrome.declarativeNetRequest.Rule[] {
  const preferredUpn = settings.preferredUpn || "";
  const preferredDomain = getPreferredDomain(preferredUpn) || "";
  const authorizeParamUpdates = [
    { key: "login_hint", value: preferredUpn },
    { key: "domain_hint", value: preferredDomain }
  ];

  const rules: chrome.declarativeNetRequest.Rule[] = [
    ...buildExclusionAllowRules(settings.appExclusions),
    {
      id: RULE_AUTHORIZE_HINTS,
      priority: 1,
      action: {
        type: REDIRECT,
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: authorizeParamUpdates
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://login\\.microsoftonline\\.com/[^?#]+/oauth2(/v2\\.0)?/authorize([?#].*)?$",
        resourceTypes: [MAIN_FRAME, SUB_FRAME]
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
              addOrReplaceParams: [{ key: "whr", value: preferredDomain }]
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://login\\.microsoftonline\\.com/[^?#]+/(saml2|wsfed)([?#].*)?$",
        resourceTypes: [MAIN_FRAME, SUB_FRAME]
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
          transform: {
            queryTransform: {
              removeParams: ["prompt"],
              addOrReplaceParams: authorizeParamUpdates
            }
          }
        }
      },
      condition: {
        regexFilter: "^https://login\\.microsoftonline\\.com/[^?#]+/oauth2(/v2\\.0)?/authorize\\?([^#&]+&)*prompt=select_account(&[^#]*)?(#.*)?$",
        resourceTypes: [MAIN_FRAME, SUB_FRAME]
      }
    });
  }

  return rules;
}

function buildExclusionAllowRules(exclusions: AppExclusion[]): chrome.declarativeNetRequest.Rule[] {
  return exclusions
    .filter((exclusion) => exclusion.enabled)
    .slice(0, MAX_EXCLUSION_RULES)
    .flatMap((exclusion, index) => {
      const regexFilter = buildExclusionRegexFilter(exclusion);
      if (!regexFilter) {
        return [];
      }
      return [
        {
          id: EXCLUSION_RULE_ID_START + index,
          priority: 100,
          action: { type: ALLOW },
          condition: {
            regexFilter,
            isUrlFilterCaseSensitive: false,
            resourceTypes: [MAIN_FRAME, SUB_FRAME]
          }
        }
      ];
    });
}

function buildExclusionRegexFilter(exclusion: AppExclusion): string | undefined {
  if (exclusion.matchType === "clientId") {
    const value = escapeRegex(encodeURIComponent(exclusion.value));
    return `^https://login\\.microsoftonline\\.com/[^?#]+/oauth2(/v2\\.0)?/authorize(?:\\?[^#]*)?[?&]client_id=${value}(?:[&#]|$).*`;
  }

  const host = escapeRegex(exclusion.value);
  const encodedProtocol = "https?(?::|%3a)(?:/|%2f)(?:/|%2f)";
  const hostBoundary = "(?::\\d+)?(?:[/?#&]|%2f|%3f|%23|$)";
  return `^https://login\\.microsoftonline\\.com/[^?#]+/(?:oauth2(?:/v2\\.0)?/authorize|saml2|wsfed)(?:\\?[^#]*)?[?&](?:redirect_uri|wreply|wtrealm|realm)=${encodedProtocol}${host}${hostBoundary}.*`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
