import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;

describe("tag and version synchronization", () => {
  test("accepts the matching release tag through the workflow CLI form", () => {
    const result = spawnSync(process.execPath, ["scripts/check-version-sync.mjs", `v${version}`], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  test("rejects a mismatched release tag even when pnpm includes an argument separator", () => {
    const result = spawnSync(process.execPath, ["scripts/check-version-sync.mjs", "--", "v99.99.99"], {
      encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Tag/version mismatch");
  });

  test("rejects a workflow ref that is not an exact semantic version tag", () => {
    const result = spawnSync(process.execPath, ["scripts/check-version-sync.mjs", "release-1.1.5"], {
      encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid release tag");
  });
});
