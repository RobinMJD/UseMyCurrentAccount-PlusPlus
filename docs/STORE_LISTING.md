# Chrome Web Store Listing

This file is the source of truth for the manually maintained Chrome Web Store listing and privacy declarations.

## Listing

**Name**

UseMyCurrentAccount++

**Summary**

Use the configured browser-profile account when signing in to Microsoft sites.

**Category**

Productivity

**Language**

English

**Detailed description**

UseMyCurrentAccount++ keeps Microsoft sign-ins on one account chosen for the current browser profile.

It modifies only top-level navigation to login.microsoftonline.com. For OAuth/OIDC sign-ins it adds login_hint and domain_hint only when the application did not already supply an account or domain hint. Application-provided login_hint, domain_hint, or username values—and the associated prompt—stay unchanged. For SAML and WS-Fed sign-ins it adds whr. It can optionally remove only prompt=select_account on requests the extension rewrites.

If Microsoft still displays the account picker, the extension examines visible account tiles and clicks only when exactly one tile matches the configured account or an alias. No match or multiple matches means no click.

Features:

- Configure one Microsoft account per browser profile.
- Add Microsoft sign-in hints before the sign-in page loads when the application did not provide its own hint.
- Preserve application-provided account/domain hints to avoid extension-created duplicate parameters.
- Select exactly one matching account-picker tile.
- Limit automation to approved application client IDs or redirect/reply hosts.
- Exclude selected applications from automation.
- Review sanitized local diagnostics for approval, exclusion, and picker decisions.
- Pause automation without deleting saved settings.

Privacy:

The extension locally processes the configured email or UPN, Microsoft sign-in URL context, and Microsoft account-picker page content. Source settings and sanitized diagnostics are stored in chrome.storage.local. While URL rewriting is configured, the active account/domain hints and application matches are also represented in Chromium-managed dynamic rules. When a supported sign-in without an application-provided hint is visited, the configured account or domain hint is sent directly to Microsoft's sign-in service as part of that request. No extension data is sent to a developer server, sold, or used for advertising or analytics.

The extension is limited to login.microsoftonline.com. Browser profile identity is used only once on initial installation for a local best-effort prefill when supported; no separate hidden copy is retained.

UseMyCurrentAccount++ is independent and is not affiliated with or endorsed by Microsoft.

## URLs

- Homepage: `https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus`
- Support: `https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/issues`
- Privacy policy: `https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/blob/main/PRIVACY.md`
- Terms of use: `https://github.com/RobinMJD/UseMyCurrentAccount-PlusPlus/blob/main/TERMS.md`
- Official URL: blank unless a publisher-owned domain is verified

## Privacy declarations

**Single purpose**

Use one user-selected Microsoft account for sign-in flows in the current browser profile by adding Microsoft sign-in hints when the application did not provide its own hint and, when necessary, selecting the one exact matching account-picker tile.

**Remote code**

No. All executable code is included in the extension package and the extension-page content security policy permits local scripts only.

**Data types**

- Personally identifiable information: configured UPN/email, aliases, and the optional browser-profile email prefill.
- Web history: Microsoft sign-in path, tenant segment, client ID, redirect/reply host/path, and timestamp retained in sanitized local diagnostics.
- Website content: visible Microsoft account-picker tile content examined for an exact local match.

The configured UPN/email or domain is transferred directly to Microsoft only as the requested sign-in hint. Other listed data is processed and retained locally; none is sent to the developer.

Do not select authentication information: the Extension does not collect passwords, tokens, cookies, PINs, or authentication secrets. Do not select user activity, communications, location, health, financial, or payment data.

Certify all standard Limited Use statements: no sale, no unrelated use or transfer, no advertising use, and no creditworthiness or lending use.

## Permission justifications

**storage**

Stores the enabled state, selected account, aliases, automation controls, application approvals/exclusions, and sanitized diagnostics locally in the current browser profile. Nothing is synced or sent to a developer server.

**identity**

Uses `chrome.identity.getProfileUserInfo` only once on initial installation for a local best-effort browser-profile account prefill. It does not retain a separate hidden profile-email value or request OAuth access tokens.

**identity.email**

Allows `getProfileUserInfo` to return the current browser-profile email so the editable account field can be prefilled locally on a new installation. The user can edit or clear the value, and clearing it remains effective after restarts.

**declarativeNetRequestWithHostAccess**

Creates dynamic rules that add `login_hint`/`domain_hint` or `whr` and optionally remove only `prompt=select_account` on top-level Microsoft sign-in navigations. Higher-priority rules leave OAuth/OIDC requests untouched when the application already supplied an account or domain hint. Because Chromium rules cannot decode parameter names before a transform, OAuth/OIDC requests with a percent-encoded top-level parameter name also fail closed and remain untouched. Rules also enforce configured application approvals and exclusions.

**https://login.microsoftonline.com/***

Required to modify Microsoft sign-in URLs and examine Microsoft account-picker pages. The extension has no access to other websites.

## Distribution

- Visibility: Public
- Pricing: Free
- Regions: All regions
- Mature content: No
- Trader status: use the publisher account's verified declaration

## Reviewer test instructions

No publisher-provided credentials, paid account, or developer backend is required. The Extension works with the reviewer's own Microsoft sign-in flow; do not enter credentials supplied by the publisher.

1. Open the toolbar popup, enter an email-style test account, and confirm the badge becomes ON after the value saves.
2. Open Full settings and verify URL rewriting, exact account-picker auto-pick, prompt suppression, approved-apps-only mode, application approvals/exclusions, and diagnostics can be independently configured.
3. Clear the account in the popup. Confirm the Extension turns OFF and the cleared value remains cleared after the browser or extension service worker restarts.
4. In a Microsoft OAuth/OIDC authorize flow without an existing account/domain hint, confirm URL rewriting adds login_hint and domain_hint only on login.microsoftonline.com. For SAML or WS-Fed it adds whr. If prompt suppression is enabled, only an exact prompt=select_account value is removed.
5. Repeat with an application-provided login_hint, mixed-case Login_Hint, or encoded login%5Fhint. Confirm the request, source hint, and prompt remain unchanged and no second login_hint is added.
6. If an account picker appears, confirm exactly one visible tile matching the configured account or alias is selected. With no match or multiple matching tiles, the Extension must not click.
7. In Approved apps only mode, an unknown client ID or redirect/reply host must stay unmodified and produce a sanitized local approval diagnostic. Approving that client ID or host allows the next matching flow; excluding it always skips automation.
8. Open Diagnostics and confirm sensitive OAuth values such as state, nonce, claims, redirect_uri, and login_hint are not displayed. Use Clear to delete the local events.

## Media

- Store icon: `release/webstore-assets/store-icon-128.png`
- Screenshot 1: `release/webstore-assets/screenshot-01-popup.png`
- Screenshot 2: `release/webstore-assets/screenshot-02-overview.png`
- Screenshot 3: `release/webstore-assets/screenshot-03-approved-apps.png`
- Screenshot 4: `release/webstore-assets/screenshot-04-diagnostics.png`
- Small promo tile: `release/webstore-assets/small-promo-440x280.png`

Tracked copies of the four screenshots live in `docs/images/` and are embedded in the README. All upload assets are flattened RGB PNGs; screenshots are 1280x800, the icon is 128x128, and the small promo tile is 440x280.
