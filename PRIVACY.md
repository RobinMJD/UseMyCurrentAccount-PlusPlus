# Privacy Policy

Effective date: July 15, 2026

UseMyCurrentAccount++ is a local-first browser extension. It does not sell user data or send settings or diagnostics to the developer. It has no developer-controlled backend, advertising, or analytics.

To provide its user-facing sign-in feature, the browser may send the configured account as `login_hint` and its domain as `domain_hint` or `whr` directly to Microsoft's `login.microsoftonline.com` service over HTTPS. This happens only when URL rewriting is enabled and the user navigates through a supported Microsoft sign-in flow. The developer does not receive or remotely store those values.

## Data Stored Locally

The extension stores the following data in the current browser profile using `chrome.storage.local`:

- Extension enabled or disabled state.
- Account to auto select.
- Account aliases entered by the user.
- Behavior toggles for URL rewrite, account picker automation, exact `prompt=select_account` suppression, and approved-apps-only mode.
- App approvals and exclusions by Microsoft application client ID or redirect/reply host.
- Local diagnostics for troubleshooting approval, exclusion, and picker decisions.

While URL rewriting is configured, Chromium's browser-managed dynamic-rule storage also contains the active account or domain hint and the minimum application matching values needed to apply approvals and exclusions. Those rules stay inside the browser and are replaced when settings change. They are removed when the Extension, URL rewriting, or the configured account is turned off or cleared.

To preserve an approval or exclusion decision across Microsoft picker navigation in the same tab, the content script may temporarily place a sanitized app context in `sessionStorage` on `login.microsoftonline.com`. It contains only the sign-in flow path, app client ID, redirect/reply host and path, and a timestamp. It expires after 10 minutes and is removed after a successful picker selection, when invalid, or when the tab session ends.

Diagnostics are limited to operational metadata such as event type, event ID, timestamp, Microsoft sign-in flow type, tenant path segment, client ID, redirect/reply host, rule ID, changed parameter names, picker tile counts, and exclusion IDs. Diagnostic URL display values redact or omit sensitive OAuth/session parameters such as `state`, `nonce`, `claims`, `redirect_uri`, and `login_hint`.

Diagnostics are capped at the 60 most recent events. They remain in the current browser profile until the user clears them or removes the extension. Temporary per-tab app context is retained for at most 10 minutes as described above.

Where supported by the browser, the extension may call the Chromium identity API once during initial installation to prefill the normal editable account field from the browser profile email. It does not retain a separate hidden copy of the profile email. Clearing the account removes that value and it is not restored on browser or extension restart. Older stored settings are migrated to remove the legacy hidden profile-email field.

## Data Use

Stored data is used only to:

- Add Microsoft sign-in hints for the configured account.
- Select exactly one matching account tile on Microsoft account-picker pages.
- Automate only configured app approvals when approved-apps-only mode is enabled.
- Skip automation for configured app exclusions.
- Show local status, settings, statistics, and diagnostics.

The configured account and domain are disclosed to Microsoft only as sign-in hints for the flow the user is visiting. Microsoft processes the resulting sign-in request under its own privacy terms. Account-picker page content, approvals, exclusions, and diagnostics are otherwise processed locally and are not sent to Microsoft by the Extension as separate telemetry.

## Data Sharing

UseMyCurrentAccount++ does not send extension data to any developer server, analytics service, or advertising service. Its only feature-related transfer is the configured account or domain hint sent directly to Microsoft as part of the Microsoft sign-in request described above. It does not transfer data for advertising, profiling, resale, creditworthiness, or any purpose unrelated to the Extension's single purpose.

UseMyCurrentAccount++'s use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including the Limited Use requirements.

## Data Deletion

Users can delete diagnostics from the full settings page. Users can remove account values, aliases, app approvals, and app exclusions from the extension settings. A removed account remains removed after browser and extension restarts. Disabling the Extension, disabling URL rewriting, or clearing the account removes its active dynamic rules. Removing the Extension deletes its local extension storage according to browser behavior.

## Permissions

The extension requests access only to `https://login.microsoftonline.com/*` so it can update Microsoft sign-in URLs and inspect Microsoft account-picker pages. It requests Chromium identity permissions only for the one-time local installation prefill described above and does not request OAuth access tokens. Declarative Net Request permission is used only to apply the configured sign-in hints and app approval/exclusion rules to top-level Microsoft sign-in navigation.

## Contact

Privacy questions may be sent to [mjd.dev@gmail.com](mailto:mjd.dev@gmail.com). Public support requests may also be submitted through the [GitHub issue tracker](https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/issues).
