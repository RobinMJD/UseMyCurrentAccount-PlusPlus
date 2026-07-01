# Privacy

UseMyCurrentAccount++ keeps its data local to the browser profile.

The extension stores:

- whether the extension is enabled
- account to auto select
- optional account aliases
- URL rewrite and auto-pick preferences
- recent local diagnostics

The extension does not operate a backend service and does not transmit settings or diagnostics to the author. Browser profile identity, where available, is used only as a local best-effort prefill and is not shown in the UI.

The extension has host access only for `https://login.microsoftonline.com/*` so it can add Microsoft sign-in hints and inspect the Microsoft account picker. Account-picker automation fails closed when it cannot find exactly one matching visible account tile.
