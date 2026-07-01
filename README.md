# UseMyCurrentAccount++

UseMyCurrentAccount++ is a Chromium Manifest V3 extension for Microsoft Edge and Chrome. It helps Microsoft sign-in flows use the account configured for the current browser profile instead of repeatedly showing the Microsoft account picker.

It is a full rewrite inspired by Claire Novotny LLC's original [UseMyCurrentAccount](https://github.com/novotnyllc/UseMyCurrentAccount) extension, with a modern MV3 architecture, editable account targeting, safer diagnostics, and a fail-closed account-picker fallback.

## What It Does

- Adds `login_hint` and `domain_hint` to Microsoft OAuth/OIDC authorize URLs.
- Adds `whr` to Microsoft SAML and WS-Fed sign-in URLs.
- Optionally removes only `prompt=select_account` from OAuth URLs.
- Auto-clicks a Microsoft account-picker tile only when exactly one visible tile matches the account to auto select or configured aliases.
- Keeps the popup focused on ON/OFF and account entry, with advanced behavior controls in the full settings page.
- Stores all settings and diagnostics locally in the browser profile.

## Install For Development

This repository uses pnpm:

```powershell
pnpm install
pnpm test
pnpm run build
```

Then load `dist/` from `edge://extensions` or `chrome://extensions`.

## Manual Verification

1. Load `dist/` as an unpacked extension.
2. Open the popup and configure the account to auto select, for example `admin.user@example.com`.
3. Visit a Microsoft OAuth authorize flow that normally shows "Pick an account".
4. Confirm the flow either skips the picker or auto-selects the exact matching account.
5. Disable the extension from the popup and confirm Microsoft sign-in is no longer modified.
6. Clear the account to auto select and confirm no automatic click happens.

## Privacy

UseMyCurrentAccount++ is local-first. It does not send account settings or diagnostics to a service. It only modifies navigation to `login.microsoftonline.com` in the local browser profile.

## Limitations

- The extension cannot read the Windows connected-account list directly. Browser identity is only used as a hidden best-effort prefill where Chrome or Edge supports it.
- If Microsoft changes the account picker markup, the content script fails closed and records a diagnostic instead of clicking.
- App sign-in policies, MFA, conditional access, consent, and claims challenges can still require interactive Microsoft prompts.

## Development

```bash
pnpm install
pnpm test
pnpm run type-check
pnpm run build
```

## Attribution

Original idea and MIT-licensed implementation: Claire Novotny LLC, [UseMyCurrentAccount](https://github.com/novotnyllc/UseMyCurrentAccount).

UseMyCurrentAccount++ keeps the same practical goal while updating the extension for Chromium Manifest V3 and adding explicit configuration and diagnostics.

## License

MIT. See `LICENSE`.
