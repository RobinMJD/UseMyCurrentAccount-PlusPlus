import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { DEFAULT_SETTINGS, mergeSettings, type UseMyCurrentAccountSettings } from "../lib/settings";
import { sendMessage } from "../ui/runtime";
import { SettingsEditor } from "../ui/SettingsEditor";

function SettingsApp() {
  const [settings, setSettings] = useState<UseMyCurrentAccountSettings | undefined>();
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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

  async function save(next: UseMyCurrentAccountSettings) {
    setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "saveSettings", settings: next }));
  }

  function exportSettings() {
    if (!settings) return;
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "usemycurrentaccount-plusplus-settings.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<UseMyCurrentAccountSettings>;
    await save(mergeSettings(parsed));
  }

  if (error) {
    return <main className="app"><p className="message error">{error}</p></main>;
  }

  if (!settings) {
    return <main className="app"><p className="empty">Loading...</p></main>;
  }

  return (
    <>
      <SettingsEditor
        settings={settings}
        onSave={save}
        onRefreshIdentity={async () => setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "refreshProfileIdentity" }))}
        onClearDiagnostics={async () => setSettings(await sendMessage<UseMyCurrentAccountSettings>({ action: "clearDiagnostics" }))}
      />
      <main className="app secondary">
        <section className="panel">
          <div className="section-title">
            <h2>Import / Export</h2>
          </div>
          <div className="action-row">
            <button type="button" onClick={exportSettings}>Export JSON</button>
            <button type="button" onClick={() => fileInput.current?.click()}>Import JSON</button>
            <button type="button" className="danger" onClick={() => void save(structuredClone(DEFAULT_SETTINGS))}>Reset</button>
          </div>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="application/json"
            onChange={(event) => void importSettings(event.currentTarget.files?.[0])}
          />
        </section>
        <section className="panel about">
          <h2>About</h2>
          <p>
            UseMyCurrentAccount++ is a local-first rewrite of Claire Novotny LLC's original Use My Current Account extension.
            It updates the extension for Chromium Manifest V3 and adds a fail-closed account-picker fallback.
          </p>
          <p>
            Repository: <a href="https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus">RobinMJD/UseMyCurrentAccount-PlusPlus</a>
          </p>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
);
