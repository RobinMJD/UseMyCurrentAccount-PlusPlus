#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_EDGE_BINARY = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const FIXED_DIAGNOSTIC_TIMES = [
  "2026-07-15T09:34:00.000Z",
  "2026-07-15T09:32:00.000Z",
  "2026-07-15T09:30:00.000Z"
];
const FIXED_DIAGNOSTIC_IDS = [
  "qa-no-matching-account",
  "qa-excluded-app",
  "qa-approval-required"
];
const SETTINGS_KEY = "useMyCurrentAccountPlus.settings.v1";

class CdpConnection {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #eventHandlers = new Set();

  constructor(url) {
    this.url = url;
  }

  async connect() {
    this.#socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Microsoft Edge DevTools.")), 10_000);
      this.#socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.#socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to Microsoft Edge DevTools."));
      }, { once: true });
    });

    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        } else {
          pending.resolve(message.result || {});
        }
        return;
      }
      for (const handler of this.#eventHandlers) {
        handler(message);
      }
    });

    this.#socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Microsoft Edge DevTools disconnected during ${pending.method}.`));
      }
      this.#pending.clear();
    });
  }

  onEvent(handler) {
    this.#eventHandlers.add(handler);
    return () => this.#eventHandlers.delete(handler);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timed out waiting for DevTools method ${method}.`));
      }, 15_000);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.#socket?.close();
  }
}

const options = parseArguments(process.argv.slice(2));
const edgeBinary = path.resolve(options.edge || process.env.EDGE_BIN || DEFAULT_EDGE_BINARY);
const extensionDir = path.resolve(PROJECT_ROOT, options.extensionDir || "dist");
const releaseDir = path.resolve(PROJECT_ROOT, options.releaseDir || "release/webstore-assets");
const docsImagesDir = path.resolve(PROJECT_ROOT, options.docsImagesDir || "docs/images");

await access(edgeBinary);
await access(path.join(extensionDir, "manifest.json"));
await access(path.join(extensionDir, "background.js"));

await mkdir(releaseDir, { recursive: true });
await mkdir(docsImagesDir, { recursive: true });

const profileDir = await mkdtemp(path.join(tmpdir(), "usemycurrentaccount-edge-qa-"));
const edgeStderr = [];
const edge = spawn(edgeBinary, [
  "--headless=new",
  `--user-data-dir=${profileDir}`,
  "--remote-debugging-port=0",
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-component-update",
  "--disable-background-networking",
  "about:blank"
], {
  stdio: ["ignore", "ignore", "pipe"]
});

edge.stderr.setEncoding("utf8");
edge.stderr.on("data", (chunk) => {
  edgeStderr.push(chunk);
  if (edgeStderr.join("").length > 20_000) {
    edgeStderr.splice(0, Math.max(1, edgeStderr.length - 8));
  }
});

let cdp;
const browserErrors = [];
const sessionLabels = new Map();
const qa = {
  serviceWorker: false,
  runtimeMessaging: false,
  storagePersistence: false,
  dnrRules: false,
  popupRender: false,
  popupAutosave: false,
  settingsRender: false,
  settingsSave: false,
  profileClearPersistence: false,
  oauthTransform: false,
  duplicateHintsCanonicalized: false,
  unapprovedUntouched: false,
  federationTransform: false,
  duplicateFederationHintCanonicalized: false,
  pickerExactMatch: false,
  pickerNoMatch: false,
  pickerMultipleMatch: false,
  clearDiagnostics: false,
  screenshots: false,
  consoleHealth: false
};

