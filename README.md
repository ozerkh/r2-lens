<p align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="">
</p>

<h1 align="center">R2 Lens</h1>

<p align="center">A file explorer for Cloudflare R2 that runs on your own Cloudflare Worker.</p>

<p align="center">
  <a href="https://r2-lens-demo.pages.dev">Live demo</a> · <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/ozerkh/r2-lens">Deploy to Cloudflare</a>
</p>

<br>

## Features

- Browse buckets in list or grid view, with filtering and sorting
- Preview images, videos, audio, PDFs, text, and code
- Browse the contents of ZIP and TAR archives
- Upload files and folders with multipart uploads and progress tracking
- Create folders, rename, and delete files and folders
- Share files with links that expire after 1 hour, 1 day, or 7 days (API token sign-in)
- Create buckets and manage CORS, lifecycle rules, and public access
- No external database required

<br>

## Installation

### Deploy to Cloudflare

1. Deploy:

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ozerkh/r2-lens)

   The app is live at `https://r2-lens.<your-subdomain>.workers.dev`.

2. Add settings on the Worker's **Variables and secrets** page. See [Configuration](#configuration).

### Deploy with Wrangler

Requirements: Node.js 22 or later.

1. Clone and install:

   ```bash
   git clone https://github.com/ozerkh/r2-lens.git
   cd r2-lens
   npm install
   npx wrangler login
   ```

2. Deploy:

   ```bash
   npm run deploy
   ```

   The app is live at `https://r2-lens.<your-subdomain>.workers.dev`.

3. Add settings on the Worker's **Variables and secrets** page, or with Wrangler. See [Configuration](#configuration).

   ```bash
   printf '<account-id>' | npx wrangler secret put ALLOWED_ACCOUNT_IDS
   ```

   If you set them in `.dev.vars`, upload them all with `npx wrangler secret bulk .dev.vars`.

### Run locally

```bash
npm install
npm start
```

Open [http://localhost:5173](http://localhost:5173). Use `npm run dev` instead for live reload while working on the code.

The first run creates `.dev.vars` with every setting empty. Fill in the ones you need, see [Configuration](#configuration).

<br>

## Authentication

R2 Lens supports three authentication methods. Multiple methods can be enabled at the same time.

| | API token | Cloudflare OAuth | Bucket bindings |
|---|---|---|---|
| Setup | Paste a token | Configure an OAuth client | Configure `r2_buckets` |
| Buckets | All buckets accessible to the token | All buckets in the account | Bound buckets only |
| Uploads | Any size | Up to 100 MB per file | Any size |
| Share links | Yes, up to 7 days | No | No |
| Bucket settings | Yes | Yes | No |

### API token

Create an API token under [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) with the following permissions:

- **Account Settings Read**
- **Workers R2 Storage Read**, or **Workers R2 Storage Edit** to upload and make changes
- **User Details Read** (optional, to display your email)

The token is kept encrypted in an HTTP-only cookie for 7 days, never in a database. Files go through the R2 S3 API, which allows large uploads and share links.

### Cloudflare OAuth

Create an OAuth client under [Cloudflare OAuth Clients](https://dash.cloudflare.com/?to=/:account/oauth-clients) with the following settings:

| Setting | Value |
|---|---|
| Response type | Code |
| Grant type | Authorization code |
| Token authentication method | None (PKCE) |
| Redirect URLs | `https://r2-lens.<your-subdomain>.workers.dev/auth/callback` and `http://localhost:5173/auth/callback` |
| Scopes | Account Settings Read, User Details Read, Workers R2 Storage Read and Write, Workers R2 Storage Bucket Item Read and Write |

Then set `CF_OAUTH_CLIENT_ID` to the client ID.

<details>
<summary>Create the OAuth client using the API</summary>

This needs an API token with the **OAuth Client Write** permission.

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/oauth_clients" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "R2 Lens",
    "redirect_uris": [
      "https://r2-lens.<your-subdomain>.workers.dev/auth/callback",
      "http://localhost:5173/auth/callback"
    ],
    "grant_types": ["authorization_code"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scopes": [
      "account-settings.read",
      "user-details.read",
      "workers-r2.read",
      "workers-r2.write",
      "workers-r2-bucket-item.read",
      "workers-r2-bucket-item.write"
    ]
  }'
```

The client ID is returned as `result.client_id`.

</details>

See [OAuth limits](#cloudflare-oauth-only).

### Bucket bindings

Bind buckets to the Worker in `wrangler.jsonc`. They appear under **Worker bindings**.

```jsonc
{
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "my-media" }]
}
```

On deployed Workers, bound buckets open only through Cloudflare Access:

1. Turn on Access on the Worker's **Access** tab and set a policy.
2. Add the team domain and AUD tag shown there as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.

Anyone who passes the policy can read, upload, and delete in bound buckets. Locally, bindings work without Access.

### Restricting account access

By default, anyone with a Cloudflare account can sign in. They only see their own buckets. To allow only your account, set `ALLOWED_ACCOUNT_IDS`:

```bash
printf '<account-id>' | npx wrangler secret put ALLOWED_ACCOUNT_IDS
```

Multiple account IDs can be separated by commas.

To protect the whole app, turn on Cloudflare Access with **Protect with Cloudflare Access** in the deploy form, or later on the Worker's **Access** tab.

<br>

## Configuration

Add these on the Worker's **Variables and secrets** page. Locally, use `.dev.vars`.

| Variable | Description |
|---|---|
| `CF_OAUTH_CLIENT_ID` | Turns on Cloudflare OAuth. |
| `CF_OAUTH_CLIENT_SECRET` | Only for OAuth clients that use Client Secret Basic. |
| `CF_OAUTH_REFRESH` | `true` keeps users signed in for 7 days. Needs the Refresh token grant. |
| `ALLOWED_ACCOUNT_IDS` | Account IDs allowed to sign in, comma-separated. Empty allows any account. |
| `TOKEN_LOGIN` | `false` turns off API token sign-in. |
| `READ_ONLY` | `true` turns off uploads, deletes, and setting changes. |
| `ACCESS_TEAM_DOMAIN` | Access team domain, for bucket bindings. |
| `ACCESS_AUD` | Access AUD tag, for bucket bindings. |
| `SESSION_SECRET` | Encrypts the sign-in cookie. Created by `npm run deploy`. |

<br>

## Limits

### Cloudflare OAuth only

API tokens and bucket bindings don't have these limits.

- Uploads up to 100 MB per file
- Files over 300 MB or with custom metadata can't be renamed
- Videos can't be skipped past the first 32 MB
- ZIP files over 32 MB can't be previewed
- Cloudflare allows 1,200 API calls every 5 minutes; R2 Lens waits when it runs low

For large uploads, videos, and archives, sign in with an API token or use bucket bindings.

### All methods

- Objects over 5 GB can't be renamed
- Folders load 200 objects at a time

<br>

## Contributing

Contributions, bug reports, and feature requests are welcome.

- [Open an issue](https://github.com/ozerkh/r2-lens/issues)
- Submit a pull request

Built with [React](https://react.dev), [Kumo UI](https://kumo-ui.com), [Hono](https://hono.dev), and [Vite](https://vite.dev).

<br>

## License

[MIT](LICENSE)
