import { getBadgeState } from "./lib/badge";
import { buildDynamicRules, MANAGED_DYNAMIC_RULE_IDS } from "./lib/dnrRules";
import { isTrustedRuntimeSender, validateUseMyCurrentAccountMessage } from "./lib/messages";
import {
  addDiagnostic,
  applyDetectedProfileEmailPrefill,
  loadSettings,
  mergeSettings,
  saveSettings,
  SETTINGS_KEY,
  type UseMyCurrentAccountSettings
} from "./lib/settings";

void initializeExtension();

chrome.runtime.onInstalled?.addListener(() => {
  void initializeExtension();
});

chrome.runtime.onStartup?.addListener(() => {
  void initializeExtension();
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    const settings = mergeSettings(changes[SETTINGS_KEY].newValue as Partial<UseMyCurrentAccountSettings> | undefined);
    void updateRuntimeState(settings);
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

async function initializeExtension(): Promise<void> {
  const settings = await refreshProfileIdentity();
  await updateRuntimeState(settings);
}

async function handleMessage(message: ReturnType<typeof validateUseMyCurrentAccountMessage>): Promise<unknown> {
  switch (message.action) {
    case "getSettings":
      return loadSettings();
    case "saveSettings": {
      const saved = await saveSettings(message.settings);
      await updateRuntimeState(saved);
      return saved;
    }
    case "recordPickerResult": {
      const settings = await loadSettings();
      return saveSettings(addDiagnostic(settings, message.diagnostic));
    }
    case "clearDiagnostics": {
      const settings = await loadSettings();
      return saveSettings({ ...settings, diagnostics: [] });
    }
    default:
      throw new Error("Unsupported UseMyCurrentAccount++ message.");
  }
}

async function refreshProfileIdentity(): Promise<UseMyCurrentAccountSettings> {
  const settings = await loadSettings();
  const profile = await getProfileUserInfo();
  return saveSettings(applyDetectedProfileEmailPrefill(settings, profile.email));
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
  await Promise.all([updateDynamicRules(settings), updateBadge(settings)]);
}

async function updateDynamicRules(settings: UseMyCurrentAccountSettings): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  const addRules = settings.enabled && settings.rewriteEnabled && settings.preferredUpn
    ? buildDynamicRules(settings)
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: MANAGED_DYNAMIC_RULE_IDS,
    addRules
  });
}

async function updateBadge(settings: UseMyCurrentAccountSettings): Promise<void> {
  if (!chrome.action) {
    return;
  }
  const badge = getBadgeState(settings);
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setTitle({ title: badge.title });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected UseMyCurrentAccount++ error.";
}