try {
  const { port, browserPath } = await waitForDevTools(profileDir, edge);
  cdp = new CdpConnection(`ws://127.0.0.1:${port}${browserPath}`);
  await cdp.connect();
  cdp.onEvent((message) => collectBrowserError(message, sessionLabels, browserErrors));

  const serviceWorker = await waitForExtensionServiceWorker(cdp);
  qa.serviceWorker = true;
  const extensionId = new URL(serviceWorker.url).host;
  const workerSession = await attachToTarget(cdp, serviceWorker.targetId, "service worker", sessionLabels);
  await waitFor(cdp, workerSession, "typeof chrome?.runtime?.id === 'string'");
  const runtimeId = await evaluate(cdp, workerSession, "chrome.runtime.id");
  assert(runtimeId === extensionId, "The service worker runtime ID did not match its extension URL.");

  const settingsPage = await createPage(
    cdp,
    `chrome-extension://${extensionId}/settings.html`,
    1280,
    800,
    "settings",
    sessionLabels
  );
  await waitFor(cdp, settingsPage.sessionId, "document.querySelector('h1')?.textContent === 'UseMyCurrentAccount++'");
  qa.settingsRender = true;

  const initialSettingsResponse = await sendRuntimeMessage(cdp, settingsPage.sessionId, { action: "getSettings" });
  assert(initialSettingsResponse.success === true, `getSettings failed: ${initialSettingsResponse.error || "unknown error"}`);
  qa.runtimeMessaging = true;

  const samplePatch = buildSampleSettingsPatch();
  const saveResponse = await sendRuntimeMessage(cdp, settingsPage.sessionId, {
    action: "saveSettings",
    settings: samplePatch
  });
  assert(saveResponse.success === true, `saveSettings failed: ${saveResponse.error || "unknown error"}`);
  assert(saveResponse.data?.preferredUpn === "admin@contoso.com", "The saved preferred account was not normalized or persisted.");

  const stored = await evaluate(cdp, settingsPage.sessionId, `
    (async () => {
      const value = await chrome.storage.local.get(${JSON.stringify(SETTINGS_KEY)});
      return value[${JSON.stringify(SETTINGS_KEY)}];
    })()
  `);
  assert(stored?.preferredUpn === "admin@contoso.com", "chrome.storage.local did not contain the saved account.");
  assert(stored?.requireAppApproval === true, "chrome.storage.local did not contain approved-apps-only mode.");
  qa.storagePersistence = true;

  const installedRules = await evaluate(cdp, settingsPage.sessionId, "chrome.declarativeNetRequest.getDynamicRules()");
  const installedRuleIds = installedRules.map((rule) => rule.id).sort((left, right) => left - right);
  assert(installedRules.length >= 4, `Expected approved/excluded DNR rules, found ${installedRules.length}.`);
  assert(installedRuleIds.some((id) => id >= 1000 && id < 2000), "No exclusion allow rule was installed.");
  assert(installedRuleIds.some((id) => id >= 2000), "No approved-app redirect rule was installed.");
  const dnrMatchOutcomes = await evaluate(cdp, settingsPage.sessionId, `
    (async () => ({
      approved: await chrome.declarativeNetRequest.testMatchOutcome({
        url: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=11111111-2222-3333-4444-555555555555&redirect_uri=https%3A%2F%2Fportal.azure.com%2Fcallback',
        type: 'main_frame'
      }),
      excluded: await chrome.declarativeNetRequest.testMatchOutcome({
        url: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=22222222-3333-4444-5555-666666666666&redirect_uri=https%3A%2F%2Flegacy.contoso.com%2Fcallback',
        type: 'main_frame'
      })
    }))()
  `);
  assert(
    dnrMatchOutcomes.approved.matchedRules.some((rule) => rule.ruleId >= 2000),
    "An approved OAuth request did not match an approved-app DNR rule."
  );
  assert(
    dnrMatchOutcomes.excluded.matchedRules.some((rule) => rule.ruleId >= 1000 && rule.ruleId < 2000),
    "An excluded redirect host did not match an exclusion DNR rule."
  );
  qa.dnrRules = true;

  const badge = await evaluate(cdp, settingsPage.sessionId, `
    (async () => ({
      text: await chrome.action.getBadgeText({}),
      title: await chrome.action.getTitle({})
    }))()
  `);
  assert(badge.text === "ON", `Expected an ON badge, found ${JSON.stringify(badge.text)}.`);

  const popupPage = await createPage(
    cdp,
    `chrome-extension://${extensionId}/popup.html`,
    1280,
    800,
    "popup",
    sessionLabels
  );
  await waitFor(cdp, popupPage.sessionId, "document.querySelector('input[aria-label=\"Account to auto select\"]')?.value === 'admin@contoso.com'");
  qa.popupRender = true;

  await setFormValue(cdp, popupPage.sessionId, "input", "Account to auto select", "qa.updated@contoso.com");
  await waitFor(
    cdp,
    popupPage.sessionId,
    "[...document.querySelectorAll('p')].some((item) => item.textContent?.includes('Saved automatically.'))",
    8_000
  );
  const popupSaveCheck = await sendRuntimeMessage(cdp, popupPage.sessionId, { action: "getSettings" });
  assert(popupSaveCheck.data?.preferredUpn === "qa.updated@contoso.com", "The popup autosave did not persist through the service worker.");
  qa.popupAutosave = true;

  await evaluate(cdp, popupPage.sessionId, `
    (async () => {
      const key = ${JSON.stringify(SETTINGS_KEY)};
      const result = await chrome.storage.local.get(key);
      await chrome.storage.local.set({
        [key]: { ...result[key], detectedProfileEmail: 'profile@contoso.com' }
      });
      return true;
    })()
  `);
  await setFormValue(cdp, popupPage.sessionId, "input", "Account to auto select", "");
  await waitFor(
    cdp,
    popupPage.sessionId,
    "[...document.querySelectorAll('p')].some((item) => item.textContent?.includes('Saved automatically.'))",
    8_000
  );
  const clearedAccount = await sendRuntimeMessage(cdp, popupPage.sessionId, { action: "getSettings" });
  assert(clearedAccount.data?.enabled === false, "Clearing the popup account did not turn automation off.");
  assert(!clearedAccount.data?.preferredUpn, "Clearing the popup account did not remove preferredUpn.");
  assert(!clearedAccount.data?.detectedProfileEmail, "The legacy hidden profile-email field survived settings migration.");

  const restartedWorker = await restartExtensionServiceWorker(
    cdp,
    serviceWorker.targetId,
    extensionId,
    popupPage.sessionId
  );
  await attachToTarget(cdp, restartedWorker.targetId, "restarted service worker", sessionLabels);
  await delay(600);
  const afterRestart = await retryRuntimeMessage(cdp, popupPage.sessionId, { action: "getSettings" });
  assert(afterRestart.data?.enabled === false, "Automation turned back on after the MV3 service worker restarted.");
  assert(!afterRestart.data?.preferredUpn, "The cleared account reappeared after the MV3 service worker restarted.");
  assert(!afterRestart.data?.detectedProfileEmail, "The legacy hidden profile-email field reappeared after the MV3 service worker restarted.");
  qa.profileClearPersistence = true;

  const restoreResponse = await sendRuntimeMessage(cdp, settingsPage.sessionId, {
    action: "saveSettings",
    settings: samplePatch
  });
  assert(restoreResponse.success === true, "Could not restore the deterministic sample settings.");

  await reloadPage(cdp, settingsPage.sessionId);
  await waitFor(cdp, settingsPage.sessionId, "document.querySelector('h1')?.textContent === 'UseMyCurrentAccount++'");
  await clickByText(cdp, settingsPage.sessionId, "button", "Account");
  await waitFor(cdp, settingsPage.sessionId, "document.querySelector('textarea[aria-label=\"Aliases\"]') !== null");
  await setFormValue(
    cdp,
    settingsPage.sessionId,
    "textarea",
    "Aliases",
    "administrator@contoso.com\ncloud-admin@contoso.com"
  );
  await waitFor(cdp, settingsPage.sessionId, "!document.querySelector('button.primary')?.disabled");
  await clickByText(cdp, settingsPage.sessionId, "button", "Save settings");
  await waitFor(
    cdp,
    settingsPage.sessionId,
    "document.querySelector('.save-message')?.textContent?.includes('Settings saved.')"
  );
  const settingsSaveCheck = await sendRuntimeMessage(cdp, settingsPage.sessionId, { action: "getSettings" });
  assert(settingsSaveCheck.data?.aliases?.includes("cloud-admin@contoso.com"), "The settings Save button did not persist the alias edit.");
  qa.settingsSave = true;

  await sendRuntimeMessage(cdp, settingsPage.sessionId, { action: "saveSettings", settings: samplePatch });
  await sendRuntimeMessage(cdp, settingsPage.sessionId, { action: "clearDiagnostics" });

  const pickerPage = await createPage(cdp, "about:blank", 900, 700, "Microsoft picker fixture", sessionLabels);
  const exactResult = await runPickerFixture(cdp, pickerPage.sessionId, "exact");
  assert(exactResult.clicked === "target" && exactResult.clickCount === "1", "The exact matching picker tile was not clicked exactly once.");
  const approvedOauthUrl = new URL(exactResult.interceptedUrl);
  assert(approvedOauthUrl.searchParams.get("login_hint") === "admin@contoso.com", "The approved OAuth navigation did not add login_hint.");
  assert(approvedOauthUrl.searchParams.get("domain_hint") === "contoso.com", "The approved OAuth navigation did not add domain_hint.");
  assert(approvedOauthUrl.searchParams.get("nonce") === "qa-nonce", "The approved OAuth navigation did not preserve nonce.");
  assert(
    JSON.stringify(approvedOauthUrl.searchParams.getAll("prompt")) === JSON.stringify(["consent"]),
    `The approved OAuth navigation did not remove only prompt=select_account: ${approvedOauthUrl.searchParams.getAll("prompt").join(", ")}`
  );
  qa.oauthTransform = true;
  await waitForDiagnosticKind(cdp, settingsPage.sessionId, "autoPickedAccount");
  qa.pickerExactMatch = true;

  const repeatedHintsResult = await runSimpleMicrosoftFixture(
    cdp,
    pickerPage.sessionId,
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=11111111-2222-3333-4444-555555555555&redirect_uri=https%3A%2F%2Fportal.azure.com%2Fcallback&login_hint=admin%40contoso.com&login_hint=other%40contoso.com&domain_hint=contoso.com&domain_hint=other.contoso.com&state=qa-duplicate-hints"
  );
  const repeatedHintsUrl = new URL(repeatedHintsResult.interceptedUrl);
  assert(
    JSON.stringify(repeatedHintsUrl.searchParams.getAll("login_hint")) === JSON.stringify(["admin@contoso.com"]),
    `The OAuth navigation retained repeated login_hint values: ${repeatedHintsUrl.searchParams.getAll("login_hint").join(", ")}`
  );
  assert(
    JSON.stringify(repeatedHintsUrl.searchParams.getAll("domain_hint")) === JSON.stringify(["contoso.com"]),
    `The OAuth navigation retained repeated domain_hint values: ${repeatedHintsUrl.searchParams.getAll("domain_hint").join(", ")}`
  );
  assert(repeatedHintsUrl.searchParams.get("state") === "qa-duplicate-hints", "The duplicate-hint rewrite did not preserve state.");
  qa.duplicateHintsCanonicalized = true;

  const noMatchResult = await runPickerFixture(cdp, pickerPage.sessionId, "no-match");
  assert(!noMatchResult.clicked && noMatchResult.clickCount === "0", "A no-match picker fixture clicked a tile instead of failing closed.");
  await waitForDiagnosticKind(cdp, settingsPage.sessionId, "noMatchingAccount");
  qa.pickerNoMatch = true;

  const multipleMatchResult = await runPickerFixture(cdp, pickerPage.sessionId, "multiple-match");
  assert(!multipleMatchResult.clicked && multipleMatchResult.clickCount === "0", "A multiple-match picker fixture clicked a tile instead of failing closed.");
  await waitForDiagnosticKind(cdp, settingsPage.sessionId, "multipleMatchingAccounts");
  qa.pickerMultipleMatch = true;

  const unapprovedResult = await runSimpleMicrosoftFixture(
    cdp,
    pickerPage.sessionId,
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=99999999-8888-7777-6666-555555555555&redirect_uri=https%3A%2F%2Freports.contoso.com%2Fcallback&nonce=qa-unapproved&prompt=select_account"
  );
  const unapprovedUrl = new URL(unapprovedResult.interceptedUrl);
  assert(!unapprovedUrl.searchParams.has("login_hint"), "An unapproved OAuth navigation received login_hint.");
  assert(!unapprovedUrl.searchParams.has("domain_hint"), "An unapproved OAuth navigation received domain_hint.");
  assert(unapprovedUrl.searchParams.get("nonce") === "qa-unapproved", "The unapproved OAuth navigation did not preserve nonce.");
  assert(
    JSON.stringify(unapprovedUrl.searchParams.getAll("prompt")) === JSON.stringify(["select_account"]),
    "An unapproved OAuth navigation had its select-account prompt removed."
  );
  qa.unapprovedUntouched = true;

  const federationResult = await runSimpleMicrosoftFixture(
    cdp,
    pickerPage.sessionId,
    "https://login.microsoftonline.com/organizations/wsfed?wtrealm=https%3A%2F%2Fportal.azure.com%2Fapp&wa=wsignin1.0&whr=contoso.com&whr=other.contoso.com"
  );
  const federationUrl = new URL(federationResult.interceptedUrl);
  assert(
    JSON.stringify(federationUrl.searchParams.getAll("whr")) === JSON.stringify(["contoso.com"]),
    `The approved WS-Fed navigation did not canonicalize whr: ${federationUrl.searchParams.getAll("whr").join(", ")}`
  );
  assert(federationUrl.searchParams.get("wa") === "wsignin1.0", "The approved WS-Fed navigation did not preserve wa.");
  assert(federationUrl.searchParams.get("wtrealm") === "https://portal.azure.com/app", "The approved WS-Fed navigation did not preserve wtrealm.");
  qa.federationTransform = true;
  qa.duplicateFederationHintCanonicalized = true;

  await seedDiagnostics(cdp, settingsPage.sessionId);
  await normalizeDiagnosticTimes(cdp, settingsPage.sessionId);
  await reloadPage(cdp, settingsPage.sessionId);
  await waitFor(cdp, settingsPage.sessionId, "document.querySelector('h1')?.textContent === 'UseMyCurrentAccount++'");
  await clickByText(cdp, settingsPage.sessionId, "button", "Diagnostics");
  await waitFor(cdp, settingsPage.sessionId, "document.querySelectorAll('.diagnostics li').length === 3");
  await clickByText(cdp, settingsPage.sessionId, "button", "Clear");
  await waitFor(cdp, settingsPage.sessionId, "document.body.textContent.includes('No diagnostics yet.')");
  const clearCheck = await sendRuntimeMessage(cdp, settingsPage.sessionId, { action: "getSettings" });
  assert(clearCheck.data?.diagnostics?.length === 0, "Clear diagnostics did not empty persisted diagnostics.");
  qa.clearDiagnostics = true;

  await seedDiagnostics(cdp, settingsPage.sessionId);
  await normalizeDiagnosticTimes(cdp, settingsPage.sessionId);

  await reloadPage(cdp, settingsPage.sessionId);
  await waitFor(cdp, settingsPage.sessionId, "document.querySelector('h1')?.textContent === 'UseMyCurrentAccount++'");
  await capturePng(cdp, settingsPage.sessionId, path.join(releaseDir, "screenshot-02-overview.png"));

  await clickByText(cdp, settingsPage.sessionId, "button", "App rules");
  await waitFor(cdp, settingsPage.sessionId, "document.body.textContent.includes('Included apps') && document.body.textContent.includes('portal.azure.com')");
  await evaluate(cdp, settingsPage.sessionId, `
    (() => {
      document.documentElement.style.background = '#f4f7fb';
      document.body.style.background = '#f4f7fb';
      document.querySelector('.control-hero')?.remove();
      document.querySelector('.control-center').style.paddingTop = '24px';
      window.scrollTo(0, 0);
      return true;
    })()
  `);
  await capturePng(cdp, settingsPage.sessionId, path.join(releaseDir, "screenshot-03-approved-apps.png"));

  await reloadPage(cdp, settingsPage.sessionId);
  await waitFor(cdp, settingsPage.sessionId, "document.querySelector('h1')?.textContent === 'UseMyCurrentAccount++'");
  await clickByText(cdp, settingsPage.sessionId, "button", "Diagnostics");
  await waitFor(cdp, settingsPage.sessionId, "document.querySelectorAll('.diagnostics li').length === 3");
  await capturePng(cdp, settingsPage.sessionId, path.join(releaseDir, "screenshot-04-diagnostics.png"));

  await reloadPage(cdp, popupPage.sessionId);
  await waitFor(cdp, popupPage.sessionId, "document.querySelector('input[aria-label=\"Account to auto select\"]')?.value === 'admin@contoso.com'");
  await preparePopupStoreFrame(cdp, popupPage.sessionId);
  await capturePng(cdp, popupPage.sessionId, path.join(releaseDir, "screenshot-01-popup.png"));

  const assetPage = await createPage(cdp, "about:blank", 440, 280, "asset renderer", sessionLabels);
  const logoSvg = await readFile(path.join(extensionDir, "img/UseMyCurrentAccountPlusPlus.svg"), "utf8");
  await renderPromoTile(cdp, assetPage.sessionId, logoSvg);
  await capturePng(cdp, assetPage.sessionId, path.join(releaseDir, "small-promo-440x280.png"));

  await setViewport(cdp, assetPage.sessionId, 128, 128);
  await renderStoreIcon(cdp, assetPage.sessionId, logoSvg);
  await capturePng(cdp, assetPage.sessionId, path.join(releaseDir, "store-icon-128.png"));

  for (const [releaseName, docsName] of [
    ["screenshot-01-popup.png", "store-screenshot-01-popup.png"],
    ["screenshot-02-overview.png", "store-screenshot-02-overview.png"],
    ["screenshot-03-approved-apps.png", "store-screenshot-03-approved-apps.png"],
    ["screenshot-04-diagnostics.png", "store-screenshot-04-diagnostics.png"]
  ]) {
    await copyFile(path.join(releaseDir, releaseName), path.join(docsImagesDir, docsName));
  }
  qa.screenshots = true;

  const relevantErrors = browserErrors.filter((entry) => !entry.text.includes("favicon.ico"));
  assert(relevantErrors.length === 0, `Browser console/runtime errors were recorded:\n${relevantErrors.map(formatBrowserError).join("\n")}`);
  qa.consoleHealth = true;

  const assets = await inspectAssets([
    path.join(releaseDir, "store-icon-128.png"),
    path.join(releaseDir, "small-promo-440x280.png"),
    path.join(releaseDir, "screenshot-01-popup.png"),
    path.join(releaseDir, "screenshot-02-overview.png"),
    path.join(releaseDir, "screenshot-03-approved-apps.png"),
    path.join(releaseDir, "screenshot-04-diagnostics.png")
  ]);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    edge: edgeBinary,
    extensionDir,
    extensionId,
    installedRuleIds,
    dnrMatchOutcomes,
    badge,
    transformProof: {
      approvedOauthUrl: exactResult.interceptedUrl,
      repeatedHintsOauthUrl: repeatedHintsResult.interceptedUrl,
      unapprovedOauthUrl: unapprovedResult.interceptedUrl,
      approvedFederationUrl: federationResult.interceptedUrl
    },
    qa,
    assets
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  if (edgeStderr.length) {
    process.stderr.write(`\nEdge stderr (tail):\n${edgeStderr.join("").slice(-8_000)}\n`);
  }
  process.exitCode = 1;
} finally {
  if (cdp) {
    try {
      await cdp.send("Browser.close");
    } catch {
      // Edge may close the socket before acknowledging Browser.close.
    }
    cdp.close();
  }
  if (!edge.killed) {
    edge.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => edge.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (edge.exitCode === null) {
    edge.kill("SIGKILL");
  }
  if (!options.keepProfile) {
    await rm(profileDir, { recursive: true, force: true });
  } else {
    process.stderr.write(`Temporary Edge profile kept at ${profileDir}\n`);
  }
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--keep-profile") {
      parsed.keepProfile = true;
      continue;
    }
    const key = {
      "--edge": "edge",
      "--extension-dir": "extensionDir",
      "--release-dir": "releaseDir",
      "--docs-images-dir": "docsImagesDir"
    }[arg];
    if (!key || !args[index + 1]) {
      throw new Error(`Unsupported or incomplete argument: ${arg}`);
    }
    parsed[key] = args[index + 1];
    index += 1;
  }
  return parsed;
}

