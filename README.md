# GATE CSE Rank Tracker

A brutally honest daily tracker: where would you rank among 2.5 lakh aspirants (40,000 qualify) if the exam were today?
Static site for GitHub Pages. No build step.

## Deploy (same as the old tracker)
1. Upload every file in this folder to a GitHub repository (branch `main`).
2. Settings -> Pages -> Source: GitHub Actions (the included workflow deploys it) or "Deploy from branch".
3. Open the Pages link on your phone, then use Add to Home Screen.

## Keeping your phone data safe (the important part)
- Data is stored in your phone browser (localStorage), under the exact site address. Always open the same link, from the same browser/home-screen icon.
- Every save also keeps: a one-step-back safety copy and a daily snapshot for the last 7 days. If the main copy is ever corrupted, the app recovers from these automatically.
- The app asks the browser for persistent storage so it is not auto-cleaned.
- Open the Data tab and tap **Download backup** (or **Copy backup text**) about once a week. The app reminds you after 7 days. Restoring is one tap.
- Clearing "site data" in browser settings erases everything, so keep a backup.
- Your PC will have its own separate data, which is intended: use the phone only.

## Optional cloud copy (Firebase)
Skip this if you only use one phone. To add it: create a Firebase project, enable Email/Password sign-in, create a Web app, paste its config into `firebase-config.js`, create Firestore, and publish `firestore.rules`. Then sign in from the Data tab. Local data stays the main copy; the cloud is a backup that the newest save wins.

## Recalibrating
All benchmark numbers (field tiers, weights, ceilings, subject marks, default PYQ/DPP totals) are plain constants at the top of `model.js`.
They are assumptions from topper interviews and coaching plans, calibrated to GATE 2026 CS (259,922 registered, 211,020 appeared, qualifying cutoff 30). After a week of real data, adjust them there.

## Files
- `index.html`, `style.css`, `app.js` - interface and storage
- `model.js` - scoring and ranking model
- `firebase-config.js`, `firestore.rules` - optional cloud sync
- `manifest.webmanifest`, `icon.svg` - Add to Home Screen
