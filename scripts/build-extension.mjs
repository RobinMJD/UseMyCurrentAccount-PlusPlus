import { copyFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { build } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(projectRoot, "dist");

// Build extension pages and the module service worker with normal Vite code splitting.
await build({ root: projectRoot });

// Manifest content scripts are classic scripts. Build this entry separately so every
// dependency is bundled into one IIFE instead of leaving ESM imports in accountPicker.js.
await build({
  configFile: false,
  root: projectRoot,
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    outDir: outputDirectory,
    rollupOptions: {
      input: resolve(projectRoot, "src/content/accountPickerEntry.ts"),
      output: {
        entryFileNames: "accountPicker.js",
        format: "iife"
      }
    }
  }
});

await copyFile(resolve(projectRoot, "LICENSE"), resolve(outputDirectory, "LICENSE.txt"));
await copyFile(
  resolve(projectRoot, "THIRD_PARTY_NOTICES.txt"),
  resolve(outputDirectory, "THIRD_PARTY_NOTICES.txt")
);

const contentScriptPath = resolve(outputDirectory, "accountPicker.js");
const contentScript = await readFile(contentScriptPath, "utf8");
const projectLicense = await readFile(resolve(outputDirectory, "LICENSE.txt"), "utf8");
const thirdPartyNotices = await readFile(resolve(outputDirectory, "THIRD_PARTY_NOTICES.txt"), "utf8");

try {
  // Parsing as a classic script rejects any accidental top-level import/export syntax.
  new Script(contentScript, { filename: contentScriptPath });
} catch (error) {
  throw new Error(
    `The packaged account picker is not a self-contained classic script: ${error instanceof Error ? error.message : String(error)}`
  );
}

if (!projectLicense.includes("MIT License") || !projectLicense.includes("UseMyCurrentAccount++ contributors")) {
  throw new Error("The packaged project license is missing or incomplete.");
}
if (
  !thirdPartyNotices.includes("React, React DOM, and Scheduler") ||
  !thirdPartyNotices.includes("Copyright (c) Meta Platforms, Inc. and affiliates.") ||
  !thirdPartyNotices.includes("Permission is hereby granted")
) {
  throw new Error("The packaged React third-party notice is missing or incomplete.");
}

console.log("Verified the classic content script and packaged license notices.");
