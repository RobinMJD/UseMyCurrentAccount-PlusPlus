import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildChromeWebStoreEndpoints,
  cancelPendingSubmissionIfNeeded,
  getMissingChromeWebStoreConfig,
  getSubmittedItemState,
  getUploadState,
  isPendingSubmission,
  isUploadFailure,
  isUploadInProgress,
  isUploadSuccess,
  sanitizeChromeWebStoreMessage
} from "../scripts/publish-chrome-webstore.mjs";

describe("Chrome Web Store publish script", () => {
  test("reports missing settings without exposing provided values", () => {
    const missing = getMissingChromeWebStoreConfig({
      CHROME_WEBSTORE_CLIENT_ID: "client-id",
      CHROME_WEBSTORE_CLIENT_SECRET: "",
      CHROME_WEBSTORE_REFRESH_TOKEN: "refresh-token",
      CHROME_WEBSTORE_PUBLISHER_ID: "publisher-id",
      CHROME_WEBSTORE_EXTENSION_ID: "",
      CHROME_WEBSTORE_ZIP: "release/extension.zip"
    });
    expect(missing).toEqual(["CHROME_WEBSTORE_CLIENT_SECRET", "CHROME_WEBSTORE_EXTENSION_ID"]);
  });

  test("builds encoded v2 upload, status, and publish endpoints", () => {
    const endpoints = buildChromeWebStoreEndpoints({ publisherId: "publisher/with space", extensionId: "item/with space" });
    expect(endpoints.uploadUrl).toBe(
      "https://chromewebstore.googleapis.com/upload/v2/publishers/publisher%2Fwith%20space/items/item%2Fwith%20space:upload"
    );
    expect(endpoints.fetchStatusUrl).toBe(
      "https://chromewebstore.googleapis.com/v2/publishers/publisher%2Fwith%20space/items/item%2Fwith%20space:fetchStatus"
    );
    expect(endpoints.cancelSubmissionUrl).toBe(
      "https://chromewebstore.googleapis.com/v2/publishers/publisher%2Fwith%20space/items/item%2Fwith%20space:cancelSubmission"
    );
    expect(endpoints.publishUrl).toBe(
      "https://chromewebstore.googleapis.com/v2/publishers/publisher%2Fwith%20space/items/item%2Fwith%20space:publish"
    );
  });

  test("detects only an active pending review for superseding", () => {
    expect(getSubmittedItemState({ submittedItemRevisionStatus: { state: "PENDING_REVIEW" } })).toBe("PENDING_REVIEW");
    expect(isPendingSubmission({ submittedItemRevisionStatus: { state: "PENDING_REVIEW" } })).toBe(true);
    expect(isPendingSubmission({ submittedItemRevisionStatus: { state: "PUBLISHED" } })).toBe(false);
    expect(isPendingSubmission({})).toBe(false);
  });

  test("cancels an older pending review before a replacement upload", async () => {
    const requests = [];
    const cancelled = await cancelPendingSubmissionIfNeeded(
      { fetchStatusUrl: "https://store.test/status", cancelSubmissionUrl: "https://store.test/cancel" },
      "test-access-token",
      async (url, init) => {
        requests.push({ url, method: init.method, authorization: init.headers.Authorization });
        return url.endsWith("/status")
          ? { submittedItemRevisionStatus: { state: "PENDING_REVIEW" } }
          : {};
      }
    );

    expect(cancelled).toBe(true);
    expect(requests).toEqual([
      { url: "https://store.test/status", method: "GET", authorization: "Bearer test-access-token" },
      { url: "https://store.test/cancel", method: "POST", authorization: "Bearer test-access-token" }
    ]);
  });

  test("classifies top-level and nested upload states", () => {
    expect(getUploadState({ lastAsyncUploadState: "IN_PROGRESS" })).toBe("IN_PROGRESS");
    expect(getUploadState({ item: { lastAsyncUploadState: "SUCCEEDED" } })).toBe("SUCCEEDED");
    expect(isUploadInProgress({ lastAsyncUploadState: "IN_PROGRESS" })).toBe(true);
    expect(isUploadSuccess({ lastAsyncUploadState: "SUCCEEDED" })).toBe(true);
    expect(isUploadFailure({ lastAsyncUploadState: "FAILED" })).toBe(true);
  });

  test("redacts credentials from API messages", () => {
    expect(sanitizeChromeWebStoreMessage("failed ya29.abc123 and refresh_token=1//secret-value&client_secret=form-secret"))
      .toBe("failed [redacted] and refresh_token=[redacted]&client_secret=[redacted]");
    expect(sanitizeChromeWebStoreMessage('{"client_secret":"top-secret"}'))
      .toBe('{"client_secret":"[redacted]"}');
  });
});

describe("release workflow", () => {
  test("publishes the exact verified ZIP through the protected environment", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain("Publish to Chrome Web Store");
    expect(workflow).toContain("environment: chrome-web-store");
    expect(workflow).toContain("group: chrome-web-store-release");
    expect(workflow).toContain("CHROME_WEBSTORE_CLIENT_ID");
    expect(workflow).toContain("CHROME_WEBSTORE_REFRESH_TOKEN");
    expect(workflow).toContain("scripts/publish-chrome-webstore.mjs");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm audit --audit-level=low");
    expect(workflow).not.toContain("--clobber");
    for (const action of workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)) {
      expect(action[1]).toMatch(/^[a-f0-9]{40}$/);
    }
  });

  test("fails rather than silently skipping unconfigured publishing", () => {
    const publisher = readFileSync("scripts/publish-chrome-webstore.mjs", "utf8");
    expect(publisher).toContain("Missing required Chrome Web Store configuration");
    expect(publisher).not.toContain("publish skipped");
  });
});
