import { describe, expect, test } from "vitest";
import { buildDynamicRules, MANAGED_DYNAMIC_RULE_IDS } from "../src/lib/dnrRules";
import { mergeSettings } from "../src/lib/settings";

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
    expect(allowRules).toHaveLength(2);
    const highestRedirectPriority = Math.max(...redirectRules.map((item) => item.priority || 0));
    expect(allowRules.every((rule) => (rule.priority || 0) > highestRedirectPriority)).toBe(true);
    expect(allowRules[0].condition.regexFilter).toContain("client_id=app-123");
    expect(allowRules[1].condition.regexFilter).toContain("portal\\.example\\.com");
    expect(redirectRules).toHaveLength(3);
  });

  test("removes the full managed dynamic rule range", () => {
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(1);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(2);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(3);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(1000);
    expect(MANAGED_DYNAMIC_RULE_IDS).toContain(1029);
  });
});
