# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## Company invitations

Owners and admins can invite people from **People**, choosing Member or Contractor
and an expiry from 1 to 168 hours. Recipients do not need an account. Invitation
links send logged-out recipients to signup and stay attached through verification,
login, and Google sign-in. Acceptance requires the invited email to be verified.
The company selector also includes **Join a company** for pending invitations.

The **People** screen lists owners, admins, members, then contractors. Owners can
change or remove any non-owner; only owners can grant the Admin role. Admins can
change Member/Contractor roles and remove those members. Owner accounts are
protected. Removal requires confirmation, revokes company/channel access and
unused invitations to or from that person, and preserves their account and past
work. Demoting an admin also revokes their unused invitations for that company.

When a membership is removed, company pages redirect to another available company
or the join screen and explain the lost access. Open dashboards refresh the company
list every ten seconds and when the browser tab regains focus.

Set `APP_URL` to the application's public HTTPS origin in production, for example
`https://your-app.example`. Development defaults to `http://localhost:3000`; set
`APP_URL` explicitly if your dev server uses another port or hostname. Emails use
the existing `RESEND_API_KEY` and verified sender. No invitation emails are sent
by tests.

Deploy the migration with `pnpm exec prisma migrate deploy` and regenerate Prisma
with `pnpm exec prisma generate`. Restart a running dev server after generation so
its cached Prisma client includes the invitation model.

Invitations are single-use, revocable, and checked for expiry during acceptance.
Resending replaces the previous invitation. Sending is limited to one invitation
per company/email per minute, five per recipient per hour, and fifty per company
or sender per hour. Failed email delivery revokes the new invitation and still
counts toward these limits. Expired records remain available in the history; no
scheduled cleanup is needed to enforce expiry. Concurrent acceptance and
revocation run in serializable transactions.

Run `pnpm test` with Docker running. See [the test checklist](docs/api-test-cases.md)
for coverage and test structure.

## Profiles

Use **My profile** in the account menu to edit your name and optional description.
Names allow up to 100 characters; descriptions allow 500 characters and line breaks.
Saving refreshes your name in the account menu and invalidates cached names in
company posts, acknowledgment lists, and member lists. Profile updates only affect
the signed-in user. No new migration is needed for these existing user fields.

## Company chat data model

Migration `20261002010000_channel_membership_permissions` adds channel titles and
timestamps, individual channel-member permissions, and message authors linked to
`ChannelMember`. Channels retain their `name` and optional `image`; existing names
also become their initial titles. Each member has a stable ID and a unique
`channelId_userId` pair. Permissions default to false: `canSendMessages`,
`canManageMembers`, `canManageChannel`, and `canModerateMessages`.

The chat API should require current company membership and `removedAt: null` for
reading, then check the relevant individual permission for each action. Assign
the creator's permissions explicitly. Message creation uses
`authorChannelMemberId`; a composite foreign key enforces that the author belongs
to the message's channel. Resolve the author via `authorChannelMember.user`.
Use `removedAt` for membership removal and `deletedAt` for message soft deletion.
Historical memberships are retained so old messages keep their authors. Rejoining
a company must not automatically reactivate its channel memberships or permissions.

The migration preserves existing message authors, including those whose channel
membership was previously deleted, by creating inactive historical memberships.
Apply it with `pnpm run db:migrate` before running the updated Prisma client.
New chat API endpoints are not included yet.

## Account security

**Account settings → Account security** supports password changes and optional
authenticator-app two-factor authentication for password and Google sign-ins.
Setup provides a QR code and manual key, requires a six-digit confirmation, and
shows ten single-use recovery codes once. Users can download those codes, replace
them after verification, or disable 2FA. Provider-only accounts manage their
password with their provider and must have signed in within ten minutes to enroll.

Deploy `20261002000000_account_security` with `pnpm exec prisma migrate deploy`,
run `pnpm exec prisma generate`, and restart the application. `AUTH_SECRET` must
be set, including in development. It derives the AES-256-GCM key protecting
authenticator secrets; keep it stable and backed up. Rotating it invalidates
sessions and requires a planned migration of encrypted authenticator secrets.
QR codes are generated locally; setup secrets are not sent to a third-party service.

Changing a password or enabling/disabling 2FA revokes all existing sessions.
Pending second-factor sessions cannot access protected pages or APIs. Challenges
and pending setup expire after ten minutes. Security operations share a per-user
limit of ten attempts per ten-minute window, including across fresh sign-ins.
Authenticator codes cannot be reused, and recovery-code consumption is atomic.
Users who lose both their authenticator and all recovery codes cannot bypass 2FA
through email verification or Google sign-in; an administrative recovery process
is not included.

Run the security integration tests with
`pnpm exec vitest run src/server/api/routers/security.test.ts`. They use a disposable
database and a test-only encryption key.

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
