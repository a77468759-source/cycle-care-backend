# CycleCare backend

## Setup

Use Node.js 20 or newer. From `backend`, install dependencies with `npm install`.
Configure a local `.env` file using the variable names in `.env.example`; do not
replace an existing `.env`. Authentication requires two different random secrets,
each at least 32 bytes:

```text
JWT_ACCESS_SECRET=<random secret, at least 32 bytes>
JWT_REFRESH_SECRET=<different random secret, at least 32 bytes>
```

Generate each value independently with
`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
The backend only reads `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`; similarly
named legacy variables are not aliases. Never commit `.env` or share its values.

Environment variables:

| Name | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | For database-backed endpoints | MongoDB connection string. |
| `JWT_ACCESS_SECRET` | For authentication | HS256 signing and verification of 15-minute access JWTs. |
| `JWT_REFRESH_SECRET` | For authentication | Separate HS256 signing and verification key for 7-day refresh JWTs. |
| `CLIENT_ORIGINS` | For browser authentication | Comma-separated exact frontend origins allowed by CORS and CSRF origin checks. |
| `COOKIE_SAME_SITE` | No; defaults to `lax` | `lax`, `strict`, or `none`. Use `none` only when the frontend is cross-site; browsers require Secure cookies. |
| `PORT` | No; defaults to `3000` | HTTP listen port. |
| `GEMINI_API_KEY` | For AI chat | Gemini API key. |
| `GEMINI_MODEL` | No; defaults to `gemini-2.5-flash` | Gemini model name. |
| `NODE_ENV` | No | Set to `production` to enable production cookie security and production settings. |

If `.env` already exists, add the two required JWT variables without deleting or
replacing existing entries. Set `CLIENT_ORIGINS` to the frontend origin exactly,
including its scheme and port. Start the API with `npm run dev` or `npm start`.
The server can start without MongoDB, but authentication and check-in endpoints
return HTTP 503 until a database connection is available.

## Authentication and cookies

Authentication routes are under `/api/v1/auth`:

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/register` | Creates an account and starts a session. Body: `{ "email": "...", "password": "..." }`. |
| `POST` | `/login` | Checks credentials and starts a session. Same body as registration. |
| `POST` | `/refresh` | Rotates the refresh token and returns a fresh access token. |
| `POST` | `/logout` | Revokes the refresh session and clears its cookies. |
| `GET` | `/me` | Returns the current user; requires `Authorization: Bearer <accessToken>`. |

Passwords must be at least 12 characters and no more than 72 UTF-8 bytes. They
are hashed with bcrypt (12 rounds). Registration and login responses include a
15-minute access JWT in the JSON response. Keep it in memory on the client; do
not put access or refresh tokens in localStorage. Refresh JWTs are stored only
as SHA-256 hashes in MongoDB and are sent to clients only in an HttpOnly cookie.
Successful refresh rotates the token. Reusing a rotated token with its session's
CSRF token revokes that session. Logout revokes the session.

Refresh/logout use a host-only `cyclecare_refresh_token` cookie with path
`/api/v1/auth`, HttpOnly, and the configured SameSite policy. A separate
`cyclecare_csrf_token` cookie is readable by browser code. The login/register/
refresh JSON response also includes `csrfToken`; send that value in the
`X-CSRF-Token` header and send cookies on refresh/logout. The backend requires
an allowed `Origin` for registration, login, refresh, and logout, plus a
matching CSRF cookie/header pair for refresh and logout.
For cross-origin browser requests, use `credentials: "include"`. CORS allows
credentials only for origins listed in `CLIENT_ORIGINS` and allows the
`Authorization`, `Content-Type`, and `X-CSRF-Token` headers.

Use `COOKIE_SAME_SITE=lax` for same-site deployments. For a frontend and API
that are truly cross-site, configure `COOKIE_SAME_SITE=none`; this also enables
Secure cookies outside production because browsers require it for `SameSite=None`.
Production cookies always use Secure. HTTPS is required in production.

Registration/login share a 10-request-per-15-minutes limit per process; refresh
and logout each have separate limits of 10 per 15 minutes. The current-user
route is protected by the global API limit. These default in-memory rate limits
are not shared across server instances; use a shared rate-limit store when
deploying multiple instances.

## Check-ins

Check-in routes require a bearer access token and scope all operations to its
verified user ID. Client-supplied user IDs are rejected. The routes are:

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/v1/check-ins` | Create a check-in. |
| `GET` | `/api/v1/check-ins?page=1&limit=20` | List the signed-in user's check-ins, newest date first. |
| `GET` | `/api/v1/check-ins/:id` | Read one of the signed-in user's check-ins. |
| `PATCH` | `/api/v1/check-ins/:id` | Update supported fields on the signed-in user's check-in. |
| `DELETE` | `/api/v1/check-ins/:id` | Delete the signed-in user's check-in. |

Check-ins store an optional mood (`Happy`, `Calm`, `Low`, `Stressed`, `Tired`,
`Uncomfortable`, `Sad`, or `Energetic`), validated symptom labels (`Cramps`,
`Back pain`, `Headache`, `Bloating`, `Fatigue`, `Acne`, `Backache`, `Nausea`,
or `Other`), an optional intensity from 1 to 5, an optional note of up to 500
characters, and a UTC calendar date.
A mood or at least one symptom is required. The optional date uses
`YYYY-MM-DD`; if omitted, the current UTC calendar date is used. Pagination
defaults to page 1 and 20 records, allows at most 100 records per page, and page
numbers are limited to 10,000. Responses follow the
`{ "success": true, "data": ... }` convention.

Check-ins created before ownership was introduced are not assigned to an
account automatically. Such records cannot be accessed through user-scoped
routes until a separately reviewed, explicit migration assigns ownership.

## Health and AI

- `GET /api/health` reports application, MongoDB, and Gemini configuration status.
- `POST /api/v1/ai/chat` accepts `{ "message": "..." }`; it is limited to 20
  requests per 15 minutes and requires `GEMINI_API_KEY`. It also requires an
  authenticated bearer token, an allowed `Origin`, and a matching CSRF
  cookie/header pair. Messages are limited to 4,000 characters and are sent
  alone to Gemini; conversation history and check-ins are not stored or sent.

## Tests

Run `npm test` from `backend`. The authentication integration tests use
`mongodb-memory-server`, an isolated ephemeral MongoDB database; they do not use
`MONGODB_URI` or modify data in a configured Atlas database. The first run may
download a MongoDB test binary.