async function waitForDevTools(profile, processHandle) {
  const activePortPath = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Microsoft Edge exited before DevTools became ready (exit ${processHandle.exitCode}).`);
    }
    try {
      const [port, browserPath] = (await readFile(activePortPath, "utf8")).trim().split("\n");
      if (port && browserPath) {
        return { port: Number(port), browserPath };
      }
    } catch {
      // The file appears after the browser has opened its debugging socket.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Microsoft Edge DevTools.");
}

async function waitForExtensionServiceWorker(connection) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const { targetInfos } = await connection.send("Target.getTargets");
    const worker = targetInfos.find((target) => (
      target.type === "service_worker" &&
      /^chrome-extension:\/\/[^/]+\/background\.js$/.test(target.url)
    ));
    if (worker) {
      return worker;
    }
    await delay(100);
  }
  throw new Error("The UseMyCurrentAccount++ MV3 service worker did not start.");
}

async function restartExtensionServiceWorker(connection, targetId, extensionId, controlSessionId) {
  await connection.send("ServiceWorker.enable", {}, controlSessionId);
  await connection.send("ServiceWorker.stopAllWorkers", {}, controlSessionId);
  let stopped = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { targetInfos } = await connection.send("Target.getTargets");
    const stillRunning = targetInfos.some((target) => target.targetId === targetId);
    if (!stillRunning) {
      stopped = true;
      break;
    }
    await delay(50);
  }
  assert(stopped, "Microsoft Edge did not stop the original MV3 service worker.");

  const temporaryTarget = await connection.send("Target.createTarget", {
    url: `chrome-extension://${extensionId}/popup.html`
  });
  const temporarySession = await connection.send("Target.attachToTarget", {
    targetId: temporaryTarget.targetId,
    flatten: true
  });
  await connection.send("Runtime.enable", {}, temporarySession.sessionId);
  await waitFor(connection, temporarySession.sessionId, "document.readyState === 'complete'");
  await retryRuntimeMessage(connection, temporarySession.sessionId, { action: "getSettings" });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { targetInfos } = await connection.send("Target.getTargets");
    const worker = targetInfos.find((target) => (
      target.type === "service_worker" &&
      target.url === `chrome-extension://${extensionId}/background.js`
    ));
    if (worker) {
      await connection.send("Target.closeTarget", { targetId: temporaryTarget.targetId });
      return worker;
    }
    await delay(100);
  }
  const { targetInfos } = await connection.send("Target.getTargets");
  const workers = targetInfos
    .filter((target) => target.type === "service_worker")
    .map((target) => `${target.targetId}:${target.url}`);
  throw new Error(`The MV3 service worker did not restart after an extension-page message. Workers: ${workers.join(", ")}`);
}

