# Chrome Web Store Release

The first Chrome Web Store item is created and fully configured in the Developer Dashboard. Later updates are built, verified, released, and submitted by `.github/workflows/release.yml` from a `vX.Y.Z` tag on `main`.

Current Google Cloud project: `UseMyCurrentAccount PlusPlus` (`umca-plusplus-502523`). Current OAuth web-client name: `UseMyCurrentAccount++ GitHub Release Web`.

## One-time setup

1. Enable the Chrome Web Store API in a Google Cloud project owned by the publisher.
2. Configure an external OAuth consent screen in production.
3. Create an OAuth web client with `http://127.0.0.1:8765/oauth2callback` as an authorized redirect URI.
4. Issue an offline refresh token for `https://www.googleapis.com/auth/chromewebstore`. The local helper stores the authorization URL and token in mode-600 files without printing credentials:

   ```bash
   GOOGLE_OAUTH_CLIENT_JSON=/secure/path/client.json \
   GOOGLE_OAUTH_REFRESH_TOKEN_FILE=/secure/path/refresh-token \
   node scripts/acquire-chrome-webstore-token.mjs
   ```

5. Open the generated `.authorization-url` value in the browser and complete consent.
6. Create the Store item and complete its Listing, Privacy, and Distribution tabs using `docs/STORE_LISTING.md`.
7. Create a GitHub environment named `chrome-web-store`.
8. Add these GitHub repository secrets:

   - `CHROME_WEBSTORE_CLIENT_ID`
   - `CHROME_WEBSTORE_CLIENT_SECRET`
   - `CHROME_WEBSTORE_REFRESH_TOKEN`
   - `CHROME_WEBSTORE_PUBLISHER_ID`
   - `CHROME_WEBSTORE_EXTENSION_ID`

Never commit OAuth credentials or tokens.

## Release checklist

1. Update `package.json`, `public/manifest.json`, the README current version, and version assertions together.
2. Run `pnpm install --frozen-lockfile` and `pnpm run verify` from a clean checkout.
3. Review the produced `dist/` and Store media.
4. Push the verified commit to `main` and wait for CI to pass.
5. Create and push the matching tag, for example `v1.1.0`.
6. Verify the GitHub release ZIP checksum and the Chrome Web Store submission state.

The release workflow refuses tags that are not on `main`, rebuilds from the exact tagged commit, and sends the same verified ZIP to both GitHub Releases and the Chrome Web Store API.
