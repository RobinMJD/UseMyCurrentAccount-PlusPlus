# Privacy

UseMyCurrentAccount++ keeps its data local to the browser profile.

The extension stores:

- whether the extension is enabled
- preferred Microsoft account UPN
- optional account aliases
- URL rewrite and auto-pick preferences
- recent local diagnostics

The extension does not operate a backend service and does not transmit settings or diagnostics to the author.

The extension has host access only for `https://login.microsoftonline.com/*` so it can add Microsoft sign-in hints and inspect the Microsoft account picker. Account-picker automation fails closed when it cannot find exactly one matching visible account tile.