async function attachToTarget(connection, targetId, label, labels) {
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true });
  labels.set(sessionId, label);
  await connection.send("Runtime.enable", {}, sessionId);
  await connection.send("Log.enable", {}, sessionId);
  return sessionId;
}

async function createPage(connection, url, width, height, label, labels) {
  const { targetId } = await connection.send("Target.createTarget", { url });
  const sessionId = await attachToTarget(connection, targetId, label, labels);
  await connection.send("Page.enable", {}, sessionId);
  await setViewport(connection, sessionId, width, height);
  await waitFor(connection, sessionId, "document.readyState === 'complete'");
  await evaluate(connection, sessionId, `
    (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          })));
      return true;
    })()
  `);
  return { targetId, sessionId };
}

async function reloadPage(connection, sessionId) {
  await connection.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitFor(connection, sessionId, "document.readyState === 'complete'");
}

async function setViewport(connection, sessionId, width, height) {
  await connection.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);
}

async function evaluate(connection, sessionId, expression) {
  const response = await connection.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, sessionId);
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    throw new Error(`Browser evaluation failed: ${description}`);
  }
  return response.result.value;
}

async function waitFor(connection, sessionId, expression, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(connection, sessionId, `Boolean(${expression})`)) {
        return;
      }
    } catch {
      // A navigation may briefly replace the execution context.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

async function sendRuntimeMessage(connection, sessionId, message) {
  return evaluate(connection, sessionId, `
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(${JSON.stringify(message)}, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    })
  `);
}

async function retryRuntimeMessage(connection, sessionId, message) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await sendRuntimeMessage(connection, sessionId, message);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw lastError || new Error("The extension service worker did not accept a runtime message.");
}

