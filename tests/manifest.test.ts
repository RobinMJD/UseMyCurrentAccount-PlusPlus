import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

interface ExtensionManifest {
  version: string;
  icons: Record<string, string>;
  action: {
    default_icon: Record<string, string>;
  };
}

describe("extension manifest icons", () => {
  test("uses the app icon for extension and toolbar surfaces", () => {
    const manifest = readManifest();

    expect(manifest.version).toBe("1.0.1");
    expect(manifest.icons).toMatchObject({
      "16": "img/UseMyCurrentAccountPlusPlus-16.png",
      "32": "img/UseMyCurrentAccountPlusPlus-32.png",
      "48": "img/UseMyCurrentAccountPlusPlus-48.png",
      "128": "img/UseMyCurrentAccountPlusPlus-128.png"
    });
    expect(manifest.action.default_icon).toEqual(manifest.icons);

    for (const iconPath of Object.values(manifest.icons)) {
      expect(existsSync(resolve("public", iconPath))).toBe(true);
    }
  });
});

function readManifest(): ExtensionManifest {
  return JSON.parse(readFileSync(resolve("public", "manifest.json"), "utf8")) as ExtensionManifest;
}
