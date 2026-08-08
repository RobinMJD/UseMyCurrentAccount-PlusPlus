import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STORE_PACKAGE_SUFFIXES = Object.freeze({
  chrome: "chrome-webstore",
  edge: "edge-addons"
});

export function getStorePackagePaths(version, releaseDir = "release") {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(version || ""))) {
    throw new Error(`Invalid extension version: ${version || "missing"}.`);
  }
  return Object.fromEntries(
    Object.entries(STORE_PACKAGE_SUFFIXES).map(([store, suffix]) => [
      store,
      resolve(releaseDir, `usemycurrentaccount-plusplus-v${version}-${suffix}.zip`)
    ])
  );
}

export function verifyStorePackage(zipPath, expectedVersion) {
  if (!existsSync(zipPath)) {
    throw new Error(`Store package not found: ${zipPath}`);
  }
  const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  if (!entries.includes("manifest.json")) {
    throw new Error(`Store package is missing manifest.json at its root: ${zipPath}`);
  }
  const unsafeEntry = entries.find(
    (entry) =>
      entry.startsWith("/") ||
      entry.split("/").includes("..") ||
      /(^|\/)\.DS_Store$/.test(entry) ||
      entry.endsWith(".map")
  );
  if (unsafeEntry) {
    throw new Error(`Store package contains an unsafe or unwanted entry: ${unsafeEntry}`);
  }
  const manifest = JSON.parse(execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8" }));
  if (manifest.version !== expectedVersion) {
    throw new Error(`Store package version ${manifest.version || "missing"} does not match ${expectedVersion}.`);
  }
  const license = execFileSync("unzip", ["-p", zipPath, "LICENSE.txt"], { encoding: "utf8" });
  const notices = execFileSync("unzip", ["-p", zipPath, "THIRD_PARTY_NOTICES.txt"], { encoding: "utf8" });
  if (!license.includes("UseMyCurrentAccount++ contributors")) {
    throw new Error(`Store package has an invalid project license: ${zipPath}`);
  }
  if (!notices.includes("Copyright (c) Meta Platforms, Inc. and affiliates.")) {
    throw new Error(`Store package has invalid third-party notices: ${zipPath}`);
  }
  return { entries, manifest };
}

export function packageStores({ distDir = "dist", releaseDir = "release", version } = {}) {
  const resolvedVersion = version || JSON.parse(readFileSync("package.json", "utf8")).version;
  const distPath = resolve(distDir);
  if (!existsSync(resolve(distPath, "manifest.json"))) {
    throw new Error(`Built extension manifest not found in ${distPath}. Run pnpm run build first.`);
  }
  mkdirSync(releaseDir, { recursive: true });
  const paths = getStorePackagePaths(resolvedVersion, releaseDir);
  for (const packagePath of Object.values(paths)) rmSync(packagePath, { force: true });

  execFileSync("zip", ["-X", "-q", "-r", paths.chrome, ".", "-x", "*.DS_Store", "*.map"], {
    cwd: distPath,
    stdio: "inherit"
  });
  copyFileSync(paths.chrome, paths.edge);

  for (const [store, packagePath] of Object.entries(paths)) {
    verifyStorePackage(packagePath, resolvedVersion);
    console.log(`Verified ${store} package: ${packagePath}`);
  }
  return paths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    packageStores();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