async function clickByText(connection, sessionId, selector, text) {
  const clicked = await evaluate(connection, sessionId, `
    (() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((item) => item.textContent?.trim() === ${JSON.stringify(text)});
      if (!element) return false;
      element.click();
      return true;
    })()
  `);
  assert(clicked, `Could not find ${selector} with text ${JSON.stringify(text)}.`);
}

async function setFormValue(connection, sessionId, tagName, ariaLabel, value) {
  const changed = await evaluate(connection, sessionId, `
    (() => {
      const element = document.querySelector(${JSON.stringify(`${tagName}[aria-label="${ariaLabel}"]`)});
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  assert(changed, `Could not set ${tagName} ${JSON.stringify(ariaLabel)}.`);
}

function buildSampleSettingsPatch() {
  return {
    enabled: true,
    preferredUpn: "admin@contoso.com",
    aliases: ["administrator@contoso.com"],
    rewriteEnabled: true,
    autoPickEnabled: true,
    suppressSelectAccountPrompt: true,
    requireAppApproval: true,
    appApprovals: [
      {
        id: "sample-client",
        enabled: true,
        matchType: "clientId",
        value: "11111111-2222-3333-4444-555555555555",
        label: "Microsoft 365 admin",
        createdAt: "2026-07-15T09:00:00.000Z"
      },
      {
        id: "sample-host",
        enabled: true,
        matchType: "redirectHost",
        value: "portal.azure.com",
        label: "Azure portal",
        createdAt: "2026-07-15T09:05:00.000Z"
      }
    ],
    appExclusions: [
      {
        id: "sample-exclusion",
        enabled: true,
        matchType: "redirectHost",
        value: "legacy.contoso.com",
        label: "Legacy app",
        createdAt: "2026-07-15T09:10:00.000Z"
      }
    ]
  };
}

async function runPickerFixture(connection, sessionId, scenario) {
  const tiles = scenario === "exact"
    ? [
        ["target", "Admin account admin@contoso.com"],
        ["other", "Standard account standard@contoso.com"]
      ]
    : scenario === "no-match"
      ? [
          ["other", "Standard account standard@contoso.com"],
          ["guest", "Guest account guest@contoso.com"]
        ]
      : [
          ["target", "Admin account admin@contoso.com"],
          ["duplicate", "Admin duplicate admin@contoso.com"]
        ];
  const fixtureHtml = `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Microsoft account picker fixture</title>
        <link rel="icon" href="data:," />
        <style>
          body { margin: 40px; font: 16px/1.5 system-ui, sans-serif; color: #111827; }
          button { display: block; width: 440px; min-height: 54px; margin: 12px 0; padding: 12px; text-align: left; }
        </style>
      </head>
      <body data-click-count="0">
        <h1>Pick an account</h1>
        ${tiles.map(([id, label]) => `<button id="${id}" role="button">${label}</button>`).join("\n")}
        <button id="other-account" role="button">Use another account</button>
        <script>
          for (const button of document.querySelectorAll('button:not(#other-account)')) {
            button.addEventListener('click', () => {
              document.body.dataset.clicked = button.id;
              document.body.dataset.clickCount = String(Number(document.body.dataset.clickCount || '0') + 1);
            });
          }
        </script>
      </body>
    </html>`;
  const exactPromptProof = scenario === "exact"
    ? "&prompt=select_account&nonce=qa-nonce&prompt=consent"
    : "";
  const requestUrl = `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=11111111-2222-3333-4444-555555555555&redirect_uri=https%3A%2F%2Fportal.azure.com%2Fqa%2F${scenario}${exactPromptProof}`;

  await connection.send("Fetch.enable", {
    patterns: [{
      urlPattern: "https://login.microsoftonline.com/*",
      resourceType: "Document",
      requestStage: "Request"
    }]
  }, sessionId);
  const pausedRequest = waitForCdpEvent(
    connection,
    (message) => message.sessionId === sessionId && message.method === "Fetch.requestPaused"
  );
  const navigation = connection.send("Page.navigate", { url: requestUrl }, sessionId);
  const paused = await pausedRequest;
  await connection.send("Fetch.fulfillRequest", {
    requestId: paused.params.requestId,
    responseCode: 200,
    responsePhrase: "OK",
    responseHeaders: [
      { name: "Content-Type", value: "text/html; charset=utf-8" },
      { name: "Cache-Control", value: "no-store" }
    ],
    body: Buffer.from(fixtureHtml).toString("base64")
  }, sessionId);
  await navigation;
  await waitFor(connection, sessionId, "document.readyState === 'complete' && document.querySelector('h1')?.textContent === 'Pick an account'");
  if (scenario === "exact") {
    await waitFor(connection, sessionId, "document.body.dataset.clicked === 'target'");
  } else {
    await delay(700);
  }
  await connection.send("Fetch.disable", {}, sessionId);
  const pageResult = await evaluate(connection, sessionId, `({
    clicked: document.body.dataset.clicked || '',
    clickCount: document.body.dataset.clickCount || '0',
    url: location.href
  })`);
  return {
    ...pageResult,
    interceptedUrl: paused.params.request.url
  };
}

async function runSimpleMicrosoftFixture(connection, sessionId, requestUrl) {
  const fixtureHtml = `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Microsoft sign-in transform fixture</title>
        <link rel="icon" href="data:," />
      </head>
      <body><main id="fixture-ready">Safe intercepted Microsoft sign-in fixture.</main></body>
    </html>`;
  await connection.send("Fetch.enable", {
    patterns: [{
      urlPattern: "https://login.microsoftonline.com/*",
      resourceType: "Document",
      requestStage: "Request"
    }]
  }, sessionId);
  const pausedRequest = waitForCdpEvent(
    connection,
    (message) => message.sessionId === sessionId && message.method === "Fetch.requestPaused"
  );
  const navigation = connection.send("Page.navigate", { url: requestUrl }, sessionId);
  const paused = await pausedRequest;
  await connection.send("Fetch.fulfillRequest", {
    requestId: paused.params.requestId,
    responseCode: 200,
    responsePhrase: "OK",
    responseHeaders: [
      { name: "Content-Type", value: "text/html; charset=utf-8" },
      { name: "Cache-Control", value: "no-store" }
    ],
    body: Buffer.from(fixtureHtml).toString("base64")
  }, sessionId);
  await navigation;
  await waitFor(connection, sessionId, "document.readyState === 'complete' && document.querySelector('#fixture-ready') !== null");
  await connection.send("Fetch.disable", {}, sessionId);
  return {
    interceptedUrl: paused.params.request.url,
    finalUrl: await evaluate(connection, sessionId, "location.href")
  };
}

async function waitForDiagnosticKind(connection, sessionId, kind) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const response = await sendRuntimeMessage(connection, sessionId, { action: "getSettings" });
    if (response.success && response.data?.diagnostics?.some((item) => item.kind === kind)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for the ${kind} content-script diagnostic.`);
}

function waitForCdpEvent(connection, predicate, timeout = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for a Microsoft Edge DevTools event."));
    }, timeout);
    const unsubscribe = connection.onEvent((message) => {
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      resolve(message);
    });
  });
}

