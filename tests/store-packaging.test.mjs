import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  getStorePackagePath,
  getStorePackagePaths,
  packageStores,
  STORE_PACKAGE_SUFFIX
} from "../scripts/package-stores.mjs";

describe("shared Chromium Store packaging", () => {
  test("uses one neutral package for Chrome and Edge", () => {
    const path = getStorePackagePath("1.1.8", "release");
    const paths = getStorePackagePaths("1.1.8", "release");
    expect(path).toMatch(/usemycurrentaccount-plusplus-v1\.1\.8-chromium-stores\.zip$/);
    expect(paths).toEqual({ shared: path, chrome: path, edge: path });
    expect(STORE_PACKAGE_SUFFIX).toBe("chromium-stores");
  });

  test("writes one archive and removes same-version legacy duplicates", () => {
    const root = mkdtempSync(join(tmpdir(), "umca-store-package-"));
    const distDir = join(root, "dist");
    const releaseDir = join(root, "release");
    mkdirSync(distDir);
    mkdirSync(releaseDir);
    writeFileSync(join(distDir, "manifest.json"), JSON.stringify({ manifest_version: 3, version: "1.1.8" }));
    writeFileSync(join(distDir, "popup.html"), "<!doctype html>");
    writeFileSync(join(distDir, "LICENSE.txt"), "UseMyCurrentAccount++ contributors");
    writeFileSync(
      join(distDir, "THIRD_PARTY_NOTICES.txt"),
      "Copyright (c) Meta Platforms, Inc. and affiliates."
    );
    const legacyChrome = join(releaseDir, "usemycurrentaccount-plusplus-v1.1.8-chrome-webstore.zip");
    const legacyEdge = join(releaseDir, "usemycurrentaccount-plusplus-v1.1.8-edge-addons.zip");
    writeFileSync(legacyChrome, "stale");
    writeFileSync(legacyEdge, "stale");

    try {
      const paths = packageStores({ distDir, releaseDir, version: "1.1.8" });
      expect(readdirSync(releaseDir)).toEqual(["usemycurrentaccount-plusplus-v1.1.8-chromium-stores.zip"]);
      expect(existsSync(paths.shared)).toBe(true);
      expect(paths.chrome).toBe(paths.shared);
      expect(paths.edge).toBe(paths.shared);
      expect(existsSync(legacyChrome)).toBe(false);
      expect(existsSync(legacyEdge)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CI and release workflows retain one verified package", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const release = readFileSync(".github/workflows/release.yml", "utf8");
    for (const workflow of [ci, release]) {
      expect(workflow).toContain("pnpm run package:stores");
      expect(workflow).toContain("usemycurrentaccount-plusplus-v*-chromium-stores.zip");
      expect(workflow).not.toContain("usemycurrentaccount-plusplus-v*-chrome-webstore.zip");
      expect(workflow).not.toContain("usemycurrentaccount-plusplus-v*-edge-addons.zip");
    }
  });
});
