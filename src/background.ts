import { getBadgeState } from "./lib/badge";
import {
  buildActiveDynamicRules,
  getDynamicRulesStateKey,
  MANAGED_DYNAMIC_RULE_IDS
} from "./lib/dnrRules";
import { isTrustedRuntimeSender, validateUseMyCurrentAccountMessage } from "./lib/messages";
import { createRuntimeStateScheduler } from "./lib/runtimeStateScheduler";
import {
  appendDiagnostic,
  clearStoredDiagnostics,
  loadSettings,
  migrateLegacySettings,
  prefillProfileEmailOnFreshInstall,
  SETTINGS_KEY,
  updateSettings,
  type UseMyCurrentAccountSettings
} from "./lib/settings";

const scheduleRuntimeStateUpdate = createRuntimeStateScheduler(loadSettings, updateRuntimeState);

void initializeExtension();

chrome.runtime.onInstalled?.addListener((details) => {
  void initializeExtension(details.reason === "install");
});

chrome.runtime.onStartup?.addListener(() => {
  void initializeExtension();
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    void scheduleRuntimeStateUpdate().catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedRuntimeSender(sender)) {
    sendResponse({ success: false, error: "Untrusted UseMyCurrentAccount++ message sender." });
    return false;
  }

  let validatedMessage: ReturnType<typeof validateUseMyCurrentAccountMessage>;
  try {
    validatedMessage = validateUseMyCurrentAccountMessage(message);
  } catch (error) {
    sendResponse({ success: false, error: getErrorMessage(error) });
    return false;
  }

  handleMessage(validatedMessage)
    .then((data) => sendResponse({ success: true, data }))
    .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
  return true;
});

async function initializeExtension(prefillProfileEmail = false): Promise<void> {
  await migrateLegacySettings();
  if (prefillProfileEmail) {
    await prefillProfileIdentity();
  }
  await scheduleRuntimeStateUpdate();
}

async function handleMessage(message: ReturnType<typeof validateUseMyCurrentAccountMessage>): Promise<unknown> {
  switch (message.action) {
    case "getSettings":
      return loadSettings();
    case "saveSettings": {
      const saved = await updateSettings(message.settings);
      await scheduleRuntimeStateUpdate();
      return saved;
    }
    case "recordPickerResult":
      return appendDiagnostic(message.diagnostic);
    case "clearDiagnostics":
      return clearStoredDiagnostics();
    default:
      throw new Error("Unsupported UseMyCurrentAccount++ message.");
  }
}

async function prefillProfileIdentity(): Promise<UseMyCurrentAccountSettings> {
  const profile = await getProfileUserInfo();
  return prefillProfileEmailOnFreshInstall(profile.email);
}

async function getProfileUserInfo(): Promise<chrome.identity.ProfileUserInfo> {
  if (!chrome.identity?.getProfileUserInfo) {
    return { email: "", id: "" };
  }
  return new Promise((resolve) => {
    try {
      chrome.identity.getProfileUserInfo({ accountStatus: "ANY" as chrome.identity.AccountStatus }, (profile) => {
        resolve(profile || { email: "", id: "" });
      });
    } catch {
      resolve({ email: "", id: "" });
    }
  });
}

async function updateRuntimeState(settings: UseMyCurrentAccountSettings): Promise<void> {
  const results = await Promise.allSettled([updateDynamicRules(settings), updateBadge(settings)]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) {
    throw failure.reason;
  }
}

let appliedDynamicRulesStateKey: string | undefined;
let appliedBadgeStateKey: string | undefined;

async function updateDynamicRules(settings: UseMyCurrentAccountSettings): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  const stateKey = getDynamicRulesStateKey(settings);
  if (stateKey === appliedDynamicRulesStateKey) {
    return;
  }
  appliedDynamicRulesStateKey = stateKey;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: MANAGED_DYNAMIC_RULE_IDS,
      addRules: buildActiveDynamicRules(settings)
    });
  } catch (error) {
    if (appliedDynamicRulesStateKey === stateKey) {
      appliedDynamicRulesStateKey = undefined;
    }
    throw error;
  }
}

async function updateBadge(settings: UseMyCurrentAccountSettings): Promise<void> {
  if (!chrome.action) {
    return;
  }
  const badge = getBadgeState(settings);
  const stateKey = JSON.stringify(badge);
  if (stateKey === appliedBadgeStateKey) {
    return;
  }
  appliedBadgeStateKey = stateKey;

  try {
    await chrome.action.setBadgeText({ text: badge.text });
    await chrome.action.setBadgeBackgroundColor({ color: badge.color });
    await chrome.action.setTitle({ title: badge.title });
  } catch (error) {
    if (appliedBadgeStateKey === stateKey) {
      appliedBadgeStateKey = undefined;
    }
    throw error;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected UseMyCurrentAccount++ error.";
}