async function seedDiagnostics(connection, sessionId) {
  const diagnostics = [
    {
      kind: "approvalRequired",
      message: "Unknown app observed; automation stayed off until approval.",
      url: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=99999999-8888-7777-6666-555555555555&redirect_uri=https%3A%2F%2Freports.contoso.com%2Fcallback&state=private-state",
      flow: "oauth",
      tenant: "organizations",
      clientId: "99999999-8888-7777-6666-555555555555",
      redirectHost: "reports.contoso.com",
      redirectPath: "/callback"
    },
    {
      kind: "excludedApp",
      message: "Excluded app detected; automation stayed off.",
      url: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?client_id=22222222-3333-4444-5555-666666666666&redirect_uri=https%3A%2F%2Flegacy.contoso.com%2Fcallback&nonce=private-nonce",
      flow: "oauth",
      tenant: "organizations",
      clientId: "22222222-3333-4444-5555-666666666666",
      redirectHost: "legacy.contoso.com",
      redirectPath: "/callback",
      exclusionId: "sample-exclusion",
      exclusionValue: "legacy.contoso.com"
    },
    {
      kind: "noMatchingAccount",
      message: "No visible account tile matched the configured account.",
      url: "https://login.microsoftonline.com/common/oauth2/authorize?client_id=11111111-2222-3333-4444-555555555555",
      flow: "oauth",
      tenant: "common",
      clientId: "11111111-2222-3333-4444-555555555555",
      redirectHost: "portal.azure.com",
      pickerTileCount: 3,
      pickerMatchCount: 0
    }
  ];

  const clear = await sendRuntimeMessage(connection, sessionId, { action: "clearDiagnostics" });
  assert(clear.success === true, "Could not reset diagnostics before seeding.");
  for (const diagnostic of diagnostics) {
    const response = await sendRuntimeMessage(connection, sessionId, { action: "recordPickerResult", diagnostic });
    assert(response.success === true, `Could not record ${diagnostic.kind} diagnostic.`);
  }
}

