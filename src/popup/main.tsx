import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { type UseMyCurrentAccountSettings } from "../lib/settings";
import { sendMessage } from "../ui/runtime";
import { SettingsEditor } from "../ui/SettingsEditor";

function PopupApp() {
  const [settings, setSettings] = useState<UseMyCurrentAccountSettings | undefined>();
  const [error, setError] = useState("");

  async function load() {
    try {
      setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "getSettings" }));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load settings.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return <main className="app compact"><p className="message error">{error}</p></main>;
  }

  if (!settings) {
    return <main className="app compact"><p className="empty">Loading...</p></main>;
  }

  return (
    <SettingsEditor
      compact
      settings={settings}
      onSave={async (next) => setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "saveSettings", settings: next }))}
      onRefreshIdentity={async () => setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "refreshProfileIdentity" }))}
      onClearDiagnostics={async () => setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "clearDiagnostics" }))}
      onOpenSettings={() => chrome.runtime.openOptionsPage()}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
);
