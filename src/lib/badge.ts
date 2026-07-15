import { normalizeUpn, type UseMyCurrentAccountSettings } from "./settings";

export type BadgeReason = "enabled" | "disabled" | "missingAccount" | "noAutomation";

export interface BadgeState {
  text: "ON" | "OFF";
  color: string;
  title: string;
  reason: BadgeReason;
  isOperational: boolean;
}

export function getBadgeState(settings: UseMyCurrentAccountSettings): BadgeState {
  if (!settings.enabled) {
    return {
      text: "OFF",
      color: "#dc2626",
      title: "UseMyCurrentAccount++ is OFF",
      reason: "disabled",
      isOperational: false
    };
  }

  if (!normalizeUpn(settings.preferredUpn)) {
    return {
      text: "OFF",
      color: "#dc2626",
      title: "UseMyCurrentAccount++ is OFF: set an account to auto select",
      reason: "missingAccount",
      isOperational: false
    };
  }

  if (!settings.rewriteEnabled && !settings.autoPickEnabled) {
    return {
      text: "OFF",
      color: "#dc2626",
      title: "UseMyCurrentAccount++ is OFF: URL rewriting and account auto-pick are disabled",
      reason: "noAutomation",
      isOperational: false
    };
  }

  return {
    text: "ON",
    color: "#16a34a",
    title: "UseMyCurrentAccount++ is ON",
    reason: "enabled",
    isOperational: true
  };
}