async function normalizeDiagnosticTimes(connection, sessionId) {
  await evaluate(connection, sessionId, `
    (async () => {
      const key = ${JSON.stringify(SETTINGS_KEY)};
      const result = await chrome.storage.local.get(key);
      const settings = result[key];
      const times = ${JSON.stringify(FIXED_DIAGNOSTIC_TIMES)};
      const ids = ${JSON.stringify(FIXED_DIAGNOSTIC_IDS)};
      settings.diagnostics = settings.diagnostics.map((item, index) => ({
        ...item,
        id: ids[index] || ('qa-diagnostic-' + index),
        occurredAt: times[index] || times[times.length - 1]
      }));
      await chrome.storage.local.set({ [key]: settings });
      return settings.diagnostics.length;
    })()
  `);
}

async function preparePopupStoreFrame(connection, sessionId) {
  const storyHtml = `
    <div style="display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:#ccfbf1;color:#115e59;padding:8px 13px;font-size:14px;font-weight:800;">LOCAL-FIRST MICROSOFT SIGN-IN</div>
    <h2 style="margin:22px 0 14px;font-size:48px;line-height:1.08;letter-spacing:-1.5px;">Keep this browser profile on the right account.</h2>
    <p style="margin:0;color:#475569;font-size:21px;line-height:1.5;">Choose one account, pause instantly, and open the full controls when you need approved-app rules or local diagnostics.</p>
  `;
  await evaluate(connection, sessionId, `
    (() => {
      document.body.classList.remove('popup-surface');
      document.documentElement.style.width = '1280px';
      document.documentElement.style.height = '800px';
      document.body.style.width = '1280px';
      document.body.style.height = '800px';
      document.body.style.overflow = 'hidden';
      document.body.style.display = 'grid';
      document.body.style.gridTemplateColumns = '1fr 500px';
      document.body.style.alignItems = 'center';
      document.body.style.gap = '70px';
      document.body.style.padding = '80px 110px';
      document.body.style.background = 'linear-gradient(135deg, #ecfeff 0%, #eff6ff 52%, #f8fafc 100%)';
      const root = document.querySelector('#root');
      root.style.width = '400px';
      root.style.minWidth = '400px';
      root.style.maxWidth = '400px';
      root.style.minHeight = '0';
      root.style.height = 'auto';
      root.style.gridColumn = '2';
      root.style.gridRow = '1';
      root.style.justifySelf = 'end';
      root.style.borderRadius = '14px';
      root.style.overflow = 'hidden';
      root.style.boxShadow = '0 28px 70px rgba(15, 23, 42, .22)';
      root.style.border = '1px solid rgba(148, 163, 184, .45)';
      const shell = document.querySelector('.popup-shell');
      shell.style.maxHeight = 'none';
      const story = document.createElement('section');
      story.id = 'store-story';
      story.style.gridColumn = '1';
      story.style.gridRow = '1';
      story.style.maxWidth = '520px';
      story.style.color = '#0f172a';
      story.innerHTML = ${JSON.stringify(storyHtml)};
      document.body.prepend(story);
      return true;
    })()
  `);
}

