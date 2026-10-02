# API test case checklist

These integration tests cover company, auth, job, invitation, profile, and account-security behavior. They call the real tRPC routers with a real Prisma client connected to disposable PostgreSQL containers. Use this document to understand each test and to add cases when route behavior changes.

## Running the tests

Docker must be running. Use `pnpm test` for all tests, `pnpm test:watch` while editing, or `pnpm test:coverage` for the terminal and HTML reports. Open `coverage/index.html` in a browser. Run just one file with `pnpm exec vitest run src/server/api/routers/company.test.ts`.

Coverage reports execution, not correctness. Assertions about returned results, database rows, and permissions provide the evidence. There is no mandatory coverage threshold.

## How the setup works

Each router test file follows the same structure:

1. `beforeAll` calls `startTestDatabase()` to start its own PostgreSQL container, apply repository migrations, and connect Prisma using the container URL.
2. `beforeEach` calls `clearTestDatabase(db)` to remove prior data. Company and job tests then create a user, an existing company, its OWNER membership, and a caller with that user's session. Auth tests use a caller with no session.
3. Each `it(...)` block arranges any additional data, calls one procedure, and checks its response or stored effects. The company fixture already exists, so an invalid create leaves the company count at one.
4. `afterAll` disconnects Prisma and stops the container, even if a test fails.

The shared helper is [src/test/database.ts](../src/test/database.ts). Its cleanup function must only receive the client created by `startTestDatabase()`. Do not pass the application's database client. Do not mark tests within a file as concurrent: they share the same database and cleanup. Separate files can run in parallel because they use separate containers.

The auth and database module mocks prevent application startup services from loading. They do not replace the Prisma client passed into the caller. Email delivery is mocked, while password and verification-code hashing use real Argon2. The test configuration disables tRPC's artificial development delay.

`src/test/database.test.ts` contains one smoke test proving that migrations and the database client can store and retrieve a company. Company route behavior lives in its router test file.

## Reading a test

Read a test in three parts: arrange, act, assert. Creating a user or an existing company is usually arrangement, not the behavior under test. Use direct Prisma queries in assertions to verify the route actually saved or removed data. A rejection test should check the error code and, where relevant, verify that stored data stayed unchanged.

Tests below are implemented. The wording matches their `it(...)` names so you can find each case in the corresponding file. These are a practical checklist for the current routes, not an exhaustive list of every possible input combination.

## Company tests

[company.test.ts](../src/server/api/routers/company.test.ts) contains 115 cases.

Company names allow 1–100 characters after trimming; descriptions allow up to 300, emails 254, and phones 20. Post titles allow 1–100 and content 1–1000 after trimming. Company deletion is OWNER-only; updates and post mutations allow OWNER or ADMIN. Ordinary members can read their companies and posts.

### createCompany

- createCompany saves a company and makes the user its owner.
- createCompany trims the name and saves optional profile fields.
- createCompany accepts null image and description.
- createCompany accepts a one-character name.
- createCompany accepts a 100-character name.
- createCompany accepts a 300-character description.
- createCompany accepts a 20-character phone.
- createCompany accepts a 254-character email.
- createCompany rejects an empty name without saving anything.
- createCompany rejects a whitespace-only name without saving anything.
- createCompany rejects a 101-character name without saving anything.
- createCompany rejects a 301-character description without saving anything.
- createCompany rejects an invalid image URL without saving anything.
- createCompany rejects an invalid website URL without saving anything.
- createCompany rejects an invalid email without saving anything.
- createCompany rejects a 255-character email without saving anything.
- createCompany rejects a 21-character phone without saving anything.
- createCompany rejects an unauthenticated request.
- createCompany rejects a stale session after its user is deleted.

### getCompany

- getCompany returns a company the user belongs to.
- getCompany allows an ADMIN member.
- getCompany allows a MEMBER member.
- getCompany allows a CONTRACTOR member.
- getCompany rejects an existing company belonging to someone else.
- getCompany rejects a missing company.
- getCompany rejects an unauthenticated request.
- getCompany rejects an invalid company ID.

### listCompanies

- listCompanies includes memberships but excludes other companies.
- listCompanies returns an empty list for a user without memberships.
- listCompanies rejects an unauthenticated request.

