import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const screenshotFiles = [
  "store-screenshot-01-popup.png",
  "store-screenshot-02-overview.png",
  "store-screenshot-05-automation.png",
  "store-screenshot-03-approved-apps.png",
  "store-screenshot-04-diagnostics.png"
];

describe("README and browser Store assets", () => {
  it("leads the README with every current product capture", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");
    const paths = screenshotFiles.map((fileName) => `docs/images/${fileName}`);
    const offsets = paths.map((path) => readme.indexOf(path));

    expect(offsets.every((offset) => offset > 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    for (const path of paths) {
      expect(readPngDimensions(resolve(path))).toEqual({ width: 1280, height: 800 });
    }
  });

  it("uses official clickable Store badges and keeps release history out of README", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");

    expect(readme).toContain("https://chromewebstore.google.com/detail/usemycurrentaccount%2B%2B/oldcfpgnklojihohiccflbgigniadgoc");
    expect(readme).toContain("https://microsoftedge.microsoft.com/addons/detail/nlfohbfheaeoopghgmfjbeaepgflckkd");
    expect(readPngDimensions(resolve("docs/images/store-badges/chrome-web-store.png"))).toEqual({
      width: 340,
      height: 96
    });
    expect(readPngDimensions(resolve("docs/images/store-badges/microsoft-edge-addons.png"))).toEqual({
      width: 1178,
      height: 312
    });
    expect(readme).not.toMatch(/^## Changelog$/m);
    expect(readme).toContain("https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/releases");
  });

  it("keeps all generated Store graphics at their documented dimensions", () => {
    expect(readPngDimensions(resolve("docs/images/store-icon-300.png"))).toEqual({ width: 300, height: 300 });
    expect(readPngDimensions(resolve("docs/images/small-promo-440x280.png"))).toEqual({ width: 440, height: 280 });
    expect(readPngDimensions(resolve("docs/images/large-promo-1400x560.png"))).toEqual({ width: 1400, height: 560 });
  });

  it("regenerates all README screenshots from the loaded extension with fictional data", () => {
    const qaScript = readFileSync(resolve("scripts/qa-loaded-extension.mjs"), "utf8");

    for (const fileName of screenshotFiles) {
      expect(qaScript).toContain(fileName);
    }
    expect(qaScript).toContain("admin@contoso.com");
    expect(qaScript).not.toMatch(/robin\.monjaud|sonepar/i);
  });
});

function readPngDimensions(path) {
  const png = readFileSync(path);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}
