import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  chooseAccountTile,
  findAccountTiles,
  isAccountPickerPage,
  resolveAppContextUrl,
  shouldRequestAppApproval
} from "../src/content/accountPicker";

const settings = {
  enabled: true,
  autoPickEnabled: true,
  preferredUpn: "admin.user@example.com",
  aliases: []
};

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100,
    height: 40,
    top: 0,
    right: 100,
    bottom: 40,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect);
});

describe("account picker", () => {
  test("matches the screenshot-style picker by exact email", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Admin User admin.user@example.com Connected to Windows</div>
      <div role="button">Standard User standard.user@example.com Connected to Windows</div>
      <div role="button">Use another account</div>
    `;
    const result = chooseAccountTile(document, settings);
    expect(result.action).toBe("picked");
    expect(result.tile?.upn).toBe("admin.user@example.com");
  });

  test("uses aliases", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Standard User standard.user@example.com Connected to Windows</div>
    `;
    const result = chooseAccountTile(document, { ...settings, aliases: ["standard.user@example.com"] });
    expect(result.action).toBe("picked");
    expect(result.tile?.upn).toBe("standard.user@example.com");
  });

  test("recognizes localized picker headings and localized other-account actions", () => {
    document.body.innerHTML = `
      <h1>Choisir un compte</h1>
      <div role="button">Administrateur admin.user@example.com</div>
      <div role="button">Utiliser un autre compte</div>
    `;

    expect(isAccountPickerPage(document)).toBe(true);
    expect(findAccountTiles(document)).toHaveLength(1);
    expect(chooseAccountTile(document, settings).action).toBe("picked");

    document.body.innerHTML = `
      <div role="button">Admin admin.user@example.com</div>
      <div role="button">別のアカウントを使用する</div>
    `;
    expect(isAccountPickerPage(document)).toBe(true);
  });

  test("does not click on no match", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Someone else somebody@example.com</div>
    `;
    expect(chooseAccountTile(document, settings).action).toBe("noMatch");
  });

  test("does not click on multiple matches", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Admin admin.user@example.com</div>
      <div role="button">Admin duplicate admin.user@example.com</div>
    `;
    expect(chooseAccountTile(document, settings).action).toBe("multipleMatches");
  });

  test("does not treat Use another account as an account tile", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Use another account admin.user@example.com</div>
    `;
    expect(findAccountTiles(document)).toHaveLength(0);
    expect(chooseAccountTile(document, settings).action).toBe("noMatch");
  });

  test("skips auto-pick for excluded apps", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Admin User admin.user@example.com Connected to Windows</div>
    `;
    const result = chooseAccountTile(
      document,
      {
        ...settings,
        appExclusions: [
          {
            id: "exclusion-1",
            enabled: true,
            matchType: "clientId",
            value: "app-123",
            createdAt: "2026-06-16T10:00:00.000Z"
          }
        ]
      },
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123"
    );

    expect(result.action).toBe("excludedApp");
    expect(result.exclusionValue).toBe("app-123");
    expect(result.pickerTileCount).toBe(1);
  });

  test("skips auto-pick for unapproved apps in approved-only mode", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Admin User admin.user@example.com Connected to Windows</div>
    `;
    const result = chooseAccountTile(
      document,
      {
        ...settings,
        requireAppApproval: true,
        appApprovals: []
      },
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123"
    );

    expect(result.action).toBe("approvalRequired");
    expect(result.pickerTileCount).toBe(1);
    expect(result.pickerMatchCount).toBe(0);
  });

  test("auto-picks approved apps in approved-only mode", () => {
    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Admin User admin.user@example.com Connected to Windows</div>
    `;
    const result = chooseAccountTile(
      document,
      {
        ...settings,
        requireAppApproval: true,
        appApprovals: [
          {
            id: "approval-1",
            enabled: true,
            matchType: "clientId",
            value: "app-123",
            createdAt: "2026-06-16T10:00:00.000Z"
          }
        ]
      },
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123"
    );

    expect(result.action).toBe("picked");
    expect(result.tile?.upn).toBe("admin.user@example.com");
  });

  test("requests app approval for unapproved Microsoft auth URLs without needing a picker", () => {
    expect(shouldRequestAppApproval(
      {
        ...settings,
        requireAppApproval: true,
        appApprovals: []
      },
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb"
    )).toBe(true);
  });

  test("does not request app approval for approved or excluded auth URLs", () => {
    const inputUrl =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcb";

    expect(shouldRequestAppApproval(
      {
        ...settings,
        requireAppApproval: true,
        appApprovals: [
          {
            id: "approval-1",
            enabled: true,
            matchType: "clientId",
            value: "app-123",
            createdAt: "2026-06-16T10:00:00.000Z"
          }
        ]
      },
      inputUrl
    )).toBe(false);
    expect(shouldRequestAppApproval(
      {
        ...settings,
        requireAppApproval: true,
        appExclusions: [
          {
            id: "exclusion-1",
            enabled: true,
            matchType: "redirectHost",
            value: "portal.example.com",
            createdAt: "2026-06-16T10:00:00.000Z"
          }
        ]
      },
      inputUrl
    )).toBe(false);
  });

  test("retains only sanitized app context for a short same-tab picker navigation", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => void values.delete(key)
    };
    const authorizeUrl =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=app-123&redirect_uri=https%3A%2F%2Fportal.example.com%2Fcallback&state=secret&nonce=secret";
    const pickerUrl = "https://login.microsoftonline.com/common/login";

    expect(resolveAppContextUrl(authorizeUrl, storage, 1_000)).toBe(authorizeUrl);
    const remembered = resolveAppContextUrl(pickerUrl, storage, 2_000);
    expect(remembered).toContain("client_id=app-123");
    expect(remembered).toContain("portal.example.com");
    expect(remembered).not.toContain("state=");
    expect(remembered).not.toContain("nonce=");

    document.body.innerHTML = `
      <h1>Pick an account</h1>
      <div role="button">Admin User admin.user@example.com</div>
    `;
    expect(chooseAccountTile(document, {
      ...settings,
      requireAppApproval: true,
      appApprovals: [{
        id: "approval-1",
        enabled: true,
        matchType: "clientId",
        value: "app-123",
        createdAt: "2026-06-16T10:00:00.000Z"
      }]
    }, remembered).action).toBe("picked");

    expect(resolveAppContextUrl(pickerUrl, storage, 11 * 60 * 1_000)).toBe(pickerUrl);
    expect(values.size).toBe(0);
  });
});