### updateCompany

- updateCompany allows OWNER and preserves omitted fields.
- updateCompany allows ADMIN and preserves omitted fields.
- updateCompany rejects MEMBER without changing the company.
- updateCompany rejects CONTRACTOR without changing the company.
- updateCompany rejects a missing company.
- updateCompany rejects a inaccessible company.
- updateCompany rejects invalid fields without changing the record.
- updateCompany rejects an unauthenticated request.
- updateCompany rejects an invalid company ID.

### deleteCompany

- deleteCompany rejects a missing company.
- deleteCompany rejects a inaccessible company.
- deleteCompany allows the owner and cascades to memberships jobs and posts.
- deleteCompany rejects ADMIN and leaves the company intact.
- deleteCompany rejects MEMBER and leaves the company intact.
- deleteCompany rejects CONTRACTOR and leaves the company intact.
- deleteCompany rejects an unauthenticated request.
- deleteCompany rejects an invalid company ID.

### getCompanyPosts

- getCompanyPosts returns only this company posts newest first.
- getCompanyPosts returns an empty list when there are no posts.
- getCompanyPosts allows a MEMBER member.
- getCompanyPosts allows a CONTRACTOR member.
- getCompanyPosts rejects a missing company.
- getCompanyPosts rejects a inaccessible company.
- getCompanyPosts rejects an unauthenticated request.
- getCompanyPosts rejects an invalid company ID.

### createCompanyPost

- createCompanyPost rejects a missing company.
- createCompanyPost rejects a inaccessible company.
- createCompanyPost allows OWNER and saves trimmed text and author.
- createCompanyPost allows ADMIN and saves trimmed text and author.
- createCompanyPost rejects MEMBER without inserting a post.
- createCompanyPost rejects CONTRACTOR without inserting a post.
- createCompanyPost accepts minimum lengths.
- createCompanyPost accepts maximum lengths.
- createCompanyPost rejects blank title.
- createCompanyPost rejects long title.
- createCompanyPost rejects blank content.
- createCompanyPost rejects long content.
- createCompanyPost rejects an unauthenticated request.
- createCompanyPost rejects an invalid company ID.

### deleteCompanyPost

- deleteCompanyPost allows OWNER.
- deleteCompanyPost allows ADMIN.
- deleteCompanyPost rejects MEMBER.
- deleteCompanyPost rejects CONTRACTOR.
- deleteCompanyPost rejects a post from another company even for an owner of both.
- deleteCompanyPost rejects a nonmember even with the correct company ID.
- deleteCompanyPost rejects a missing post.
- deleteCompanyPost rejects an unauthenticated request.
- deleteCompanyPost rejects an invalid company ID.
- deleteCompanyPost rejects an invalid post ID.

### Member management

The `company member management` group covers `updateMemberRole` and `removeMember`:

- lets the owner promote a member to admin.
- lets the owner demote an admin and revokes their unused invitations.
- lets an admin change a member to contractor.
- lets an admin change a contractor to member.
- prevents an admin from granting admin privileges.
- prevents an admin from changing or removing another admin.
- prevents an admin from changing or removing themselves.
- prevents the owner from changing or removing themselves.
- prevents an owner from changing or removing another owner.
- prevents an admin from changing or removing the owner.
- rejects granting the OWNER role.
- rejects member management by a MEMBER.
- rejects member management by a CONTRACTOR.
- rejects member management by an outsider.
- requires authentication to manage members.
- rejects invalid company and user IDs before changing membership.
- rejects a missing member.
- cannot manage someone who belongs only to another company.
- removes a member while preserving their account, history, and other memberships.
- lets the owner remove an admin.
- lets an admin remove a member.
- lets an admin remove a contractor.
- revokes unused invitations to and from a removed person only in this company.
- blocks company access immediately after removal even with an existing session.
- uses current database permissions after an admin is demoted.
- serializes promotion and removal so an admin cannot remove a newly promoted admin.

### Recent post acknowledgments

