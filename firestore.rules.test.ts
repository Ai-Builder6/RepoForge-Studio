import { describe, it, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

describe('RepoForge Studio Firestore Security Rules — Dirty Dozen Audit', () => {
  before(async () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-repoforge-security-test',
      firestore: {
        rules: fs.readFileSync(rulesPath, 'utf-8'),
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  function verifiedDb(uid: string): Firestore {
    return testEnv
      .authenticatedContext(uid, {
        email: `${uid}@example.com`,
        email_verified: true,
      })
      .firestore() as unknown as Firestore;
  }

  function unverifiedDb(uid: string): Firestore {
    return testEnv
      .authenticatedContext(uid, {
        email: `${uid}@example.com`,
        email_verified: false,
      })
      .firestore() as unknown as Firestore;
  }

  async function seedUserAndWorkspace(uid: string, workspaceId: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      const now = Timestamp.now();
      await setDoc(doc(adminDb, 'users', uid), {
        uid,
        displayName: 'Alice Builder',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'users', uid, 'repoforge_workspaces', workspaceId), {
        workspaceId,
        ownerId: uid,
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Static HTML / CSS / JS',
        modelCount: 0,
        totalFiles: 28,
        totalBytes: 124000,
        notes: 'Initial synced snapshot',
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  it('1. Rejects unverified email token attempting to create UserProfile', async () => {
    const db = unverifiedDb('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'alice'), {
        uid: 'alice',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('2. Rejects cross-tenant identity spoofing under another user path', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('mallory');
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-spoof'), {
        workspaceId: 'ws-spoof',
        ownerId: 'alice',
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Vite + React',
        modelCount: 0,
        totalFiles: 10,
        totalBytes: 1024,
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('3. Rejects orphaned workspace snapshot creation when parent /users/{uid} is missing', async () => {
    const db = verifiedDb('bob');
    await assertFails(
      setDoc(doc(db, 'users', 'bob', 'repoforge_workspaces', 'ws-orphan'), {
        workspaceId: 'ws-orphan',
        ownerId: 'bob',
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Vite + React',
        modelCount: 0,
        totalFiles: 10,
        totalBytes: 1024,
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('4. Rejects shadow/ghost field injection (isAdmin: true) on create', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-shadow'), {
        workspaceId: 'ws-shadow',
        ownerId: 'alice',
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Vite + React',
        modelCount: 0,
        totalFiles: 10,
        totalBytes: 1024,
        notes: '',
        isAdmin: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('5. Rejects client-forged past timestamp instead of serverTimestamp()', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    const forgedPast = Timestamp.fromMillis(1700000000000);
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-forged-time'), {
        workspaceId: 'ws-forged-time',
        ownerId: 'alice',
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Vite + React',
        modelCount: 0,
        totalFiles: 10,
        totalBytes: 1024,
        notes: '',
        createdAt: forgedPast,
        updatedAt: forgedPast,
      })
    );
  });

  it('6. Rejects poisoned document IDs containing disallowed characters', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'bad$id!@#'), {
        workspaceId: 'bad$id!@#',
        ownerId: 'alice',
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Vite + React',
        modelCount: 0,
        totalFiles: 10,
        totalBytes: 1024,
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('7. Rejects resource-exhaustion string overflow exceeding blueprint maxLength', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-1'), {
        notes: 'x'.repeat(5000),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('8. Rejects invalid non-GitHub URL pattern injection', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-bad-url'), {
        workspaceId: 'ws-bad-url',
        ownerId: 'alice',
        repoUrl: 'javascript:alert(1)',
        repoFullName: 'evil/xss',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Static',
        modelCount: 0,
        totalFiles: 1,
        totalBytes: 100,
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('9. Rejects immutable field mutation (createdAt / ownerId tampering)', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-1'), {
        ownerId: 'mallory',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('10. Rejects value poisoning on whitelisted update key (invalid type/negative count)', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice', 'repoforge_workspaces', 'ws-1'), {
        modelCount: -5,
        notes: 'invalid count',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('11. Enforces Terminal State Locking once WorkspaceReviewNote is resolved', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const db = verifiedDb('alice');
    const noteRef = doc(
      db,
      'users',
      'alice',
      'repoforge_workspaces',
      'ws-1',
      'review_notes',
      'note-1'
    );
    await assertSucceeds(
      setDoc(noteRef, {
        noteId: 'note-1',
        workspaceId: 'ws-1',
        ownerId: 'alice',
        routePath: '/index.html',
        comment: 'Verify mobile header spacing',
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(noteRef, {
        status: 'resolved',
        updatedAt: serverTimestamp(),
      })
    );
    // Attempting any subsequent update after terminal state 'resolved' MUST fail
    await assertFails(
      updateDoc(noteRef, {
        status: 'open',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('12. Rejects unauthorized list query scraping by non-owners', async () => {
    await seedUserAndWorkspace('alice', 'ws-1');
    const malloryDb = verifiedDb('mallory');
    await assertFails(
      getDocs(
        query(
          collection(malloryDb, 'users', 'alice', 'repoforge_workspaces'),
          where('ownerId', '==', 'alice')
        )
      )
    );
  });

  it('13. Allows verified owner first-login getDoc existence check, create, and subsequent update', async () => {
    const aliceDb = verifiedDb('alice');
    const userRef = doc(aliceDb, 'users', 'alice');
    await assertSucceeds(getDoc(userRef));
    await assertSucceeds(
      setDoc(userRef, {
        uid: 'alice',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const wsRef = doc(aliceDb, 'users', 'alice', 'repoforge_workspaces', 'ws-live');
    await assertSucceeds(getDoc(wsRef));
    await assertSucceeds(
      setDoc(wsRef, {
        workspaceId: 'ws-live',
        ownerId: 'alice',
        repoUrl: 'https://github.com/gabrielecirulli/2048',
        repoFullName: 'gabrielecirulli/2048',
        branch: 'main',
        commitShort: 'abc1234',
        framework: 'Static HTML / CSS / JS',
        modelCount: 0,
        totalFiles: 28,
        totalBytes: 124000,
        notes: 'Initial note',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(wsRef, {
        notes: 'Updated note',
        updatedAt: serverTimestamp(),
      })
    );
  });
});