async function renderPromoTile(connection, sessionId, logoSvg) {
  const logoUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
  const promoHtml = `
    <main style="position:relative;width:440px;height:280px;padding:34px 31px;display:grid;grid-template-columns:120px 1fr;align-items:center;gap:24px;box-sizing:border-box;">
      <div style="position:absolute;width:190px;height:190px;border-radius:999px;right:-60px;top:-85px;background:rgba(37,99,235,.10);"></div>
      <div style="position:absolute;width:145px;height:145px;border-radius:999px;left:-75px;bottom:-85px;background:rgba(15,118,110,.12);"></div>
      <img src="${logoUrl}" alt="" style="position:relative;width:120px;height:120px;filter:drop-shadow(0 15px 22px rgba(15,23,42,.18));" />
      <section style="position:relative;min-width:0;">
        <p style="margin:0 0 9px;color:#0f766e;font-size:13px;font-weight:850;letter-spacing:.07em;">MICROSOFT SIGN-IN</p>
        <h1 style="margin:0;font-size:28px;line-height:1.06;letter-spacing:-.6px;overflow-wrap:anywhere;"><span style="display:block;">UseMyCurrent</span><span style="display:block;">Account++</span></h1>
        <p style="margin:13px 0 0;color:#475569;font-size:15px;line-height:1.42;">One browser profile.<br />One chosen account.</p>
      </section>
    </main>
  `;
  await evaluate(connection, sessionId, `
    (() => {
      document.documentElement.style.cssText = 'width:440px;height:280px;margin:0;background:#f8fafc;';
      document.body.style.cssText = 'width:440px;height:280px;margin:0;overflow:hidden;background:linear-gradient(135deg,#ecfeff 0%,#eff6ff 58%,#f8fafc 100%);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;';
      document.body.innerHTML = ${JSON.stringify(promoHtml)};
      return Promise.all([...document.images].map((image) => image.decode())).then(() => true);
    })()
  `);
}

async function renderStoreIcon(connection, sessionId, logoSvg) {
  const logoUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
  const iconHtml = `<img alt="" src="${logoUrl}" style="display:block;width:128px;height:128px" />`;
  await evaluate(connection, sessionId, `
    (() => {
      document.documentElement.style.cssText = 'width:128px;height:128px;margin:0;background:#f8fafc;';
      document.body.style.cssText = 'width:128px;height:128px;margin:0;overflow:hidden;background:#f8fafc;';
      document.body.innerHTML = ${JSON.stringify(iconHtml)};
      return document.images[0].decode().then(() => true);
    })()
  `);
}

async function capturePng(connection, sessionId, outputPath) {
  await connection.send("Page.bringToFront", {}, sessionId);
  await evaluate(connection, sessionId, `
    (async () => {
      await (document.fonts?.ready || Promise.resolve());
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()
  `);
  await delay(150);
  const { data } = await connection.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  }, sessionId);
  await writeFile(outputPath, Buffer.from(data, "base64"));
}

async function inspectAssets(paths) {
  const assets = [];
  for (const assetPath of paths) {
    const data = await readFile(assetPath);
    const metadata = readPngMetadata(data);
    const fileStat = await stat(assetPath);
    assert(metadata.colorType === 2, `${path.basename(assetPath)} must be truecolor RGB without alpha (PNG color type 2), found ${metadata.colorType}.`);
    assets.push({
      path: path.relative(PROJECT_ROOT, assetPath),
      width: metadata.width,
      height: metadata.height,
      colorMode: "RGB",
      bytes: fileStat.size,
      sha256: createHash("sha256").update(data).digest("hex")
    });
  }
  return assets;
}

function readPngMetadata(data) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(data.subarray(0, 8).equals(signature), "Expected a PNG asset.");
  assert(data.subarray(12, 16).toString("ascii") === "IHDR", "Expected a PNG IHDR chunk.");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25]
  };
}

function collectBrowserError(message, labels, errors) {
  const label = labels.get(message.sessionId);
  if (!label) {
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    errors.push({
      label,
      type: "exception",
      text: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text
    });
  }
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) {
    errors.push({ label, type: message.params.entry.level, text: message.params.entry.text });
  }
  if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
    errors.push({
      label,
      type: message.params.type,
      text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
    });
  }
}

function formatBrowserError(entry) {
  return `[${entry.label}] ${entry.type}: ${entry.text}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