- returns only the five newest acknowledging members with their profile pictures.
- returns an empty avatar summary for a new post.
- returns all acknowledging people when there are fewer than five.
- keeps the viewer acknowledged when they are older than the five shown people.
- returns the updated avatar summary immediately after acknowledging.
- does not move an existing acknowledgment to the front when it is repeated.
- fills the fifth avatar from the next acknowledgment after someone undoes theirs.
- excludes former members from both the recent avatars and the total.
- does not let a removed member acknowledge a post.
- does not accept a post ID belonging to a different company.

## Profile tests

[profile.test.ts](../src/server/api/routers/profile.test.ts) contains 21 cases for
`profile.get` and `profile.update`. Updates always use the signed-in user's ID.
The same name validation is used for signup and profile editing: 1–100 Unicode
characters after trimming, without control characters. Descriptions allow 500
Unicode characters and line breaks; empty descriptions are stored as `null`.

- get returns the current user's profile without authentication secrets.
- update saves a trimmed name and description and preserves account details.
- get returns the saved name even when the session still has the previous name.
- update changes only the signed-in user.
- update rejects a supplied user ID.
- update rejects extra account fields.
- update clears a description when it is blank.
- update accepts a null description.
- update preserves line breaks within a description.
- update accepts a one-character name.
- update accepts a 100-character Unicode name.
- update rejects an empty name without changing the profile.
- update rejects a whitespace-only name.
- update rejects a name longer than 100 characters.
- update rejects control characters in a name.
- update accepts a 500-character Unicode description.
- update rejects a description longer than 500 characters.
- update rejects null characters in a description before writing to PostgreSQL.
- get requires authentication.
- update requires authentication.
- rejects a session after its user is deleted.

## Account security tests

[security.test.ts](../src/server/api/routers/security.test.ts) contains 23 cases.
It exercises real password hashing, TOTP verification, encryption, database-backed
attempt limits, and the JWT security gate with a test-only encryption key.

- Password changes require the current password and, when enabled, a second factor.
- Incorrect, unchanged, and weak passwords are rejected; Google-only accounts cannot add a password here.
- Setup secrets are encrypted, bound to the user, and expire before confirmation.
- Enabling 2FA requires a valid authenticator code and stores only hashes of recovery codes.
- Password and Google sign-ins both require the second factor when enabled.
- Client-supplied security flags cannot bypass verification; pending sessions cannot access protected APIs.
- Expired, missing, wrong-user, and consumed challenges are rejected.
- Concurrent recovery-code use succeeds only once; authenticator codes cannot be replayed.
- Attempt limits apply across new sign-in challenges and expire after the cooldown.
- Replacing recovery codes invalidates previous codes; disabling 2FA clears secrets and challenges.
- Google-only enrollment requires recent provider sign-in.
- Anonymous access, supplied user IDs, legacy tokens, stale password logins, and revoked sessions are rejected.
- Tampering with encrypted authenticator secrets is detected.

## Auth tests

[auth.test.ts](../src/server/api/routers/auth.test.ts) contains 57 cases.

Signup names allow 1–100 Unicode code points without control characters. Passwords allow 12–128 code points and require a digit and symbol. Verification codes have six ASCII digits, a ten-minute lifetime, a sixty-second resend cooldown, and a five-failure limit. These procedures are public and are tested without a signed-in session.

### signup

- signup stores a trimmed unverified user with a real password hash.
- signup rejects an already verified email without creating another user.
- signup preserves an existing unverified account and asks for verification.
- signup treats different email capitalisation as the same account.
- signup accepts a one-character name.
- signup accepts a 100-character Unicode name.
- signup accepts a 12-character password.
- signup accepts a 128-character Unicode password.
- signup accepts a 254-character email.
- signup rejects empty name without saving a user.
- signup rejects whitespace name without saving a user.
- signup rejects 101-character name without saving a user.
- signup rejects control character in name without saving a user.
- signup rejects DEL character in name without saving a user.
- signup rejects C1 control character in name without saving a user.
- signup rejects invalid email without saving a user.
- signup rejects empty email without saving a user.
- signup rejects 255-character email without saving a user.
- signup rejects 11-character password without saving a user.
- signup rejects 129-character password without saving a user.
- signup rejects password without a number without saving a user.
- signup rejects password without a symbol without saving a user.

### verificationEmail

