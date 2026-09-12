# Auth (`src/auth.ts`)

NextAuth (v4) with Google provider, **JWT session strategy (no DB session store)**.
`src/app/api/auth/[...nextauth]/route.ts` just re-exports the handler.

- The `signIn` callback enforces the whitelist: rejects any email not found in `users`.
  Sign-in is **deny-by-default**; add a user with `npm run whitelist-user -- user@example.com`.
- On first successful sign-in it auto-creates an **active** "Main Collection"
  (`ensureMainCollection` → `CollectionModel`, `isActive: true`) so that search→deck drops
  work out of the box (adding a card to a deck requires an active collection to own the new
  physical card).
- The DB `_id` is threaded through `jwt` → `session` callbacks and exposed as
  `session.user._id` (typed via module augmentation in `auth.ts`).
- **API routes are auth-gated by `src/proxy.ts`** — this is the Next.js 16 middleware (the
  file was renamed from `middleware.ts` to `proxy.ts` in Next 16). Its `getToken()` check
  returns `401 { error: "Unauthorized" }`, and its `matcher` (`"/api/((?!auth).*)"`)
  protects every `/api/*` route except `/api/auth/*`. Routes that need the user id
  additionally call `getAuthSession()` (a plain `getServerSession(authOptions)` wrapper,
  kept as the single seam/mocking point) and read `session!.user._id` (trusting the
  middleware).
- Pages are also gated server-side: `(with-app-bar)/(main)/layout.tsx` and
  `(with-app-bar)/settings/layout.tsx` call `getAuthSession()` and redirect to `/login`
  when absent.

## Dev login (`AUTH_DEV_LOGIN=true`)

A dev-only NextAuth **Credentials provider** (id `dev-login`, "Continue as dev user" button
on the login page) that goes through the real auth machinery — real JWT cookie, middleware
fully active, normal sign-out.

- Gate is `isDevLoginEnabled()` in `auth.ts` (`NODE_ENV !== "production" && AUTH_DEV_LOGIN === "true"`;
  the providers spread is evaluated at module load).
- Its `authorize` calls `provisionDevUser()`: upserts the fixed user
  `DEV_USER_ID = "000000000000000000000001"` (email `dev@localhost`) and calls the shared
  `ensureMainCollection` (same auto-create as Google sign-in), then returns the user with
  `_id` so the existing `jwt`/`session` callbacks thread it.
- The `signIn` callback early-returns `true` for `account.provider === "dev-login"`
  (skipping the email whitelist).
- The login page discovers the provider via `getProviders()` (`/api/auth/providers`,
  excluded from the middleware matcher), so no flag is threaded to the client.
- Run it with `npm run dev:devlogin`; still requires `AUTH_SECRET` + `NEXTAUTH_URL`, but
  not the Google vars.

There is no auth bypass anywhere — production (`docker-compose.yml` sets
`NODE_ENV=production`) uses real Google login.
