# Admin security deployment

The admin panel checks a server-only password, emails a short-lived login code,
and uses a signed, HttpOnly session cookie. Password, email-provider, session,
and database credentials are server-only environment variables; none belong in
HTML or browser JavaScript.

## Configure Vercel

Add these Production (and Preview, if needed) environment variables in the
Vercel project settings:

- `ADMIN_PASSWORD`: the admin password. Use a unique, strong password and
  change it by updating this Vercel environment variable.
- `SESSION_SECRET`: a randomly generated secret with at least 32 bytes.
- `DATABASE_URL`: the Neon PostgreSQL connection string. Use a pooled connection
  string and keep it private.
- `RESEND_API_KEY`: a Resend API key authorized to send login emails.
- `EMAIL_FROM`: the sender address on a domain verified in Resend, for example
  `TBM NEWS <admin@your-verified-domain.example>`.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: credentials for an
  Upstash Redis database. The shared Redis store enforces the three-failure,
  15-minute IP lockout and stores one-time login codes across serverless
  instances.

Before deploying, run [database/schema.sql](./database/schema.sql) in the
Neon SQL Editor to create the news and homepage-advertisement tables and their
indexes. It is safe to run again after schema updates. The public `/api/news`
and `/api/ads` endpoints read these tables; admin changes use authenticated
`/api/admin/news` and `/api/admin/ads` endpoints.

Generate a session secret in Windows PowerShell:
`$bytes = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)`.

Verify the sender domain in Resend, then set `RESEND_API_KEY` and `EMAIL_FROM`
in Vercel. The login form first checks `ADMIN_PASSWORD`, sends a six-digit code
to `hmdshfikulislam@gmail.com`, and accepts that code once for 10 minutes.
Login attempts are rate-limited to three failures per IP; code resends have a
one-minute cooldown. Do not put secret values in source control, browser code,
or chat. Redeploy after changing Vercel environment variables.

## Existing Firestore news

Changing the application connection does not delete or copy existing Firestore
news. Export and import any news you want to keep into Neon before switching
production traffic. Preserve the existing document IDs in the Neon `id` column
so saved `?id=...` article links continue to work. Map Firestore fields as
follows: `desc` to `description`, `img` to `image`, `cat` (or `division`) to
both `category` and `division`, `isDemo` to `is_demo`, and `time` to
`published_time`. Use the Firestore document timestamp for `created_at`;
otherwise the new feed will sort those imported stories by import time.
Keep the Firestore project intact until you have verified the Neon migration
and backups.

## Admin access

Open `/tbm-secret-2024` and enter the administrator password. The server only
accepts `hmdshfikulislam@gmail.com`; after the password is accepted, a one-time
code is sent to that address. The code expires after 10 minutes and can only be
used once. Anyone with the administrator password and access to that email
inbox can sign in, so secure both.

The public home page has no admin link. The secret path is only an additional
layer of obscurity: access control is enforced by the server-side session and
API checks, not by hiding the URL. An authenticated admin session expires after
30 minutes without activity.

The home page temporarily merges news from Neon and the existing publicly
readable Firestore collection. This keeps old stories visible while you migrate
them; matching IDs are shown once, with Neon values taking precedence. Import
Firestore stories into Neon to make them available in the admin news list too.

The admin panel's **৬টি ডেমো নিউজ যোগ করুন** button adds clearly labeled sample
rows to Neon. They appear in a separate homepage section after the
lead story and latest-news panel, not among the real headlines. Edit or remove
them individually from the published-news list in the admin panel.

## Homepage advertisement

After signing in, select the image-shaped button in the top-right toolbar or
**বিজ্ঞাপন দিন** in the sidebar. Upload a PNG/JPEG/WebP/GIF image up to 500 KB
or provide an HTTP/HTTPS image URL. Optionally add a title and destination
link, then select **বিজ্ঞাপন সংরক্ষণ করুন**. The banner appears on the homepage;
use **বিজ্ঞাপন সরান** to remove it. The admin API stores the image and link in
Neon, and the public `/api/ads` endpoint serves only that ad.

Do not deploy the API until the Neon schema and all required environment
variables are configured. Keep Firestore and its security rules unchanged while
you verify the new production database and imported data.