- verificationEmail saves a hashed six-digit code before sending it.
- verificationEmail rejects a missing account.
- verificationEmail finds an account regardless of email capitalisation.
- verificationEmail skips already verified accounts.
- verificationEmail rejects a resend before 60 seconds without replacing the code.
- verificationEmail replaces the code and resets attempts at the 60-second boundary.
- verificationEmail retains the saved code and cooldown when email delivery fails.
- verificationEmail retries a serialization conflict and sends only one email.
- verificationEmail stops after three serialization conflicts without sending email.
- verificationEmail does not retry unrelated transaction failures.
- verificationEmail rejects invalid email.
- verificationEmail rejects empty email.
- verificationEmail rejects 255-character email.

### verifyEmail

- verifyEmail verifies the account and deletes the used code.
- verifyEmail accepts a code delivered by verificationEmail.
- verifyEmail is idempotent for an already verified account.
- verifyEmail finds an account regardless of email capitalisation.
- verifyEmail rejects a missing account.
- verifyEmail rejects an account without a verification code.
- verifyEmail rejects an expired code.
- verifyEmail rejects a code at the exact expiry time.
- verifyEmail accepts a correct code after four failed attempts.
- verifyEmail commits incorrect attempts and blocks a correct code after five failures.
- verifyEmail rolls back the user update when deleting the code fails.
- verifyEmail retries a serialization conflict and completes verification.
- verifyEmail rejects empty code without consuming an attempt.
- verifyEmail rejects five-digit code without consuming an attempt.
- verifyEmail rejects seven-digit code without consuming an attempt.
- verifyEmail rejects letters in code without consuming an attempt.
- verifyEmail rejects whitespace around code without consuming an attempt.
- verifyEmail rejects non-ASCII digits without consuming an attempt.
- verifyEmail rejects a malformed email.

## Job tests

[job.test.ts](../src/server/api/routers/job.test.ts) contains 42 cases.

Job titles allow 1–99 characters after trimming; optional descriptions allow up to 500. Creation and deletion require OWNER or ADMIN. All company member roles can read jobs. Listing a missing or inaccessible company returns an empty list; fetching a missing or inaccessible job throws NOT_FOUND.

### getJob

- getJob returns the stored job to a company member.
- getJob allows ADMIN members.
- getJob allows MEMBER members.
- getJob allows CONTRACTOR members.
- getJob rejects an existing job from another company.
- getJob rejects a missing job.
- getJob rejects an unauthenticated request.
- getJob rejects an invalid ID.

### listCompanyJobs

- listCompanyJobs lists only the requested company jobs.
- listCompanyJobs returns an empty list when there are no jobs.
- listCompanyJobs returns an empty list for an inaccessible company.
- listCompanyJobs returns an empty list for a missing company.
- listCompanyJobs allows MEMBER members.
- listCompanyJobs allows CONTRACTOR members.
- listCompanyJobs rejects an unauthenticated request.
- listCompanyJobs rejects an invalid ID.

### createJob

- createJob allows OWNER and saves trimmed fields and creator.
- createJob allows ADMIN and saves trimmed fields and creator.
- createJob rejects MEMBER without inserting a job.
- createJob rejects CONTRACTOR without inserting a job.
- createJob rejects a missing company.
- createJob rejects a inaccessible company.
- createJob accepts a one-character title.
- createJob accepts a 99-character title.
- createJob accepts a 500-character description.
- createJob accepts a empty description.
- createJob accepts an omitted description.
- createJob rejects a empty title.
- createJob rejects a whitespace-only title.
- createJob rejects a 100-character title.
- createJob rejects a 501-character description.
- createJob rejects an unauthenticated request.
- createJob rejects an invalid ID.
- createJob rejects a stale session after its user is deleted.

### deleteJob

- deleteJob allows OWNER.
- deleteJob allows ADMIN.
- deleteJob rejects MEMBER.
- deleteJob rejects CONTRACTOR.
- deleteJob rejects a missing job.
- deleteJob rejects a job in a company the user does not belong to.
- deleteJob rejects an unauthenticated request.
- deleteJob rejects an invalid ID.

## Invitation tests

