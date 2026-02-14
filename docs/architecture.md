# Architecture

## Stack

| Layer        | Technology                        |
| ------------ | --------------------------------- |
| Framework    | Next.js 16 (App Router)           |
| Language     | TypeScript                        |
| Styling      | Tailwind CSS v4                   |
| Database     | PostgreSQL (via Supabase)         |
| ORM          | Prisma                            |
| Auth         | Supabase Auth (@supabase/ssr)     |

## Directory layout

```
/
├── docs/               Architecture & design notes
├── prisma/
│   └── schema.prisma   Database models
├── src/
│   ├── app/            Next.js App Router pages & layouts
│   ├── lib/
│   │   ├── prisma.ts           Prisma client singleton
│   │   └── supabase/
│   │       ├── client.ts       Browser Supabase client
│   │       ├── server.ts       Server Component / Route Handler client
│   │       └── middleware.ts   Session refresh helper
│   └── middleware.ts   Next.js middleware (auth session refresh)
└── .env.example        Required environment variables
```

## Auth flow

1. **Middleware** (`src/middleware.ts`) runs on every matched request and calls
   `updateSession` to silently refresh the Supabase JWT via cookies.
2. **Server helpers** (`src/lib/supabase/server.ts`) create a Supabase client
   bound to the current cookie jar — use this in Server Components, Route
   Handlers, and Server Actions.
3. **Browser helper** (`src/lib/supabase/client.ts`) creates a browser-side
   Supabase client for Client Components.

## Database

Prisma connects to the same Supabase Postgres instance via `DATABASE_URL`.
The `User` model mirrors Supabase `auth.users` by sharing the same UUID `id`,
allowing joins between app data and auth data.

Run `npx prisma migrate dev` to apply schema changes locally.
