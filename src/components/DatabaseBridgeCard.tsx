import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  CloudUpload,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  Loader2,
  LogOut,
  MessageSquarePlus,
  Plus,
  Trash2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { WorkspaceDetail } from '../types';
import { apiFetch } from '../utils/api';
import { formatBytes } from '../utils/format';
import {
  createWorkspaceReviewNote,
  deleteSyncedSnapshot,
  deleteWorkspaceReviewNote,
  generateFirestoreRulesFromModels,
  generatePostgresSqlFromModels,
  resolveWorkspaceReviewNote,
  signInWithGoogleFirebase,
  signOutFirebase,
  subscribeFirebaseUser,
  subscribeSyncedSnapshots,
  subscribeWorkspaceReviewNotes,
  syncWorkspaceSnapshotToFirestore,
  type CloudReviewNote,
  type CloudSavedSnapshot,
} from '../lib/firebaseBridge';
import firebaseConfig from '../../firebase-applet-config.json';

interface DatabaseBridgeCardProps {
  workspace: WorkspaceDetail;
  onOpenFileInEditor: (filePath: string) => void;
  onRefreshWorkspace: () => Promise<void>;
  onImportSavedRepo?: (repoUrl: string, branch: string) => void;
}

const OfficialGoogleGMark: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
    />
    <path
      fill="#34A853"
      d="M9.003 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9.003 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.964 10.712A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.33z"
    />
    <path
      fill="#EA4335"
      d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.002 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z"
    />
  </svg>
);

function parseDisplayError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // Plain message
  }
  return raw;
}

