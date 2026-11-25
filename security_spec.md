# Security Specification — Rota Express 3.0 (Phase 0 TDD)

## 1. Data Invariants

1. **Tenant & User Isolation**: Every operational record (`users`, `vehicles`, `routes`, `packages`, `delivery_events`, `financial_entries`, `favorite_addresses`, `import_templates`, `api_usage`) is strictly bound to `userId == request.auth.uid` (or `ownerId == request.auth.uid` for vehicles/organizations). No cross-user or cross-organization reads or writes are permitted.
2. **Verified Identity**: All writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **No Self-Escalation**: Users creating `/users/{userId}` can only assign `role == 'driver'` and cannot mutate `role` or `organizationId` after creation.
4. **Immutable Audit Trail**: Documents in `/delivery_events/{eventId}` are append-only (`update` and `delete` strictly denied) so historical delivery confirmations or failed attempts can never be silently erased.
5. **Terminal Route Locking**: Once a route reaches `status == 'finished'` or `status == 'cancelled'`, operational fields cannot be mutated by non-admin clients.
6. **Temporal Integrity**: `createdAt` is immutable and validated against `request.time` on creation; `updatedAt` is validated against `request.time` on update.
7. **Strict Key & Size Boundaries**: Every document creation validates `hasAll(...)` and `hasOnly(...)`; every update validates `affectedKeys().hasOnly(...)` inside named action branches wrapped by `isValid[Entity](incoming())`. Every string enforces explicit `.size() <= MAX`.
8. **ID Poisoning Guard**: Every single-document operation (`get`, `create`, `update`, `delete`) validates document IDs via `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Unauthenticated Read/Write**: Reading `/routes/r1` or creating `/packages/p1` with `auth: null`.
2. **Cross-User PII Read**: User B attempting `get` on `/users/userA` or `/packages/pkgOfUserA`.
3. **Role Self-Escalation on Create**: User A creating `/users/userA` with `{ role: "platform_admin" }`.
4. **Role Escalation on Update**: User A updating `/users/userA` with `{ role: "organization_admin" }`.
5. **Shadow / Ghost Field Injection**: User A updating `/vehicles/v1` with `{ name: "Fiorino", isVerified: true }`.
6. **ID Poisoning**: Creating `/routes/../../../admin` or a 1.5KB junk document ID.
7. **Ownership Hijacking**: User A creating `/routes/r2` with `{ userId: "userB" }`.
8. **Client Timestamp Forgery**: Creating `/financial_entries/f1` with a backdated client timestamp instead of `serverTimestamp()`.
9. **Audit Trail Tampering**: User A attempting `update` or `delete` on `/delivery_events/ev1`.
10. **Terminal State Violation**: User A attempting to mutate a route whose existing `status` is `'finished'`.
11. **Value Poisoning / Oversized Payload**: Setting `trackingCode` to a 5,000-character string or `amount` to a string `"999"`.
12. **Unverified Email Admin Spoof**: Token with `email: "eduardokainan.senai@gmail.com"` and `email_verified: false`.
