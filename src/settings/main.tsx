import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { type UseMyCurrentAccountSettings } from "../lib/settings";
import { sendMessage } from "../ui/runtime";
import { SettingsEditor, type EditableSettingsPatch } from "../ui/SettingsEditor";

function SettingsApp() {
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

  async function save(next: EditableSettingsPatch) {
    setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "saveSettings", settings: next }));
  }

  if (error) {
    return <main className="app"><p className="message error">{error}</p></main>;
  }

  if (!settings) {
    return <main className="app"><p className="empty">Loading...</p></main>;
  }

  return (
    <SettingsEditor
      settings={settings}
      onSave={save}
      onClearDiagnostics={async () => setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "clearDiagnostics" }))}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
);
