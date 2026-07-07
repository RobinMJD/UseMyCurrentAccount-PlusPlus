import { beforeEach, describe, expect, test, vi } from "vitest";
import { chooseAccountTile, findAccountTiles } from "../src/content/accountPicker";

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
});