export const DatabaseBridgeCard: React.FC<DatabaseBridgeCardProps> = ({
  workspace,
  onOpenFileInEditor,
  onRefreshWorkspace,
  onImportSavedRepo,
}) => {
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [writingArtifact, setWritingArtifact] = useState<'firestore' | 'postgres' | null>(null);

  const [snapshotNote, setSnapshotNote] = useState('');
  const [savedSnapshots, setSavedSnapshots] = useState<CloudSavedSnapshot[]>([]);
  const [reviewNotes, setReviewNotes] = useState<CloudReviewNote[]>([]);
  const [newNoteRoute, setNewNoteRoute] = useState('/');
  const [newNoteComment, setNewNoteComment] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeFirebaseUser((u) => {
      setFbUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Real-time Firestore listener for user's saved workspace snapshots
  useEffect(() => {
    if (!authReady || !fbUser) {
      setSavedSnapshots([]);
      return;
    }
    const unsub = subscribeSyncedSnapshots(
      fbUser,
      (items) => {
        setSavedSnapshots(items);
        const match = items.find((i) => i.workspaceId === workspace.id);
        if (match && match.notes) {
          setSnapshotNote((prev) => prev || match.notes);
        }
      },
      (err) => setErrorMessage(parseDisplayError(err))
    );
    return () => unsub();
  }, [authReady, fbUser, workspace.id]);

  // Real-time Firestore listener for QA review notes on the active workspace
  useEffect(() => {
    if (!authReady || !fbUser) {
      setReviewNotes([]);
      return;
    }
    const isCurrentSynced = savedSnapshots.some((s) => s.workspaceId === workspace.id);
    if (!isCurrentSynced) {
      setReviewNotes([]);
      return;
    }
    const unsub = subscribeWorkspaceReviewNotes(
      fbUser,
      workspace.id,
      (notes) => setReviewNotes(notes),
      (err) => setErrorMessage(parseDisplayError(err))
    );
    return () => unsub();
  }, [authReady, fbUser, workspace.id, savedSnapshots]);

  const handleWriteFirestoreRulesBridge = async () => {
    setWritingArtifact('firestore');
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const rulesText = generateFirestoreRulesFromModels(workspace.databaseSchema.models);
      const targetPath = workspace.targetSubPath
        ? `${workspace.targetSubPath}/firestore.rules`
        : 'firestore.rules';
      const res = await apiFetch(`/api/workspaces/${workspace.id}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, content: rulesText }),
      });
      if (!res.ok) throw new Error('Failed to write firestore.rules into workspace.');
      await onRefreshWorkspace();
      setStatusMessage(`Generated hardened ${targetPath} in workspace.`);
      onOpenFileInEditor(targetPath);
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    } finally {
      setWritingArtifact(null);
    }
  };

  const handleWritePostgresSqlBridge = async () => {
    setWritingArtifact('postgres');
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const sqlText = generatePostgresSqlFromModels(workspace.databaseSchema.models);
      const targetPath = workspace.targetSubPath
        ? `${workspace.targetSubPath}/db/cloudsql-migration.sql`
        : 'db/cloudsql-migration.sql';
      const res = await apiFetch(`/api/workspaces/${workspace.id}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, content: sqlText }),
      });
      if (!res.ok) throw new Error('Failed to write SQL migration into workspace.');
      await onRefreshWorkspace();
      setStatusMessage(`Generated ${targetPath} in workspace.`);
      onOpenFileInEditor(targetPath);
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    } finally {
      setWritingArtifact(null);
    }
  };

  const handleFirebaseSignIn = async () => {
    setSigningIn(true);
    setErrorMessage(null);
    try {
      await signInWithGoogleFirebase();
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleCloudSync = async () => {
    setSyncing(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      let currentUser = fbUser;
      if (!currentUser) {
        currentUser = await signInWithGoogleFirebase();
      }
      const saved = await syncWorkspaceSnapshotToFirestore(workspace, snapshotNote);
      const dbLabel = firebaseConfig.firestoreDatabaseId || firebaseConfig.projectId;
      setStatusMessage(
        `Synced workspace snapshot (${saved.workspaceId}) to Cloud Firestore (${dbLabel.slice(0, 34)}...).`
      );
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteSnapshot = async (wsId: string) => {
    setErrorMessage(null);
    setConfirmDeleteId(null);
    try {
      await deleteSyncedSnapshot(wsId);
      setStatusMessage(`Deleted snapshot ${wsId} from Cloud Firestore.`);
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    }
  };

  const handleAddReviewNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteComment.trim()) return;
    setAddingNote(true);
    setErrorMessage(null);
    try {
      await createWorkspaceReviewNote(workspace, newNoteRoute, newNoteComment);
      setNewNoteComment('');
      setStatusMessage('Saved QA review note to Cloud Firestore.');
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    } finally {
      setAddingNote(false);
    }
  };

  const handleResolveNote = async (noteId: string) => {
    setErrorMessage(null);
    try {
      await resolveWorkspaceReviewNote(workspace.id, noteId);
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setErrorMessage(null);
    try {
      await deleteWorkspaceReviewNote(workspace.id, noteId);
    } catch (err) {
      setErrorMessage(parseDisplayError(err));
    }
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-2xs">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <Database className="w-4 h-4 text-orange-500 dark:text-orange-400" />
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Firebase Cloud Firestore Sync &amp; Schema Bridge
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              {workspace.databaseSchema.detected
                ? `${workspace.databaseSchema.models.length} ${workspace.databaseSchema.ormType} model(s) parsed`
                : 'Cloud Firestore connected'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Persist repository snapshots and live QA review checklists to Firebase Cloud Firestore, or translate detected ORM models into hardened <code>firestore.rules</code> and PostgreSQL DDL.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={writingArtifact !== null}
            onClick={() => void handleWriteFirestoreRulesBridge()}
            className="h-9 px-3 rounded-lg border border-amber-300 dark:border-slate-700 bg-amber-50/70 dark:bg-slate-800/80 hover:bg-amber-100 dark:hover:bg-slate-800 text-xs font-semibold text-amber-900 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {writingArtifact === 'firestore' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileCode2 className="w-3.5 h-3.5 text-orange-600 dark:text-amber-400" />
            )}
            <span>Generate Firestore Rules</span>
          </button>

          <button
            type="button"
            disabled={writingArtifact !== null}
            onClick={() => void handleWritePostgresSqlBridge()}
            className="h-9 px-3 rounded-lg border border-cyan-300 dark:border-slate-700 bg-cyan-50/70 dark:bg-slate-800/80 hover:bg-cyan-100 dark:hover:bg-slate-800 text-xs font-semibold text-cyan-900 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {writingArtifact === 'postgres' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileCode2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
            )}
            <span>Generate Cloud SQL DDL</span>
          </button>

          {!fbUser ? (
            <button
              type="button"
              disabled={signingIn || syncing}
              onClick={() => void handleFirebaseSignIn()}
              className="h-9 px-3.5 rounded border bg-[#FFFFFF] border-[#DADCE0] text-[#3C4043] text-xs font-semibold inline-flex items-center gap-2 shadow-2xs hover:bg-[#F8F9FA] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              {signingIn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
              ) : (
                <OfficialGoogleGMark />
              )}
              <span>Sign in with Google</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void handleCloudSync()}
                className="h-9 px-3.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {syncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                <span>Sync Snapshot to Firestore</span>
              </button>

              <button
                type="button"
                onClick={() => void signOutFirebase()}
                title={`Signed in as ${fbUser.email || fbUser.uid}`}
                className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="px-5 py-2.5 bg-emerald-50 dark:bg-emerald-950/30 border-b border-slate-200 dark:border-slate-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="px-5 py-2.5 bg-rose-50 dark:bg-rose-950/30 border-b border-slate-200 dark:border-slate-800 text-xs text-rose-800 dark:text-rose-300">
          {errorMessage}
        </div>
      )}

      {/* Authenticated Firebase Cloud Persistence Workbench */}
      {fbUser && (
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 space-y-5 bg-slate-50/40 dark:bg-[#0E1420]/50">
          {/* Snapshot Note & Quick Sync Row */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <input
              type="text"
              maxLength={1000}
              value={snapshotNote}
              onChange={(e) => setSnapshotNote(e.target.value)}
              placeholder={`Optional cloud snapshot note for ${workspace.owner}/${workspace.repoName}@${workspace.branch}...`}
              className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleCloudSync()}
              className="h-9 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
              <span>Save Snapshot Note</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Saved Cloud Snapshots List (Real-Time onSnapshot) */}
            <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  Saved Cloud Snapshots ({savedSnapshots.length})
                </span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {fbUser.email || fbUser.uid.slice(0, 10)}
                </span>
              </div>

              {savedSnapshots.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No snapshots synced to Firestore yet. Click <strong>Sync Snapshot to Firestore</strong> to persist this workspace across sessions.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {savedSnapshots.map((snap) => (
                    <div
                      key={snap.workspaceId}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {snap.repoFullName || snap.repoUrl.replace('https://github.com/', '')}
                          </span>
                          <span className="text-slate-400 font-mono inline-flex items-center gap-0.5">
                            <GitBranch className="w-3 h-3" />
                            {snap.branch}@{snap.commitShort}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                          {snap.framework} · {snap.totalFiles} files ({formatBytes(snap.totalBytes)})
                          {snap.notes ? ` · "${snap.notes}"` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {onImportSavedRepo && (
                          <button
                            type="button"
                            onClick={() => onImportSavedRepo(snap.repoUrl, snap.branch)}
                            className="h-7 px-2.5 rounded-md border border-cyan-300 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-950/40 hover:bg-cyan-100 dark:hover:bg-cyan-900/50 text-cyan-800 dark:text-cyan-300 font-semibold cursor-pointer whitespace-nowrap"
                          >
                            Load
                          </button>
                        )}
                        <a
                          href={snap.repoUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open GitHub Repo"
                          className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {confirmDeleteId === snap.workspaceId ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteSnapshot(snap.workspaceId)}
                            className="h-7 px-2 rounded-md bg-rose-600 text-white font-semibold cursor-pointer whitespace-nowrap"
                          >
                            Confirm
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(snap.workspaceId)}
                            title="Delete saved snapshot"
                            className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Workspace QA Review Checklist (Real-Time Subcollection onSnapshot) */}
            <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-xl overflow-hidden flex flex-col justify-between">
              <div>
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                    <MessageSquarePlus className="w-3.5 h-3.5 text-orange-500" />
                    <span>Cloud QA Review Notes ({reviewNotes.length})</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {workspace.repoName}
                  </span>
                </div>

                {reviewNotes.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                    Add route-specific QA review items synced in real time to Firestore.
                  </div>
                ) : (
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {reviewNotes.map((note) => (
                      <div
                        key={note.noteId}
                        className="px-4 py-2 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] text-cyan-700 dark:text-cyan-400 truncate">
                            {note.routePath} · {note.status === 'resolved' ? 'Resolved (Locked)' : 'Open'}
                          </div>
                          <div
                            className={`mt-0.5 break-words ${
                              note.status === 'resolved'
                                ? 'line-through text-slate-400 dark:text-slate-500'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {note.comment}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {note.status === 'open' && (
                            <button
                              type="button"
                              onClick={() => void handleResolveNote(note.noteId)}
                              title="Mark resolved"
                              className="p-1 text-emerald-600 hover:text-emerald-700 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteNote(note.noteId)}
                            title="Delete review note"
                            className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleAddReviewNote}
                className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0B0F17] flex items-center gap-2"
              >
                <input
                  type="text"
                  maxLength={200}
                  value={newNoteRoute}
                  onChange={(e) => setNewNoteRoute(e.target.value)}
                  placeholder="/route"
                  aria-label="Route path"
                  className="w-20 h-8 px-2 rounded-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <input
                  type="text"
                  maxLength={1000}
                  value={newNoteComment}
                  onChange={(e) => setNewNoteComment(e.target.value)}
                  placeholder="Add QA review note..."
                  aria-label="QA review note"
                  className="flex-1 h-8 px-2.5 rounded-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={addingNote || !newNoteComment.trim()}
                  className="h-8 px-2.5 rounded-md bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  {addingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  <span>Add</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {workspace.databaseSchema.detected && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
          {workspace.databaseSchema.models.map((model) => (
            <div
              key={`${model.sourceFile}-${model.name}`}
              className="border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B0F17] rounded-lg overflow-hidden"
            >
              <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {model.name}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenFileInEditor(model.sourceFile)}
                  className="text-cyan-700 dark:text-cyan-400 hover:underline font-mono font-semibold cursor-pointer"
                >
                  {model.orm}
                </button>
              </div>
              <div className="divide-y divide-slate-200/70 dark:divide-slate-800/60 max-h-44 overflow-y-auto text-xs font-mono">
                {model.fields.map((field) => (
                  <div
                    key={field.name}
                    className="px-3.5 py-1.5 flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-800 dark:text-slate-300 truncate">
                      {field.name}
                      {field.isPrimary ? ' (PK)' : ''}
                    </span>
                    <span className="text-slate-500 shrink-0">
                      {field.type}
                      {field.isOptional ? '?' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
