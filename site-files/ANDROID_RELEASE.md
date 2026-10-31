# Football Stories — Android / Google Play preparation

## Architecture
The Android application should be a Trusted Web Activity (TWA) wrapping the **existing production HTTPS website**, not a second football frontend. The website and app use the same Vercel API endpoints, priority match selection and persistent cache. Do not add API keys or independent football API polling to the Android client.

## PWA icons
The `app-icon.svg` is the original crest in a scalable wrapper. Production Android installability also needs PNG variants. Run `python -m pip install Pillow`, then `python scripts/build-app-icons.py` from `site-files/`. This creates `app-icon-192.png`, `app-icon-512.png`, and `app-icon-maskable-512.png`. After generation, commit the PNGs to GitHub and update `manifest.webmanifest` to include the respective PNG icon entries. Do not advertise these paths in the manifest before the files exist.

## Android release plan
1. Confirm a stable production HTTPS domain and correct web app installability on actual Android devices. Do not use ephemeral Vercel preview domains.
2. Verify all pages are responsive, navigation works with Android back, and no live scores appear as current when offline.
3. Confirm a single shared backend cache/selection source for the five priority matches; the PWA service worker intentionally bypasses `/api/`.
4. Build an Android Trusted Web Activity with Bubblewrap or Android tooling; obtain the signing certificate SHA-256 fingerprint.
5. Publish `/.well-known/assetlinks.json` on the **production domain** for Android package name and signing certificate, then verify origin association.
6. Produce a signed Android App Bundle (.aab), test via Play Console, complete listing, privacy/data-safety declarations, then submit for review.

The package name, SHA-256 signing certificate and final domain must be genuine release values and must not be guessed or committed as fake working credentials.

## Release safeguards
Use a parent or other eligible adult to own the developer account if the app publisher is under 18. Separate signing keys and API secrets from the GitHub repository. Do not call the app Play Store-ready until real device tests and Play checks pass.
