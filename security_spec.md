# RepoForge Studio — Firestore Security Specification (Phase 0 Security TDD)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched under `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity Gate**: Every read and write requires `request.auth != null && request.auth.token.email_verified == true`. Unauthenticated or unverified tokens are rejected across all collections.
3. **PII Isolation & Non-PII User Root (`/users/{userId}`)**: User root documents store zero PII (`uid`, `displayName`, `createdAt`, `updatedAt` only) and are readable/writable exclusively by `request.auth.uid == userId`.
4. **Master Gate & Orphan Prevention**:
   - A `SavedWorkspaceSnapshot` (`/users/{userId}/repoforge_workspaces/{workspaceId}`) cannot be created, read (`get`), updated, or deleted unless the parent `/users/{userId}` document exists and its `uid == request.auth.uid`.
   - A `WorkspaceReviewNote` (`/users/{userId}/repoforge_workspaces/{workspaceId}/review_notes/{noteId}`) cannot be created, read (`get`), updated, or deleted unless the parent `/users/{userId}/repoforge_workspaces/{workspaceId}` document exists and its `ownerId == request.auth.uid`.
5. **Secure List Queries (Cost-Optimized)**: `allow list` on subcollections enforces `userId == request.auth.uid && resource.data.ownerId == request.auth.uid` without `get()`/`exists()` N+1 lookups, and without applying `isValidId` to the target collection wildcard.
6. **Temporal & Immutable Field Integrity**:
   - On `create`: `createdAt == request.time && updatedAt == request.time`.
   - On `update`: `createdAt == resource.data.createdAt`, `ownerId == resource.data.ownerId`, primary IDs remain immutable, and `updatedAt == request.time`.
7. **Terminal State Locking**: Once a `WorkspaceReviewNote` reaches `status == 'resolved'`, all subsequent `update` operations are blocked (`resource.data.status != 'resolved'`).

---

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)

1. **Payload 1 — Unverified Email Spoof (`/users/alice`)**: Authenticated as `alice` with `email_verified: false` attempting `create` on `/users/alice`.
2. **Payload 2 — Cross-Tenant Identity Spoofing (`/users/alice/repoforge_workspaces/ws-1`)**: Authenticated as `mallory` (`email_verified: true`) setting `ownerId: "alice"` or `"mallory"` under `/users/alice/...`.
3. **Payload 3 — Orphaned Subcollection Write (`/users/bob/repoforge_workspaces/ws-1`)**: Authenticated as `bob` (`email_verified: true`) creating a workspace snapshot when `/users/bob` does not exist yet.
4. **Payload 4 — Shadow / Ghost Field Injection (`isAdmin: true`)**: Authenticated owner creating `/users/alice/repoforge_workspaces/ws-1` with all required keys plus `"isAdmin": true`.
5. **Payload 5 — Client-Forged Timestamp (`createdAt` in the past)**: Authenticated owner sending `createdAt: Timestamp.fromMillis(1700000000000)` instead of `serverTimestamp()` (`request.time`).
6. **Payload 6 — Path Variable ID Poisoning (`workspaceId` with spaces/slashes or >128 chars)**: Creating a snapshot at `/users/alice/repoforge_workspaces/bad$id!@#`.
7. **Payload 7 — Resource Exhaustion / Denial-of-Wallet String Overflow**: Updating `notes` on a workspace snapshot with a 5,000-character string (`maxLength` is `1000`).
8. **Payload 8 — Invalid URL Pattern Injection**: Creating a workspace snapshot where `repoUrl` is `"javascript:alert(1)"` instead of `^https://github\.com/...`.
9. **Payload 9 — Immutable Field Mutation (`ownerId` / `createdAt` Tampering)**: Owner attempting an `update` on `ws-1` that mutates `createdAt` or `ownerId`.
10. **Payload 10 — Value Poisoning During Partial Update**: Owner updating an allowed key (`modelCount`) with a string `"ten"` or negative integer `-5`.
11. **Payload 11 — Terminal State Re-Opening Bypass**: Owner attempting to `update` a `WorkspaceReviewNote` whose `status` is already `'resolved'` back to `'open'` or changing its `comment`.
12. **Payload 12 — Unauthorized List Query Scraping**: Authenticated user `mallory` executing a collection `list` query against `/users/alice/repoforge_workspaces` or without matching `ownerId`.
