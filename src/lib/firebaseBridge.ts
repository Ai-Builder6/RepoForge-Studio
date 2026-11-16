import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { DetectedSchemaModel, WorkspaceDetail } from '../types';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export const GOOGLE_DRIVE_SCOPES = GOOGLE_WORKSPACE_SCOPES;

// Validation constants synchronized verbatim with firebase-blueprint.json
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+.*$/;

// Strictly cache Google Workspace OAuth access token in memory only (never in localStorage/sessionStorage)
let isSigningInDrive = false;
let cachedDriveAccessToken: string | null = null;
const driveListeners = new Set<(state: { user: User | null; hasDriveToken: boolean }) => void>();

function notifyDriveListeners() {
  const payload = {
    user: auth.currentUser,
    hasDriveToken: Boolean(cachedDriveAccessToken),
  };
  for (const listener of driveListeners) {
    listener(payload);
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user && !isSigningInDrive) {
    cachedDriveAccessToken = null;
  }
  notifyDriveListeners();
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

function sanitizeDocId(raw: string, fallbackPrefix = 'item'): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  if (cleaned && SAFE_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}`;
}

function formatTimestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return new Date().toISOString();
}

export function subscribeFirebaseUser(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export function subscribeDriveAuthState(
  cb: (state: { user: User | null; hasDriveToken: boolean }) => void
) {
  driveListeners.add(cb);
  cb({
    user: auth.currentUser,
    hasDriveToken: Boolean(cachedDriveAccessToken),
  });
  return () => {
    driveListeners.delete(cb);
  };
}

export function getCachedDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function clearCachedDriveAccessToken(): void {
  cachedDriveAccessToken = null;
  notifyDriveListeners();
}

export async function ensureUserProfileInFirestore(user: User): Promise<void> {
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const userDocPath = `users/${safeUid}`;
  const userRef = doc(db, 'users', safeUid);

  try {
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      const rawName = (user.displayName || user.email?.split('@')[0] || 'Developer').trim();
      const safeDisplayName = (rawName || 'Developer').slice(0, 100);
      await setDoc(userRef, {
        uid: safeUid,
        displayName: safeDisplayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userDocPath);
  }
}

export async function signInWithGoogleForDrive(
  forceAccountPicker = false
): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningInDrive = true;
    const provider = new GoogleAuthProvider();
    for (const scope of GOOGLE_DRIVE_SCOPES) {
      provider.addScope(scope);
    }
    provider.setCustomParameters({
      prompt: forceAccountPicker ? 'select_account consent' : 'consent',
    });

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Sign-In succeeded, but no Google Drive access token was returned.');
    }

    cachedDriveAccessToken = credential.accessToken;
    notifyDriveListeners();
    await ensureUserProfileInFirestore(result.user);
    return { user: result.user, accessToken: credential.accessToken };
  } finally {
    isSigningInDrive = false;
  }
}

export async function signInWithGoogleFirebase(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfileInFirestore(cred.user);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  cachedDriveAccessToken = null;
  await signOut(auth);
  notifyDriveListeners();
}

export interface CloudSavedSnapshot {
  workspaceId: string;
  ownerId: string;
  repoUrl: string;
  repoFullName: string;
  branch: string;
  commitShort: string;
  framework: string;
  modelCount: number;
  totalFiles: number;
  totalBytes: number;
  notes: string;
  updatedAtIso: string;
}

export interface CloudReviewNote {
  noteId: string;
  workspaceId: string;
  ownerId: string;
  routePath: string;
  comment: string;
  status: 'open' | 'resolved';
  updatedAtIso: string;
}

export async function syncWorkspaceSnapshotToFirestore(
  workspace: WorkspaceDetail,
  notes = ''
): Promise<CloudSavedSnapshot> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in with Google first to sync snapshots to Firestore.');
  }

  await ensureUserProfileInFirestore(user);

  const safeUid = sanitizeDocId(user.uid, 'usr');
  const safeWsId = sanitizeDocId(workspace.id, 'ws');
  const docPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}`;
  const wsRef = doc(db, 'users', safeUid, 'repoforge_workspaces', safeWsId);

  const fallbackRepoUrl = `https://github.com/${workspace.owner || 'repo'}/${
    workspace.repoName || 'project'
  }`;
  const candidateUrl = (workspace.repoUrl || fallbackRepoUrl).trim().slice(0, 512);
  const safeRepoUrl = GITHUB_URL_REGEX.test(candidateUrl) ? candidateUrl : fallbackRepoUrl.slice(0, 512);
  const safeRepoFullName = `${workspace.owner}/${workspace.repoName}`.trim().slice(0, 200) || 'owner/repo';
  const safeBranch = (workspace.branch || 'main').trim().slice(0, 128) || 'main';
  const safeCommitShort = (workspace.commitShort || 'head').trim().slice(0, 40) || 'head';
  const safeFramework = (workspace.framework || 'Web Application').trim().slice(0, 120) || 'Web Application';
  const safeModelCount = Math.min(500, Math.max(0, Math.floor(workspace.databaseSchema.models.length)));
  const safeTotalFiles = Math.min(500000, Math.max(0, Math.floor(workspace.totalFiles || 0)));
  const safeTotalBytes = Math.min(10737418240, Math.max(0, Math.floor(workspace.totalBytes || 0)));
  const safeNotes = notes.trim().slice(0, 1000);

  let existingExists = false;
  try {
    const existingSnap = await getDoc(wsRef);
    existingExists = existingSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  try {
    if (existingExists) {
      await updateDoc(wsRef, {
        repoUrl: safeRepoUrl,
        repoFullName: safeRepoFullName,
        branch: safeBranch,
        commitShort: safeCommitShort,
        framework: safeFramework,
        modelCount: safeModelCount,
        totalFiles: safeTotalFiles,
        totalBytes: safeTotalBytes,
        notes: safeNotes,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(wsRef, {
        workspaceId: safeWsId,
        ownerId: safeUid,
        repoUrl: safeRepoUrl,
        repoFullName: safeRepoFullName,
        branch: safeBranch,
        commitShort: safeCommitShort,
        framework: safeFramework,
        modelCount: safeModelCount,
        totalFiles: safeTotalFiles,
        totalBytes: safeTotalBytes,
        notes: safeNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    return {
      workspaceId: safeWsId,
      ownerId: safeUid,
      repoUrl: safeRepoUrl,
      repoFullName: safeRepoFullName,
      branch: safeBranch,
      commitShort: safeCommitShort,
      framework: safeFramework,
      modelCount: safeModelCount,
      totalFiles: safeTotalFiles,
      totalBytes: safeTotalBytes,
      notes: safeNotes,
      updatedAtIso: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      existingExists ? OperationType.UPDATE : OperationType.CREATE,
      docPath
    );
  }
}

export async function listSyncedSnapshots(): Promise<CloudSavedSnapshot[]> {
  const user = auth.currentUser;
  if (!user) return [];
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const colPath = `users/${safeUid}/repoforge_workspaces`;
  try {
    const q = query(
      collection(db, 'users', safeUid, 'repoforge_workspaces'),
      where('ownerId', '==', safeUid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const raw = d.data();
      return {
        workspaceId: String(raw.workspaceId || d.id),
        ownerId: String(raw.ownerId || safeUid),
        repoUrl: String(raw.repoUrl || ''),
        repoFullName: String(raw.repoFullName || ''),
        branch: String(raw.branch || 'main'),
        commitShort: String(raw.commitShort || 'head'),
        framework: String(raw.framework || ''),
        modelCount: Number(raw.modelCount || 0),
        totalFiles: Number(raw.totalFiles || 0),
        totalBytes: Number(raw.totalBytes || 0),
        notes: String(raw.notes || ''),
        updatedAtIso: formatTimestampToIso(raw.updatedAt),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export function subscribeSyncedSnapshots(
  user: User,
  onData: (items: CloudSavedSnapshot[]) => void,
  onError?: (err: Error) => void
) {
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const colPath = `users/${safeUid}/repoforge_workspaces`;
  const q = query(
    collection(db, 'users', safeUid, 'repoforge_workspaces'),
    where('ownerId', '==', safeUid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: CloudSavedSnapshot[] = snapshot.docs
        .map((d) => {
          const raw = d.data();
          return {
            workspaceId: String(raw.workspaceId || d.id),
            ownerId: String(raw.ownerId || safeUid),
            repoUrl: String(raw.repoUrl || ''),
            repoFullName: String(raw.repoFullName || ''),
            branch: String(raw.branch || 'main'),
            commitShort: String(raw.commitShort || 'head'),
            framework: String(raw.framework || ''),
            modelCount: Number(raw.modelCount || 0),
            totalFiles: Number(raw.totalFiles || 0),
            totalBytes: Number(raw.totalBytes || 0),
            notes: String(raw.notes || ''),
            updatedAtIso: formatTimestampToIso(raw.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (structuredErr) {
        if (onError && structuredErr instanceof Error) {
          onError(structuredErr);
        }
      }
    }
  );
}

export async function deleteSyncedSnapshot(workspaceId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const safeWsId = sanitizeDocId(workspaceId, 'ws');
  const notesColPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}/review_notes`;
  const docPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}`;

  try {
    const notesQ = query(
      collection(db, 'users', safeUid, 'repoforge_workspaces', safeWsId, 'review_notes'),
      where('ownerId', '==', safeUid)
    );
    const notesSnap = await getDocs(notesQ);
    for (const noteDoc of notesSnap.docs) {
      await deleteDoc(noteDoc.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, notesColPath);
  }

  try {
    await deleteDoc(doc(db, 'users', safeUid, 'repoforge_workspaces', safeWsId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function subscribeWorkspaceReviewNotes(
  user: User,
  workspaceId: string,
  onData: (notes: CloudReviewNote[]) => void,
  onError?: (err: Error) => void
) {
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const safeWsId = sanitizeDocId(workspaceId, 'ws');
  const colPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}/review_notes`;
  const q = query(
    collection(db, 'users', safeUid, 'repoforge_workspaces', safeWsId, 'review_notes'),
    where('ownerId', '==', safeUid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const notes: CloudReviewNote[] = snapshot.docs
        .map((d) => {
          const raw = d.data();
          return {
            noteId: String(raw.noteId || d.id),
            workspaceId: String(raw.workspaceId || safeWsId),
            ownerId: String(raw.ownerId || safeUid),
            routePath: String(raw.routePath || '/'),
            comment: String(raw.comment || ''),
            status: raw.status === 'resolved' ? ('resolved' as const) : ('open' as const),
            updatedAtIso: formatTimestampToIso(raw.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
      onData(notes);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (structuredErr) {
        if (onError && structuredErr instanceof Error) {
          onError(structuredErr);
        }
      }
    }
  );
}

export async function createWorkspaceReviewNote(
  workspace: WorkspaceDetail,
  routePath: string,
  comment: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google first to save review notes.');

  await ensureUserProfileInFirestore(user);

  const safeUid = sanitizeDocId(user.uid, 'usr');
  const safeWsId = sanitizeDocId(workspace.id, 'ws');
  const parentPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}`;
  const parentRef = doc(db, 'users', safeUid, 'repoforge_workspaces', safeWsId);

  let parentExists = false;
  try {
    const parentSnap = await getDoc(parentRef);
    parentExists = parentSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, parentPath);
  }

  // Ensure both parent user profile and parent workspace snapshot exist in Firestore without overwriting existing notes
  if (!parentExists) {
    await syncWorkspaceSnapshotToFirestore(workspace);
  }

  const noteId = sanitizeDocId(`note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, 'note');
  const safeRoute = (routePath.trim() || '/').slice(0, 200);
  const safeComment = comment.trim().slice(0, 1000);
  if (!safeComment) throw new Error('Review note comment is required.');

  const docPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}/review_notes/${noteId}`;
  try {
    await setDoc(
      doc(db, 'users', safeUid, 'repoforge_workspaces', safeWsId, 'review_notes', noteId),
      {
        noteId,
        workspaceId: safeWsId,
        ownerId: safeUid,
        routePath: safeRoute,
        comment: safeComment,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function resolveWorkspaceReviewNote(
  workspaceId: string,
  noteId: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const safeWsId = sanitizeDocId(workspaceId, 'ws');
  const safeNoteId = sanitizeDocId(noteId, 'note');
  const docPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}/review_notes/${safeNoteId}`;

  try {
    await updateDoc(
      doc(db, 'users', safeUid, 'repoforge_workspaces', safeWsId, 'review_notes', safeNoteId),
      {
        status: 'resolved',
        updatedAt: serverTimestamp(),
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deleteWorkspaceReviewNote(
  workspaceId: string,
  noteId: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const safeUid = sanitizeDocId(user.uid, 'usr');
  const safeWsId = sanitizeDocId(workspaceId, 'ws');
  const safeNoteId = sanitizeDocId(noteId, 'note');
  const docPath = `users/${safeUid}/repoforge_workspaces/${safeWsId}/review_notes/${safeNoteId}`;

  try {
    await deleteDoc(
      doc(db, 'users', safeUid, 'repoforge_workspaces', safeWsId, 'review_notes', safeNoteId)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function generateFirestoreRulesFromModels(models: DetectedSchemaModel[]): string {
  const targetModels =
    models.length > 0
      ? models
      : [
          {
            name: 'Item',
            sourceFile: 'generated',
            orm: 'Prisma' as const,
            fields: [
              { name: 'id', type: 'String', isPrimary: true },
              { name: 'title', type: 'String' },
              { name: 'ownerId', type: 'String' },
            ],
          },
        ];

  const validators = targetModels
    .map((m) => {
      const allowedKeys = Array.from(
        new Set([...m.fields.map((f) => f.name), 'ownerId', 'createdAt', 'updatedAt'])
      )
        .map((k) => `'${k}'`)
        .join(', ');
      return `    function isValid${m.name}(data) {
      return data.keys().hasAll(['ownerId', 'createdAt', 'updatedAt']) &&
             data.keys().hasOnly([${allowedKeys}]) &&
             data.ownerId is string && data.ownerId.size() <= 128 &&
             data.ownerId == request.auth.uid &&
             data.createdAt is timestamp &&
             data.updatedAt is timestamp;
    }`;
    })
    .join('\n\n');

  const matches = targetModels
    .map((m) => {
      const colName = m.name.toLowerCase() + 's';
      const mutableKeys = m.fields
        .map((f) => f.name)
        .filter((n) => n !== 'id' && n !== 'ownerId' && n !== 'createdAt')
        .concat(['updatedAt'])
        .map((k) => `'${k}'`)
        .join(', ');
      return `    match /${colName}/{docId} {
      allow get: if isSignedIn() && isValidId(docId) && resource.data.ownerId == request.auth.uid;
      allow list: if isSignedIn() && resource.data.ownerId == request.auth.uid;
      allow create: if isSignedIn() && isValidId(docId) && isValid${m.name}(request.resource.data) &&
                    request.resource.data.createdAt == request.time &&
                    request.resource.data.updatedAt == request.time;
      allow update: if isSignedIn() && isValidId(docId) && isValid${m.name}(request.resource.data) &&
                    resource.data.ownerId == request.auth.uid &&
                    request.resource.data.ownerId == resource.data.ownerId &&
                    request.resource.data.createdAt == resource.data.createdAt &&
                    request.resource.data.updatedAt == request.time &&
                    request.resource.data.diff(resource.data).affectedKeys().hasOnly([${mutableKeys}]);
      allow delete: if isSignedIn() && isValidId(docId) && resource.data.ownerId == request.auth.uid;
    }`;
    })
    .join('\n\n');

  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    function isSignedIn() {
      return request.auth != null && request.auth.token.email_verified == true;
    }

    function isValidId(id) {
      return id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$');
    }

${validators}

${matches}
  }
}
`;
}

export function generatePostgresSqlFromModels(models: DetectedSchemaModel[]): string {
  if (models.length === 0) {
    return `-- Generated Cloud SQL (PostgreSQL) Starter Schema\nCREATE TABLE IF NOT EXISTS app_records (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  owner_id VARCHAR(128) NOT NULL,\n  payload JSONB NOT NULL DEFAULT '{}'::jsonb,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n`;
  }

  const mapSqlType = (rawType: string): string => {
    const t = rawType.toLowerCase();
    if (t.includes('int') || t === 'serial') return 'INTEGER';
    if (t.includes('bool')) return 'BOOLEAN';
    if (t.includes('date') || t.includes('time')) return 'TIMESTAMPTZ';
    if (t.includes('float') || t.includes('decimal') || t.includes('numeric')) return 'NUMERIC';
    if (t.includes('json')) return 'JSONB';
    if (t.includes('uuid')) return 'UUID';
    return 'TEXT';
  };

  return models
    .map((m) => {
      const cols = m.fields.map((f) => {
        const sqlT = mapSqlType(f.type);
        const pk = f.isPrimary ? ' PRIMARY KEY' : '';
        const nn = !f.isOptional && !f.isPrimary ? ' NOT NULL' : '';
        return `  "${f.name}" ${sqlT}${pk}${nn}`;
      });
      return `-- Source: ${m.sourceFile} (${m.orm})\nCREATE TABLE IF NOT EXISTS "${m.name.toLowerCase()}" (\n${cols.join(',\n')}\n);`;
    })
    .join('\n\n');
}
