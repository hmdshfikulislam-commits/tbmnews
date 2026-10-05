# Admin security deployment

The admin panel uses a Vercel serverless TOTP check and a signed, HttpOnly
session cookie. The TOTP secret and Firebase service-account key are server-only
environment variables; neither belongs in the HTML or browser JavaScript.

## Configure Vercel

Add these Production (and Preview, if needed) environment variables in the
Vercel project settings:

- `TOTP_SECRET`: a random Base32 secret shared with the admin's authenticator
  app. Configure the app for TOTP, SHA-1, six digits, and a 30-second period.
- `SESSION_SECRET`: a randomly generated secret with at least 32 bytes.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: credentials for an
  Upstash Redis database. The shared Redis store enforces the three-failure,
  15-minute IP lockout across serverless instances.
- `FIREBASE_SERVICE_ACCOUNT`: the complete JSON for a dedicated Firebase
  service account with only the Firestore permissions this site needs.

Generate a session secret in Windows PowerShell:
`$bytes = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)`.

Generate a Base32 TOTP secret in Windows PowerShell:
```powershell
$bytes = New-Object byte[] 20
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
$bits = -join ($bytes | ForEach-Object { [Convert]::ToString($_, 2).PadLeft(8, "0") })
$chunks = for ($i = 0; $i -lt $bits.Length; $i += 5) {
  $alphabet[[Convert]::ToInt32($bits.Substring($i, 5), 2)]
}
$secret = -join $chunks
$secret
```
Set that value as `TOTP_SECRET` in Vercel and add the same setup key to the
authenticator app as a time-based entry. Do not put secret values in source
control, browser code, or chat. Redeploy after changing the Vercel environment
variables.

## Lock down Firestore

Deploy [firestore.rules](./firestore.rules) to the `tbmnews-fdd03` Firebase
project. These rules keep public news reads working while denying all browser
writes; the server-side admin API uses the Firebase Admin SDK instead. With the
Firebase CLI installed, run
`firebase deploy --only firestore:rules --project tbmnews-fdd03` from this folder.

## Admin access

Open `/tbm-secret-2024` and enter the current six-digit code from the
authenticator app. The server only accepts `hmdshfikulislam@gmail.com`; the
email is an allowlist check, not Google OAuth or proof of Gmail account
ownership. The TOTP code is the only login credential, rotates every 30
seconds, and one adjacent time step is accepted to tolerate clock skew. Anyone
who obtains the authenticator setup key can sign in, so keep it private and
secure the device that stores it.

The public home page has no admin link. The secret path is only an additional
layer of obscurity: access control is enforced by the server-side session and
API checks, not by hiding the URL. An authenticated admin session expires after
30 minutes without activity.

The admin panel's **৬টি ডেমো নিউজ যোগ করুন** button adds clearly labeled sample
documents to Firestore. They appear in a separate homepage section after the
lead story and latest-news panel, not among the real headlines. Edit or remove
them individually from the published-news list in the admin panel.

Back up any existing Firestore security rules before replacing them. Do not
deploy the admin API until all required environment variables and the new
Firestore rules are configured.
