# Microsoft Edge Add-ons Release

The first Microsoft Edge Add-ons product is created, listed, and submitted in Partner Center. Later updates are built, verified, released, and submitted by `.github/workflows/release.yml` from a `vX.Y.Z` tag on `main`.

The Partner Center publisher account for this project is `rob.cpag@outlook.com`. Do not create or configure the product under an organizational account offered by a cached Microsoft sign-in session.

Current Microsoft Edge Add-ons product:

- Partner Center product UUID / Publish API product ID: `cb878c57-7248-4e6d-ba5f-d0f7f21b3ae7`
- Store ID: `0RDCK9QTL9HL`
- Initial manually submitted release: `v1.1.4`

## First publication

1. Run `pnpm run verify`, then `pnpm run package:stores`.
2. In Partner Center, create a new extension product for UseMyCurrentAccount++.
3. Upload `release/usemycurrentaccount-plusplus-vX.Y.Z-edge-addons.zip`.
4. Complete the listing from `docs/STORE_LISTING.md`:
   - English listing, product name `UseMyCurrentAccount++`, category `Productivity`.
   - Public, free, all available markets, no mature content.
   - Homepage, support, privacy, and terms URLs exactly as documented.
   - The 300 x 300 icon, four 1280 x 800 screenshots, and both promotional tiles from `docs/images/`.
5. Complete the privacy, trader-status, and certification declarations truthfully for the publisher account.
6. Submit the first package for certification and record the product UUID used by the Edge Add-ons API above.

No reviewer credentials or developer backend are required. The reviewer can use an email-style test value and their own Microsoft sign-in flow; the extension does not authenticate users or bypass Microsoft security controls.

## GitHub automation

Create a GitHub environment named `microsoft-edge-add-ons` and add these environment secrets:

- `EDGE_ADDONS_CLIENT_ID`
- `EDGE_ADDONS_API_KEY`
- `EDGE_ADDONS_PRODUCT_ID`

Add the environment variable `EDGE_ADDONS_CERTIFICATION_NOTES` with the reviewer summary from `docs/STORE_LISTING.md`. Never commit API credentials or print them in release logs.

Before tagging the manually submitted first release, set the repository variable `EDGE_ADDONS_MANUAL_SUBMISSION_TAG` to that exact tag (for example, `v1.1.4`). This makes the initial tag publish to GitHub and Chrome while intentionally skipping a duplicate Edge upload. Later tags automatically publish to both stores.

The release workflow also supports a manual retry of an existing tag with target `github`, `chrome`, or `edge`. It rebuilds from the exact tag, verifies that the tagged commit belongs to `main`, and publishes only a verified store ZIP.

## Release checklist

1. Update every version consumer together.
2. Run the full verification, loaded-Edge QA, and dual-package checks.
3. Push the verified commit to `main` and wait for CI.
4. Create and push the matching tag.
5. Verify both immutable ZIP assets on the GitHub release.
6. Verify the Chrome Web Store submission and the Edge Partner Center certification state.

The Chrome and Edge ZIPs are separately named copies of the same verified extension payload so the code reviewed in both stores cannot drift.
