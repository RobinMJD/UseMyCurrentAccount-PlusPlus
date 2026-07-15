import { describe, expect, test } from "vitest";
import {
  buildActiveDynamicRules,
  buildDynamicRules,
  getDynamicRulesStateKey,
  MANAGED_DYNAMIC_RULE_IDS
} from "../src/lib/dnrRules";
import { createDiagnostic, mergeSettings } from "../src/lib/settings";

describe("dynamic DNR rules", () => {
  test("emits high-priority allow rules for exclusions plus redirect rules", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      appExclusions: [
        {
          id: "client-exclusion",
          enabled: true,
          matchType: "clientId",
          value: "app-123",
          createdAt: "2026-06-16T10:00:00.000Z"
        },
        {
          id: "host-exclusion",
          enabled: true,
          matchType: "redirectHost",
          value: "portal.example.com",
          createdAt: "2026-06-16T10:00:00.000Z"
        }
      ]
    }));

    const allowRules = rules.filter((rule) => rule.action.type === "allow");
    const redirectRules = rules.filter((rule) => rule.action.type === "redirect");
    expect(allowRules).toHaveLength(5);
    const highestRedirectPriority = Math.max(...redirectRules.map((item) => item.priority || 0));
    expect(allowRules.every((rule) => (rule.priority || 0) > highestRedirectPriority)).toBe(true);
    expect(allowRules[0].condition.regexFilter).toContain("client_id=app-123");
    expect(allowRules.slice(1).every((rule) => rule.condition.regexFilter?.includes("portal\\.example\\.com"))).toBe(true);
    expect(rules.every((rule) => rule.condition.resourceTypes?.every((type) => type === "main_frame"))).toBe(true);
    expect(redirectRules).toHaveLength(3);
  });

  test("removes existing hint values before adding one canonical value", () => {
    const rules = buildDynamicRules(mergeSettings({ preferredUpn: "user@example.com" }));
    const oauthTransform = rules.find((rule) => rule.id === 1)?.action.redirect?.transform?.queryTransform;
    const federationTransform = rules.find((rule) => rule.id === 3)?.action.redirect?.transform?.queryTransform;

    expect(oauthTransform?.removeParams).toEqual(["login_hint", "domain_hint"]);
    expect(oauthTransform?.addOrReplaceParams).toEqual([
      { key: "login_hint", value: "user@example.com" },
      { key: "domain_hint", value: "example.com" }
    ]);
    expect(federationTransform?.removeParams).toEqual(["whr"]);
    expect(federationTransform?.addOrReplaceParams).toEqual([{ key: "whr", value: "example.com" }]);

    const approvedRules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      requireAppApproval: true,
      appApprovals: [
        {
          id: "client-approval",
          enabled: true,
          matchType: "clientId",
          value: "app-123",
          createdAt: "2026-07-15T20:00:00.000Z"
        },
        {
          id: "host-approval",
          enabled: true,
          matchType: "redirectHost",
          value: "portal.example.com",
          createdAt: "2026-07-15T20:00:00.000Z"
        }
      ]
    })).filter((rule) => rule.priority === 1);
    const approvedOauthTransforms = approvedRules
      .filter((rule) => rule.condition.regexFilter?.includes("oauth2"))
      .map((rule) => rule.action.redirect?.transform?.queryTransform);
    const approvedFederationTransforms = approvedRules
      .filter((rule) => rule.condition.regexFilter?.includes("saml2|wsfed"))
      .map((rule) => rule.action.redirect?.transform?.queryTransform);

    expect(approvedOauthTransforms.length).toBeGreaterThan(0);
    expect(approvedOauthTransforms.every((transform) => (
      JSON.stringify(transform?.removeParams) === JSON.stringify(["login_hint", "domain_hint"])
    ))).toBe(true);
    expect(approvedFederationTransforms.length).toBeGreaterThan(0);
    expect(approvedFederationTransforms.every((transform) => (
      JSON.stringify(transform?.removeParams) === JSON.stringify(["whr"])
    ))).toBe(true);
  });

  test("prompt suppression rule only targets exact select-account prompts", () => {
    const rules = buildDynamicRules(mergeSettings({ preferredUpn: "user@example.com" }));
    const promptRule = rules.find((rule) => rule.id === 2);
    const promptRegex = new RegExp(promptRule?.condition.regexFilter || "");

    expect(
      promptRegex.test("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&nonce=n")
    ).toBe(true);
    expect(
      promptRegex.test("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=login%20select_account")
    ).toBe(false);
    expect(
      promptRegex.test("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?nonce=n&prompt=select_account#fragment")
    ).toBe(true);
    expect(
      promptRegex.test("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=login&prompt=select_account")
    ).toBe(true);
    const repeatedPromptUrl =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=login&prompt=select_account";
    const rewritten = repeatedPromptUrl.replace(
      promptRegex,
      (_match, prefix: string, suffix: string | undefined, fragment: string | undefined) =>
        `${prefix}${suffix || ""}${fragment || ""}`
    );
    expect(new URL(rewritten).searchParams.getAll("prompt")).toEqual(["login"]);
  });

  test("approved-only mode emits redirect rules only for approved app contexts", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      requireAppApproval: true,
      appApprovals: [
        {
          id: "client-approval",
          enabled: true,
          matchType: "clientId",
          value: "app-123",
          createdAt: "2026-06-16T10:00:00.000Z"
        },
        {
          id: "host-approval",
          enabled: true,
          matchType: "redirectHost",
          value: "portal.example.com",
          createdAt: "2026-06-16T10:00:00.000Z"
        }
      ]
    }));

    const redirectRules = rules.filter((rule) => rule.action.type === "redirect");
    expect(redirectRules).toHaveLength(14);
    expect(redirectRules.every((rule) => rule.condition.isUrlFilterCaseSensitive === false)).toBe(true);
    expect(redirectRules.map((rule) => rule.condition.regexFilter).join("\n")).toContain("client_id=app-123");
    expect(redirectRules.map((rule) => rule.condition.regexFilter).join("\n")).toContain("portal\\.example\\.com");
    expect(redirectRules.every((rule) => {
      const regexFilter = rule.condition.regexFilter || "";
      expect(() => new RegExp(regexFilter, rule.condition.isUrlFilterCaseSensitive === false ? "i" : "")).not.toThrow();
      return regexFilter.length < 2_000 && !/\(\?[=!<]/.test(regexFilter);
    })).toBe(true);
    expect(redirectRules.some((rule) =>
      rule.condition.regexFilter === "^https://login\\.microsoftonline\\.com/[^?#]+/oauth2(/v2\\.0)?/authorize([?#].*)?$"
    )).toBe(false);

    const clientPromptRules = redirectRules.filter((rule) =>
      rule.priority === 2 && rule.condition.regexFilter?.includes("client_id=app-123")
    );
    expect(clientPromptRules).toHaveLength(3);
    const clientPromptRegexes = clientPromptRules.map((rule) => new RegExp(rule.condition.regexFilter || "", "i"));
    expect(clientPromptRegexes.some((regex) => regex.test(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&nonce=n&prompt=select_account"
    ))).toBe(true);
    expect(clientPromptRegexes.some((regex) => regex.test(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&client_id=app-123"
    ))).toBe(true);
    expect(clientPromptRegexes.some((regex) => regex.test(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=other&prompt=select_account"
    ))).toBe(false);
    expect(clientPromptRegexes.some((regex) => regex.test(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&prompt=login%20select_account"
    ))).toBe(false);
  });

  test("approved-only mode emits no redirect rules without approvals", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      requireAppApproval: true
    }));

    expect(rules.filter((rule) => rule.action.type === "redirect")).toHaveLength(0);
  });

  test("removes the full managed dynamic rule range", () => {
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(1);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(2);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(3);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(1000);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(1119);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(2000);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(2299);
  });

  test("keeps the DNR state stable for diagnostics-only writes", () => {
    const settings = mergeSettings({ preferredUpn: "user@example.com" });
    const withDiagnostic = mergeSettings({
      ...settings,
      diagnostics: [createDiagnostic("noMatchingAccount", { message: "No match." })]
    });

    expect(getDynamicRulesStateKey(withDiagnostic)).toBe(getDynamicRulesStateKey(settings));
    expect(buildActiveDynamicRules(mergeSettings({ ...settings, enabled: false }))).toEqual([]);
    expect(buildActiveDynamicRules(mergeSettings({ ...settings, rewriteEnabled: false }))).toEqual([]);
  });

  test("keeps maximum approved-only rules unique and inside the managed range", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      requireAppApproval: true,
      appApprovals: Array.from({ length: 30 }, (_, index) => ({
        id: `approval-${index}`,
        enabled: true,
        matchType: "redirectHost" as const,
        value: `app-${index}.example.com`,
        createdAt: "2026-06-16T10:00:00.000Z"
      }))
    }));
    const ids = rules.map((rule) => rule.id);

    expect(rules).toHaveLength(300);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => MANAGED_DYNAMIC_RULE_IDS.includes(id))).toBe(true);
    const lastRule = rules.find((rule) => rule.id === 2299);
    expect(lastRule).toBeDefined();
    expect(matchesAnyRule(lastRule ? [lastRule] : [],
      "https://login.microsoftonline.com/common/wsfed?wreply=https%3A%2F%2Fapp-29.example.com%2Fcb"
    )).toBe(true);
  });

  test("uses small exact-boundary redirect-host exclusion regexes for OAuth and federation", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      appExclusions: [{
        id: "host-exclusion",
        enabled: true,
        matchType: "redirectHost",
        value: "portal.example.com",
        createdAt: "2026-06-16T10:00:00.000Z"
      }]
    })).filter((rule) => rule.action.type === "allow");

    expect(rules).toHaveLength(4);
    expect(rules.every((rule) => {
      const filter = rule.condition.regexFilter || "";
      expect(() => new RegExp(filter, "i")).not.toThrow();
      expect(filter).not.toContain(".*");
      expect(filter).not.toContain("(?:\\?[^#]*)?[?&]");
      return filter.length < 350;
    })).toBe(true);

    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app&redirect_uri=https://portal.example.com:443/callback"
    )).toBe(true);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fportal.example.com%3A443%2Fcallback"
    )).toBe(true);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/wsfed?wa=wsignin1.0&wreply=https://portal.example.com/callback"
    )).toBe(true);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/saml2?wtrealm=https%3A%2F%2Fportal.example.com%2Fsaml"
    )).toBe(true);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/wsfed?realm=https%3A%2F%2Fportal.example.com"
    )).toBe(true);

    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fportal.example.com.evil.test%2Fcallback"
    )).toBe(false);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fevil.portal.example.com%2Fcallback"
    )).toBe(false);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?realm=https%3A%2F%2Fportal.example.com"
    )).toBe(false);
    expect(matchesAnyRule(rules,
      "https://login.microsoftonline.com/common/wsfed?redirect_uri=https%3A%2F%2Fportal.example.com"
    )).toBe(false);
  });

  test("scopes raw and encoded redirect-host approvals without matching suffix hosts", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      requireAppApproval: true,
      appApprovals: [{
        id: "host-approval",
        enabled: true,
        matchType: "redirectHost",
        value: "portal.example.com",
        createdAt: "2026-06-16T10:00:00.000Z"
      }]
    }));
    const hintRules = rules.filter((rule) => rule.priority === 1);
    const promptRules = rules.filter((rule) => rule.priority === 2);

    expect(hintRules).toHaveLength(4);
    expect(promptRules).toHaveLength(6);
    expect(matchesAnyRule(hintRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb"
    )).toBe(true);
    expect(matchesAnyRule(hintRules,
      "https://login.microsoftonline.com/common/wsfed?wreply=https://portal.example.com/cb"
    )).toBe(true);
    expect(matchesAnyRule(hintRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fportal.example.com.evil.test%2Fcb"
    )).toBe(false);
    expect(matchesAnyRule(promptRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb&prompt=select_account"
    )).toBe(true);
    expect(matchesAnyRule(promptRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&redirect_uri=https://portal.example.com/cb"
    )).toBe(true);
    expect(matchesAnyRule(promptRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&redirect_uri=https://portal.example.com.evil.test/cb"
    )).toBe(false);
  });

  test("approved prompt suppression removes only exact select_account values and preserves other prompts", () => {
    const promptRules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      requireAppApproval: true,
      appApprovals: [{
        id: "client-approval",
        enabled: true,
        matchType: "clientId",
        value: "app-123",
        createdAt: "2026-06-16T10:00:00.000Z"
      }]
    })).filter((rule) => rule.priority === 2);

    const appBefore = applyFirstMatchingRule(
      promptRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&prompt=login&prompt=select_account&nonce=n"
    );
    expect(new URL(appBefore).searchParams.getAll("prompt")).toEqual(["login"]);
    expect(new URL(appBefore).searchParams.get("nonce")).toBe("n");

    const appAfter = applyFirstMatchingRule(
      promptRules,
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&client_id=app-123&prompt=consent"
    );
    expect(new URL(appAfter).searchParams.getAll("prompt")).toEqual(["consent"]);

    const mixed =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&prompt=login%20select_account";
    expect(applyFirstMatchingRule(promptRules, mixed)).toBe(mixed);
  });

  test("allocates all four host exclusion rules for the last configured exclusion", () => {
    const rules = buildDynamicRules(mergeSettings({
      preferredUpn: "user@example.com",
      appExclusions: Array.from({ length: 30 }, (_, index) => ({
        id: `exclusion-${index}`,
        enabled: true,
        matchType: "redirectHost" as const,
        value: `excluded-${index}.example.com`,
        createdAt: "2026-06-16T10:00:00.000Z"
      }))
    })).filter((rule) => rule.action.type === "allow");

    expect(rules).toHaveLength(120);
    const lastRule = rules.find((rule) => rule.id === 1119);
    expect(lastRule).toBeDefined();
    expect(matchesAnyRule(lastRule ? [lastRule] : [],
      "https://login.microsoftonline.com/common/saml2?realm=https%3A%2F%2Fexcluded-29.example.com%2Fsaml"
    )).toBe(true);
  });
});

function matchesAnyRule(rules: chrome.declarativeNetRequest.Rule[], url: string): boolean {
  return rules.some((rule) => new RegExp(
    rule.condition.regexFilter || "",
    rule.condition.isUrlFilterCaseSensitive === false ? "i" : ""
  ).test(url));
}

function applyFirstMatchingRule(rules: chrome.declarativeNetRequest.Rule[], url: string): string {
  for (const rule of rules) {
    const regex = new RegExp(
      rule.condition.regexFilter || "",
      rule.condition.isUrlFilterCaseSensitive === false ? "i" : ""
    );
    const match = regex.exec(url);
    const substitution = rule.action.redirect?.regexSubstitution;
    if (!match || !substitution) {
      continue;
    }
    const replacement = substitution.replace(/\\([1-9])/g, (_value, index: string) => match[Number(index)] || "");
    return `${url.slice(0, match.index)}${replacement}${url.slice(match.index + match[0].length)}`;
  }
  return url;
}
