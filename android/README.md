# Football Stories — Android App Bundle build

This folder documents how to package the **existing** production PWA at `https://site-files-100.vercel.app/` as a Trusted Web Activity (TWA). The website remains hosted on Vercel and uses the same /api/ endpoints as browser visitors. Do not add a second API client, publish secrets or duplicate match polling.

## Verified so far
- Android installation from the stable Vercel domain was reported successful.
- Android app icon was changed to the submitted lynx logo.
- The Matches mobile layout was tested and approved.
- The production PWA manifest is `https://site-files-100.vercel.app/manifest.webmanifest`.

These checks **do not mean** that an Android App Bundle has been created, signed or accepted by Google Play.

## Build steps (on a trusted development computer)

Prerequisites: Node.js, Java Development Kit and Android SDK. The Bubblewrap CLI can help install missing development tools.

1. In a fresh working directory **outside the deployed `site-files/` directory**, install the Bubblewrap CLI:

   ```sh
   npm install --global @bubblewrap/cli
   mkdir football-stories-android
   cd football-stories-android
   bubblewrap init --manifest=https://site-files-100.vercel.app/manifest.webmanifest
   ```

2. Review every value that the wizard proposes:
   - Name: `Football Stories`.
   - Start URL: `https://site-files-100.vercel.app/index.html`.
   - Host/origin: `site-files-100.vercel.app`.
   - Unique Android application ID: choose and record a valid reverse-domain identifier **with the adult Play Console account owner**. A package name is permanent after publishing. Don't use a guessed or already-owned package ID.
   - Display mode: standalone; app icon comes from the web manifest.
   - Do not add separate football API keys or backend polling.
3. During initialization, protect the generated keystore and its passwords. **Never commit keystore files, passwords, tokens or environment secrets to GitHub.** Keep secure backups for future updates.
4. Build the project:

   ```sh
   bubblewrap build
   ```

   Bubblewrap can produce `app-release-bundle.aab` and a signed test APK if the SDK and signing setup are completed successfully. Do not assume output exists until the build has succeeded.

## Digital Asset Links — required before release

For a verified full-screen TWA, serve a real JSON asset statement at:

`https://site-files-100.vercel.app/.well-known/assetlinks.json`

This file must identify the **actual** Android application ID and the **real** certificate SHA-256 fingerprint. Under Play App Signing, the signing certificate used by Google Play for distributed installs can differ from the local upload key: use the appropriate **Play app-signing certificate** from Play Console for store installs; add a separate fingerprint only if needed for local testing. No placeholder assetlinks statement should be deployed. Verify association on the installed Android package.

## Play Console release gates

- Play Console developer-account owner must be 18 or older. A parent or other eligible adult must own the account for an under-18 publisher.
- The account owner handles the one-time Play Console registration fee and all required identity checks.
- Use internal testing first, then follow the testing requirements applicable to the account. New personal accounts created after 13 November 2023 generally need a closed test with at least 12 testers continuously opted in for 14 days before applying for production access.
- Complete the store listing, privacy policy, Data safety disclosures, target SDK policy requirements, content declarations, and login-access instructions if login is required.
- Validate Home, Matches, Videos, News, back navigation, online/offline behavior, icon and launch mode on a physical device.
- Upload only an AAB built and signed with the genuine release configuration.

## Safeguards
- A Google Play AAB cannot be truthfully marked ready until signing identity, Digital Asset Links, device tests and Play Console checks pass.
- Never commit a test APK, AAB or release signing secrets to this GitHub repository.
- The website and Android TWA should continue to use the same Vercel origin, caching and score-selection rules.

Official references:
- https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- https://developers.google.com/codelabs/pwa-in-play
- https://support.google.com/googleplay/android-developer/answer/6112435
- https://support.google.com/googleplay/android-developer/answer/14151465