[invitation.test.ts](../src/server/api/routers/invitation.test.ts) adds 45 cases against real PostgreSQL, with only email delivery mocked. Acceptance checks the current database user email and verification status, not the email in a JWT.

- invites someone who has no account and stores only the token hash.
- invitation remains usable after the recipient signs up later.
- normalizes invited emails and allows an ADMIN to invite contractors.
- rejects invitation management by MEMBER.
- rejects invitation management by CONTRACTOR.
- rejects invitation creation by an outsider.
- rejects OWNER grants.
- rejects ADMIN grants.
- rejects zero-hour expiry.
- rejects expiry beyond seven days.
- rejects fractional-hour expiry.
- rejects malformed email.
- rejects invalid company ID.
- accepts a seven-day expiry.
- rejects inviting someone who is already a member.
- rejects immediate duplicate sends and preserves the first invitation.
- replaces an older invitation and invalidates its old token.
- rate limits invitation sends per company.
- rate limits invitation sends per sender.
- rate limits invitation sends per recipient.
- revokes the invitation if email delivery fails.
- lists company invitation metadata without exposing token hashes.
- revokes a pending invitation and prevents its acceptance.
- rejects revocation by a nonmanager.
- rejects revocation using the wrong company ID.
- only lists active invitations for the verified email.
- hides pending invitations from an unverified user.
- matches a verified email regardless of case.
- does not trust an email supplied by a stale or forged session.
- rejects an expired invitation.
- rejects an invitation at its exact expiry.
- accepts an invitation only once.
- preserves an existing member role when accepting an invitation.
- rejects invitations after the inviter loses management permissions.
- handles two simultaneous accept requests without duplicate membership.
- serializes concurrent revocation and acceptance.
- serializes concurrent sends to the same recipient without duplicate active invitations.
- rejects malformed and unknown invitation tokens.
- only shows company members to other company members.
- create requires authentication.
- list requires authentication.
- revoke requires authentication.
- pending requires authentication.
- accept requires authentication.
- members requires authentication.

[invitation-links.test.ts](../src/lib/invitation-links.test.ts) also checks preserving the token and email across auth URLs, retaining it after a failed verification send, rejecting arbitrary redirect URLs, and preserving ordinary login/signup behavior.

## Transaction tests

Most tests use ordinary database operations only. A few auth tests deliberately inject failures to exercise behavior that is hard to reproduce reliably:

- Serialization retry tests use `vi.spyOn(db, "$transaction")` to reject with Prisma error P2034. A retry then runs against the real database. The exhaustion test rejects all three attempts. These establish retry behavior; they do not simulate competing database clients.
- The verification rollback test installs a temporary PostgreSQL trigger that rejects deletion of a verification code. The route updates the user first, then deletion fails. Checking that the user remains unverified proves the real transaction rolled the update back. The test removes the trigger in `finally`.
- Email failure is simulated with the email mock. The stored code and cooldown must survive delivery failure.

These cases are more advanced than the other tests. Their comments explain the additional setup, and they remain separate from the basic success and validation tests.

## Scope and follow up

[company-access.test.ts](../src/server/company-access.test.ts) checks eight page
navigation cases: allowed access, redirecting a removed member to another company,
redirecting to join with no companies, avoiding redirects back to the unavailable
company, expired sessions, unexpected tRPC errors, unexpected page errors, and a
failed company-list request. These mock Next's redirect and the company list; the
router tests separately prove that removal actually revokes access in PostgreSQL.

The suites cover eleven company procedures, three auth procedures, and four job procedures. Invitation tests cover create, list, revoke, pending, accept, and members. Post acknowledgment tests cover recent avatar summaries, toggles, and former-member counts. Dedicated tests for the administrator-only acknowledgment dashboard remain follow-up work.

The auth branch for a user with no email cannot normally be reached by looking up that user with a validated non-null email. It remains uncovered rather than returning an impossible record from a database mock to raise the percentage.

NextAuth login, OAuth, cookies, HTTP request handling, actual email delivery, and browser interactions are outside this suite. The invitation suite does exercise simultaneous sends, acceptance, and revocation using separate database transactions. Other concurrency behavior requires its own scenarios rather than relying on code coverage.

The getJob success test caught a missing `return job` in the current implementation. That return is restored with this suite.
