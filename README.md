# Create T3 App

## Router tests

Run `pnpm test` for the API router suite, `pnpm test:watch` while developing,
or `pnpm test:coverage` for coverage (HTML report: `coverage/index.html`).

Tests call the real tRPC routers, input validation, and authentication middleware.
Each test injects fresh database mocks from `src/test/helpers.ts`; transaction
callbacks receive separate mocks. Unconfigured database methods throw immediately.
The setup file replaces the application database singleton, NextAuth, email delivery,
and password hashing before the routers load, so no database or email credentials,
running PostgreSQL instance, migrations, or `.env` file are needed. An accidental
call to the application database singleton throws instead of opening a connection.

Coverage includes auth, company (including post acknowledgments), and job procedures.
The authentication matrix in `src/server/api/trpc.test.ts` must be updated when a
procedure is added. Router tests cover returned data, validation, authorization query
filters, and error handling. These mocks do not verify PostgreSQL constraints,
transaction rollback/isolation, or Prisma query execution; those require a separate
integration suite against a disposable database.

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.
