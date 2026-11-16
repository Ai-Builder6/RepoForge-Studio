import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Table,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type {
  GoogleDriveFileItem,
  GoogleDriveUploadResult,
  GoogleSheetsExportResult,
  GoogleSpreadsheetMetadata,
  WorkspaceDetail,
} from '../types';
import { apiFetch } from '../utils/api';
import { formatBytes } from '../utils/format';
import {
  clearCachedDriveAccessToken,
  getCachedDriveAccessToken,
  signInWithGoogleForDrive,
  signOutFirebase,
  subscribeDriveAuthState,
} from '../lib/firebaseBridge';

interface GoogleWorkspacePanelProps {
  workspace: WorkspaceDetail;
  onRefreshWorkspace: () => Promise<void>;
  onOpenFileInEditor: (filePath: string) => void;
}

type DriveFilterKind = 'all' | 'folders' | 'sheets' | 'code';

interface PendingConfirmation {
  kind:
    | 'trash-drive-file'
    | 'overwrite-workspace-file'
    | 'append-workspace-row'
    | 'append-custom-row'
    | 'update-sheet-cell'
    | 'repeat-drive-export';
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}

const OfficialGoogleGMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0 block">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

function formatSheetTabRange(sheetTitle: string, cellRange?: string): string {
  const escaped = sheetTitle.replace(/'/g, "''");
  return cellRange ? `'${escaped}'!${cellRange}` : `'${escaped}'`;
}

function columnIndexToLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function extractSpreadsheetId(rawInput: string): string {
  const trimmed = rawInput.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return trimmed;
}

export const GoogleWorkspacePanel: React.FC<GoogleWorkspacePanelProps> = ({
  workspace,
  onRefreshWorkspace,
  onOpenFileInEditor,
}) => {
  const defaultFolderName = `RepoForge - ${workspace.owner}-${workspace.repoName} (${
    workspace.branch || 'main'
  }-${workspace.commitShort || 'head'})`;

  const defaultSheetTitle = `RepoForge Audit - ${workspace.owner}/${workspace.repoName} (${
    workspace.branch || 'main'
  }@${workspace.commitShort || 'head'})`;

  // Auth State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  // Global Notice / Error / Confirmation Dialog State
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Quick Exporters State (Drive Folder + Multi-Tab Sheets Audit)
  const [exportFolderName, setExportFolderName] = useState(defaultFolderName);
  const [exportSheetTitle, setExportSheetTitle] = useState(defaultSheetTitle);
  const [targetDriveFolderId, setTargetDriveFolderId] = useState<string>('');
  const [exportingDrive, setExportingDrive] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [driveExportResult, setDriveExportResult] = useState<GoogleDriveUploadResult | null>(null);
  const [sheetExportResult, setSheetExportResult] = useState<GoogleSheetsExportResult | null>(null);

  // Google Drive Browser State
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFileItem[]>([]);
  const [driveFilter, setDriveFilter] = useState<DriveFilterKind>('all');
  const [driveSearch, setDriveSearch] = useState('');
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [newDriveFolderName, setNewDriveFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);

  // Google Sheets Inspector & Editor State
  const [spreadsheetInput, setSpreadsheetInput] = useState('');
  const [activeSheetMeta, setActiveSheetMeta] = useState<GoogleSpreadsheetMetadata | null>(null);
  const [selectedTabTitle, setSelectedTabTitle] = useState<string>('');
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    rowIdx: number;
    colIdx: number;
    a1Ref: string;
    currentValue: string;
    draftValue: string;
  } | null>(null);
  const [customRowInput, setCustomRowInput] = useState('');
  const [savingSheetToRepo, setSavingSheetToRepo] = useState(false);

  useEffect(() => {
    setExportFolderName(
      `RepoForge - ${workspace.owner}-${workspace.repoName} (${workspace.branch || 'main'}-${
        workspace.commitShort || 'head'
      })`
    );
    setExportSheetTitle(
      `RepoForge Audit - ${workspace.owner}/${workspace.repoName} (${workspace.branch || 'main'}@${
        workspace.commitShort || 'head'
      })`
    );
  }, [workspace.id, workspace.owner, workspace.repoName, workspace.branch, workspace.commitShort]);

  useEffect(() => {
    return subscribeDriveAuthState(({ user, hasDriveToken }) => {
      setAuthUser(user);
      setNeedsAuth(!hasDriveToken);
    });
  }, []);

  const ensureValidToken = useCallback(async (): Promise<string | null> => {
    const existing = getCachedDriveAccessToken();
    if (existing) return existing;
    setNeedsAuth(true);
    return null;
  }, []);

  const handleGoogleLogin = async (forcePicker = false) => {
    setSigningIn(true);
    setErrorMsg(null);
    try {
      await signInWithGoogleForDrive(forcePicker);
      setNeedsAuth(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or blocked.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const fetchDriveFiles = useCallback(async () => {
    const token = getCachedDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }

    setLoadingDrive(true);
    setErrorMsg(null);
    try {
      const clauses: string[] = ['trashed = false'];
      if (driveFilter === 'folders') {
        clauses.push("mimeType = 'application/vnd.google-apps.folder'");
      } else if (driveFilter === 'sheets') {
        clauses.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
      } else if (driveFilter === 'code') {
        clauses.push(
          "mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.spreadsheet'"
        );
      }

      const trimmedSearch = driveSearch.trim();
      if (trimmedSearch) {
        const escaped = trimmedSearch.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        clauses.push(`name contains '${escaped}'`);
      }

      const params = new URLSearchParams({
        pageSize: '40',
        orderBy: 'modifiedTime desc',
        q: clauses.join(' and '),
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
      });

      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.status === 401 || res.status === 403) {
        clearCachedDriveAccessToken();
        setNeedsAuth(true);
        throw new Error(
          'Your Google Drive & Sheets session expired or needs permission. Sign in with Google to continue.'
        );
      }

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Failed to list Google Drive files (${res.status}): ${txt.slice(0, 180)}`);
      }

      const data = (await res.json()) as { files?: GoogleDriveFileItem[] };
      setDriveFiles(data.files || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load Google Drive files.');
    } finally {
      setLoadingDrive(false);
    }
  }, [driveFilter, driveSearch]);

  useEffect(() => {
    if (!needsAuth) {
      void fetchDriveFiles();
    } else {
      setDriveFiles([]);
    }
  }, [needsAuth, fetchDriveFiles]);

  const driveFolders = useMemo(
    () => driveFiles.filter((f) => f.mimeType === 'application/vnd.google-apps.folder'),
    [driveFiles]
  );

  const driveSpreadsheets = useMemo(
    () => driveFiles.filter((f) => f.mimeType === 'application/vnd.google-apps.spreadsheet'),
    [driveFiles]
  );

  // Load a specific Google Sheet's tab values (never hardcoding "Sheet1")
  const loadSheetTabValues = useCallback(async (spreadsheetId: string, tabTitle: string) => {
    const token = getCachedDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }

    setLoadingSheet(true);
    setErrorMsg(null);
    setEditingCell(null);
    try {
      const range = formatSheetTabRange(tabTitle, 'A1:Z150');
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(range)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.status === 401 || res.status === 403) {
        clearCachedDriveAccessToken();
        setNeedsAuth(true);
        throw new Error('Google Sheets session expired. Sign in with Google again.');
      }

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Unable to read sheet tab "${tabTitle}" (${res.status}): ${txt.slice(0, 180)}`);
      }

      const data = (await res.json()) as { values?: string[][] };
      setSheetRows(data.values || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load Google Sheet values.');
    } finally {
      setLoadingSheet(false);
    }
  }, []);

  // Fetch spreadsheet metadata first to discover real sheet tab names
  const openSpreadsheetById = useCallback(
    async (rawIdOrUrl: string) => {
      const cleanId = extractSpreadsheetId(rawIdOrUrl);
      if (!cleanId) return;

      const token = await ensureValidToken();
      if (!token) return;

      setLoadingSheet(true);
      setErrorMsg(null);
      setEditingCell(null);
      try {
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            cleanId
          )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,gridProperties))`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (res.status === 401 || res.status === 403) {
          clearCachedDriveAccessToken();
          setNeedsAuth(true);
          throw new Error('Google Sheets permission required. Sign in with Google again.');
        }

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Could not open spreadsheet (${res.status}): ${txt.slice(0, 180)}`);
        }

        const raw = (await res.json()) as {
          spreadsheetId: string;
          spreadsheetUrl?: string;
          properties?: { title?: string };
          sheets?: Array<{
            properties?: {
              sheetId?: number;
              title?: string;
              gridProperties?: { rowCount?: number; columnCount?: number };
            };
          }>;
        };

        const sheets = (raw.sheets || []).map((s, idx) => ({
          sheetId: s.properties?.sheetId ?? idx,
          title: s.properties?.title || `Tab ${idx + 1}`,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount,
        }));

        const meta: GoogleSpreadsheetMetadata = {
          spreadsheetId: raw.spreadsheetId,
          title: raw.properties?.title || 'Untitled Spreadsheet',
          spreadsheetUrl:
            raw.spreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}/edit`,
          sheets,
        };

        setActiveSheetMeta(meta);
        setSpreadsheetInput(raw.spreadsheetId);

        if (sheets.length > 0) {
          const firstTab = sheets[0].title;
          setSelectedTabTitle(firstTab);
          await loadSheetTabValues(raw.spreadsheetId, firstTab);
        } else {
          setSelectedTabTitle('');
          setSheetRows([]);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to open Google Spreadsheet.');
      } finally {
        setLoadingSheet(false);
      }
    },
    [ensureValidToken, loadSheetTabValues]
  );

  // Full Project Export to Google Drive Folder
  const performDriveProjectExport = async () => {
    const token = await ensureValidToken();
    if (!token) return;

    setExportingDrive(true);
    setErrorMsg(null);
    setStatusNotice(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}/drive-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          folderName: exportFolderName.trim() || defaultFolderName,
          includeGeneratedDocs: true,
          mirrorSourceFiles: true,
        }),
      });

      const payload = (await res.json()) as {
        result?: GoogleDriveUploadResult;
        error?: string;
      };

      if (res.status === 401 || res.status === 403) {
        clearCachedDriveAccessToken();
        setNeedsAuth(true);
        throw new Error('Google Drive authorization expired. Sign in with Google again.');
      }

      if (!res.ok || !payload.result) {
        throw new Error(payload.error || 'Failed to upload workspace to Google Drive.');
      }

      setDriveExportResult(payload.result);
      setTargetDriveFolderId(payload.result.folderId);
      setStatusNotice(
        `Exported ${payload.result.uploadedFilesCount} files to Google Drive folder "${payload.result.folderName}".`
      );
      await onRefreshWorkspace();
      await fetchDriveFiles();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Drive export failed.');
    } finally {
      setExportingDrive(false);
    }
  };

  const handleDriveExportClick = () => {
    const targetName = exportFolderName.trim() || defaultFolderName;
    if (driveExportResult && driveExportResult.folderName === targetName) {
      setPendingConfirm({
        kind: 'repeat-drive-export',
        title: `Create another folder named "${targetName}" in Google Drive?`,
        description:
          'You already exported this workspace with the same folder name during this session. Confirming will create a separate new folder copy in your Google Drive.',
        confirmLabel: 'Create Folder & Upload',
        onConfirm: performDriveProjectExport,
      });
      return;
    }
    void performDriveProjectExport();
  };

  // Multi-Tab Audit Export to Google Sheets
  const handleExportAuditToSheets = async () => {
    const token = await ensureValidToken();
    if (!token) return;

    setExportingSheet(true);
    setErrorMsg(null);
    setStatusNotice(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}/sheets-export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          spreadsheetTitle: exportSheetTitle.trim() || defaultSheetTitle,
          folderId: targetDriveFolderId || undefined,
        }),
      });

      const payload = (await res.json()) as {
        result?: GoogleSheetsExportResult;
        error?: string;
      };

      if (res.status === 401 || res.status === 403) {
        clearCachedDriveAccessToken();
        setNeedsAuth(true);
        throw new Error('Google Sheets authorization expired. Sign in with Google again.');
      }

      if (!res.ok || !payload.result) {
        throw new Error(payload.error || 'Failed to create Google Sheets audit workbook.');
      }

      setSheetExportResult(payload.result);
      setStatusNotice(
        `Created 4-tab Google Sheet "${payload.result.title}" (${payload.result.totalRowsWritten} rows written).`
      );
      await fetchDriveFiles();
      await openSpreadsheetById(payload.result.spreadsheetId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sheets export failed.');
    } finally {
      setExportingSheet(false);
    }
  };

  // Create Standalone Google Drive Folder
  const handleCreateDriveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newDriveFolderName.trim();
    if (!cleanName) return;

    const token = await ensureValidToken();
    if (!token) return;

    setCreatingFolder(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: cleanName,
            mimeType: 'application/vnd.google-apps.folder',
          }),
        }
      );

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Folder creation failed (${res.status}): ${txt.slice(0, 160)}`);
      }

      const created = (await res.json()) as { id: string; name: string };
      setNewDriveFolderName('');
      setTargetDriveFolderId(created.id);
      setStatusNotice(`Created Google Drive folder "${created.name}".`);
      await fetchDriveFiles();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create Google Drive folder.');
    } finally {
      setCreatingFolder(false);
    }
  };

  // Trash a Google Drive File/Folder (Destructive -> Mandatory Confirmation Dialog)
  const requestTrashDriveItem = (item: GoogleDriveFileItem) => {
    setPendingConfirm({
      kind: 'trash-drive-file',
      title: `Move "${item.name}" to Google Drive Trash?`,
      description: `This will move the ${
        item.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file'
      } "${item.name}" to Trash in your Google Drive account.`,
      confirmLabel: 'Move to Trash',
      destructive: true,
      onConfirm: async () => {
        const token = await ensureValidToken();
        if (!token) return;
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ trashed: true }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Failed to move item to Trash (${res.status}): ${txt.slice(0, 160)}`);
        }
        if (activeSheetMeta?.spreadsheetId === item.id) {
          setActiveSheetMeta(null);
          setSheetRows([]);
        }
        setStatusNotice(`Moved "${item.name}" to Google Drive Trash.`);
        await fetchDriveFiles();
      },
    });
  };

  // Write imported Drive/Sheets content into Cloned Workspace
  const writeContentIntoWorkspace = async (relPath: string, content: string) => {
    const res = await apiFetch(`/api/workspaces/${workspace.id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, content }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Failed to write ${relPath} into workspace.`);
    }
    await onRefreshWorkspace();
    setStatusNotice(`Imported "${relPath}" into cloned workspace.`);
  };

  // Import File from Google Drive into Cloned Workspace
  const handleImportDriveFileToWorkspace = async (item: GoogleDriveFileItem) => {
    if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
      await openSpreadsheetById(item.id);
      return;
    }
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      setTargetDriveFolderId(item.id);
      setStatusNotice(`Selected "${item.name}" as target Google Drive export folder.`);
      return;
    }

    const token = await ensureValidToken();
    if (!token) return;

    setImportingFileId(item.id);
    setErrorMsg(null);
    try {
      let downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        item.id
      )}?alt=media`;
      let targetFileName = item.name.replace(/[^a-zA-Z0-9._-]/g, '_');

      if (item.mimeType === 'application/vnd.google-apps.document') {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          item.id
        )}/export?mimeType=text/markdown`;
        if (!targetFileName.endsWith('.md')) targetFileName += '.md';
      } else if (item.mimeType.startsWith('application/vnd.google-apps.')) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          item.id
        )}/export?mimeType=text/plain`;
        if (!targetFileName.endsWith('.txt')) targetFileName += '.txt';
      }

      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Unable to download "${item.name}" (${res.status}): ${txt.slice(0, 160)}`);
      }

      const textContent = await res.text();
      const targetRelPath = workspace.targetSubPath
        ? `${workspace.targetSubPath}/${targetFileName}`
        : targetFileName;

      const existsAlready = workspace.files.some((f) => f.path === targetRelPath);
      if (existsAlready) {
        setPendingConfirm({
          kind: 'overwrite-workspace-file',
          title: `Overwrite "${targetRelPath}" in cloned workspace?`,
          description: `A file already exists at "${targetRelPath}". Confirming will replace its workspace contents with "${item.name}" from Google Drive.`,
          confirmLabel: 'Overwrite Workspace File',
          destructive: true,
          onConfirm: async () => {
            await writeContentIntoWorkspace(targetRelPath, textContent);
            onOpenFileInEditor(targetRelPath);
          },
        });
      } else {
        await writeContentIntoWorkspace(targetRelPath, textContent);
        onOpenFileInEditor(targetRelPath);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import file from Google Drive.');
    } finally {
      setImportingFileId(null);
    }
  };

  // Append Workspace Telemetry Row to Active Sheet Tab (Mutating -> Mandatory Confirmation Dialog)
  const requestAppendWorkspaceRowToSheet = () => {
    if (!activeSheetMeta || !selectedTabTitle) return;

    const rowValues: Array<string | number> = [
      new Date().toISOString(),
      `${workspace.owner}/${workspace.repoName}`,
      workspace.branch || 'main',
      workspace.commitShort || 'head',
      workspace.framework,
      workspace.status,
      workspace.totalFiles,
      workspace.totalBytes,
      workspace.buildDurationMs ?? 0,
      workspace.smokeProbe?.overallStatus || 'not-run',
    ];

    setPendingConfirm({
      kind: 'append-workspace-row',
      title: `Append workspace build row to "${activeSheetMeta.title}" (${selectedTabTitle})?`,
      description: `This will append 1 new row for ${workspace.owner}/${workspace.repoName}@${workspace.branch} (${workspace.commitShort}) to tab "${selectedTabTitle}" in your Google Sheet.`,
      confirmLabel: 'Append Row to Sheet',
      onConfirm: async () => {
        const token = await ensureValidToken();
        if (!token) return;
        const range = formatSheetTabRange(selectedTabTitle, 'A1');
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            activeSheetMeta.spreadsheetId
          )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [rowValues],
            }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Failed to append row (${res.status}): ${txt.slice(0, 180)}`);
        }
        setStatusNotice(
          `Appended workspace telemetry row to "${activeSheetMeta.title}" → ${selectedTabTitle}.`
        );
        await loadSheetTabValues(activeSheetMeta.spreadsheetId, selectedTabTitle);
      },
    });
  };

  // Append Custom CSV Row to Active Sheet Tab (Mutating -> Mandatory Confirmation Dialog)
  const handleRequestAppendCustomRow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSheetMeta || !selectedTabTitle || !customRowInput.trim()) return;
    const cells = customRowInput.split(',').map((c) => c.trim());

    setPendingConfirm({
      kind: 'append-custom-row',
      title: `Append ${cells.length} cell(s) to "${activeSheetMeta.title}" (${selectedTabTitle})?`,
      description: `Values to append: [${cells.join(' | ')}] into tab "${selectedTabTitle}".`,
      confirmLabel: 'Confirm Append Row',
      onConfirm: async () => {
        const token = await ensureValidToken();
        if (!token) return;
        const range = formatSheetTabRange(selectedTabTitle, 'A1');
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            activeSheetMeta.spreadsheetId
          )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [cells] }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Failed to append custom row (${res.status}): ${txt.slice(0, 180)}`);
        }
        setCustomRowInput('');
        setStatusNotice(`Appended new row to "${selectedTabTitle}".`);
        await loadSheetTabValues(activeSheetMeta.spreadsheetId, selectedTabTitle);
      },
    });
  };

  // Update Single Cell in Google Sheet (Mutating -> Mandatory Confirmation Dialog)
  const handleRequestSaveCellEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSheetMeta || !selectedTabTitle || !editingCell) return;
    const { a1Ref, currentValue, draftValue } = editingCell;

    setPendingConfirm({
      kind: 'update-sheet-cell',
      title: `Update cell ${a1Ref} in "${activeSheetMeta.title}" (${selectedTabTitle})?`,
      description: `Replace existing value "${currentValue || '(empty)'}" with "${
        draftValue || '(empty)'
      }" in Google Sheets.`,
      confirmLabel: 'Update Cell in Google Sheets',
      onConfirm: async () => {
        const token = await ensureValidToken();
        if (!token) return;
        const fullRange = formatSheetTabRange(selectedTabTitle, a1Ref);
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            activeSheetMeta.spreadsheetId
          )}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [[draftValue]],
            }),
          }
        );
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Failed to update cell ${a1Ref} (${res.status}): ${txt.slice(0, 180)}`);
        }
        setEditingCell(null);
        setStatusNotice(`Updated ${selectedTabTitle}!${a1Ref} in Google Sheets.`);
        await loadSheetTabValues(activeSheetMeta.spreadsheetId, selectedTabTitle);
      },
    });
  };

  // Save Active Sheet Tab into Cloned Workspace as CSV or JSON
  const handleSaveSheetTabToWorkspace = async (format: 'csv' | 'json') => {
    if (!activeSheetMeta || !selectedTabTitle || sheetRows.length === 0) return;

    const safeSlug = selectedTabTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sheet';
    const relPath = workspace.targetSubPath
      ? `${workspace.targetSubPath}/data/${safeSlug}.${format}`
      : `data/${safeSlug}.${format}`;

    let serialized = '';
    if (format === 'csv') {
      serialized =
        sheetRows
          .map((row) =>
            row
              .map((cell) => {
                const str = String(cell ?? '');
                return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
              })
              .join(',')
          )
          .join('\n') + '\n';
    } else {
      const [headers = [], ...bodyRows] = sheetRows;
      const objects = bodyRows.map((r) => {
        const item: Record<string, string> = {};
        headers.forEach((h, idx) => {
          const key = h?.trim() || `col_${idx + 1}`;
          item[key] = r[idx] ?? '';
        });
        return item;
      });
      serialized = JSON.stringify(objects, null, 2) + '\n';
    }

    const existsAlready = workspace.files.some((f) => f.path === relPath);
    if (existsAlready) {
      setPendingConfirm({
        kind: 'overwrite-workspace-file',
        title: `Overwrite "${relPath}" in workspace?`,
        description: `Replace existing file "${relPath}" with ${sheetRows.length} row(s) exported from "${activeSheetMeta.title}" (${selectedTabTitle}).`,
        confirmLabel: 'Overwrite File',
        destructive: true,
        onConfirm: async () => {
          setSavingSheetToRepo(true);
          try {
            await writeContentIntoWorkspace(relPath, serialized);
            onOpenFileInEditor(relPath);
          } finally {
            setSavingSheetToRepo(false);
          }
        },
      });
      return;
    }

    setSavingSheetToRepo(true);
    try {
      await writeContentIntoWorkspace(relPath, serialized);
      onOpenFileInEditor(relPath);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save sheet tab to workspace.');
    } finally {
      setSavingSheetToRepo(false);
    }
  };

  const executeConfirmedAction = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    setErrorMsg(null);
    try {
      await pendingConfirm.onConfirm();
      setPendingConfirm(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Operation failed.');
      setPendingConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const maxGridCols = useMemo(() => {
    let max = 0;
    for (const r of sheetRows) {
      if (r.length > max) max = r.length;
    }
    return Math.min(Math.max(max, 4), 16);
  }, [sheetRows]);

  return (
    <div className="space-y-8">
      {/* Top Google Workspace Connection & Status Header */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <HardDrive className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>Google Drive &amp; Google Sheets Integration</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {workspace.owner}/{workspace.repoName}@{workspace.branch}
              </span>
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Google Drive Archive Sync &amp; Google Sheets Telemetry Studio
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-3xl">
              Export full repository folders and 4-tab dependency/build audit spreadsheets, browse Drive files to import into your cloned repo, or inspect and update live Google Sheets tabs.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {needsAuth ? (
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void handleGoogleLogin(false)}
                className="h-10 px-4 rounded border bg-[#FFFFFF] border-[#DADCE0] text-[#3C4043] text-sm font-medium inline-flex items-center gap-2.5 shadow-2xs hover:bg-[#F8F9FA] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {signingIn ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                ) : (
                  <OfficialGoogleGMark />
                )}
                <span>Sign in with Google</span>
              </button>
            ) : (
              <>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-52">
                  {authUser?.email || 'Connected to Google Workspace'}
                </span>
                <button
                  type="button"
                  disabled={loadingDrive}
                  onClick={() => void fetchDriveFiles()}
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDrive ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleGoogleLogin(true)}
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Switch Account</span>
                </button>
                <button
                  type="button"
                  onClick={() => void signOutFirebase()}
                  title="Disconnect Google Workspace"
                  className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mandatory User Confirmation Dialog for Mutating / Destructive Operations */}
        {pendingConfirm && (
          <div
            role="alertdialog"
            aria-labelledby="ws-confirm-title"
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs ${
              pendingConfirm.destructive
                ? 'border-rose-300 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-950/35 text-rose-900 dark:text-rose-100'
                : 'border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/35 text-amber-900 dark:text-amber-100'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  pendingConfirm.destructive
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              />
              <div className="space-y-1">
                <div id="ws-confirm-title" className="font-bold">
                  {pendingConfirm.title}
                </div>
                <p className="leading-relaxed opacity-90">{pendingConfirm.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setPendingConfirm(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => void executeConfirmedAction()}
                className={`h-8 px-3.5 rounded-md text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                  pendingConfirm.destructive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-orange-500 hover:bg-orange-600'
                }`}
              >
                {confirmBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{pendingConfirm.confirmLabel}</span>
              </button>
            </div>
          </div>
        )}

        {statusNotice && (
          <div className="p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{statusNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="font-semibold hover:underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="font-semibold hover:underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Prompt Sign-In Gate when unauthenticated */}
      {needsAuth ? (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl p-10 text-center space-y-4 shadow-2xs">
          <div className="w-12 h-12 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div className="max-w-lg mx-auto space-y-1.5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Connect Google Drive &amp; Google Sheets
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Sign in with your Google account to browse Drive folders, mirror cloned GitHub repositories into Drive, export 4-tab dependency &amp; build audit spreadsheets, and inspect or edit live Google Sheets tabs.
            </p>
          </div>
          <div className="pt-1">
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void handleGoogleLogin(false)}
              className="h-10 px-5 rounded border bg-[#FFFFFF] border-[#DADCE0] text-[#3C4043] text-sm font-medium inline-flex items-center gap-2.5 shadow-2xs hover:bg-[#F8F9FA] transition-colors cursor-pointer disabled:opacity-60"
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
              ) : (
                <OfficialGoogleGMark />
              )}
              <span>Sign in with Google</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Row 1: Dual Workspace Exporters (Google Drive Folder + Google Sheets 4-Tab Audit) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Card: Export Full Project to Google Drive */}
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl p-5 space-y-4 shadow-2xs flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <FolderPlus className="w-4 h-4 text-orange-500 shrink-0" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    1. Export Repository Folder to Google Drive
                  </h2>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Creates a Drive folder with the full <code className="font-mono">.tar.gz</code> archive, JSON inspection manifest, synthesized README/workflows, and mirrored source files.
                </p>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Drive Folder Name
                  </label>
                  <input
                    type="text"
                    value={exportFolderName}
                    onChange={(e) => setExportFolderName(e.target.value)}
                    disabled={exportingDrive}
                    className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  disabled={exportingDrive}
                  onClick={handleDriveExportClick}
                  className="w-full h-10 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  {exportingDrive ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Uploading Repository to Google Drive...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4" />
                      <span>Upload Full Project to Google Drive</span>
                    </>
                  )}
                </button>

                {driveExportResult && (
                  <div className="p-3 rounded-xl border border-emerald-300 dark:border-emerald-700/50 bg-emerald-50/70 dark:bg-emerald-950/25 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono tabular-nums text-emerald-900 dark:text-emerald-200 truncate">
                      {driveExportResult.uploadedFilesCount} files ({formatBytes(driveExportResult.totalBytesUploaded)})
                    </span>
                    <a
                      href={driveExportResult.folderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <span>Open Folder</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Right Card: Export 4-Tab Repository Audit to Google Sheets */}
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl p-5 space-y-4 shadow-2xs flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    2. Export 4-Tab Repository Audit to Google Sheets
                  </h2>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Generates a structured Google Spreadsheet with frozen headers across <strong>Workspace Overview</strong>, <strong>Dependencies</strong> ({workspace.dependencies.length}), <strong>Languages &amp; Env</strong>, and <strong>Smoke Probe &amp; Artifacts</strong>.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Spreadsheet Title
                    </label>
                    <input
                      type="text"
                      value={exportSheetTitle}
                      onChange={(e) => setExportSheetTitle(e.target.value)}
                      disabled={exportingSheet}
                      className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Destination Drive Folder (Optional)
                    </label>
                    <select
                      value={targetDriveFolderId}
                      onChange={(e) => setTargetDriveFolderId(e.target.value)}
                      disabled={exportingSheet}
                      className="w-full h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    >
                      <option value="">My Drive (Root)</option>
                      {driveFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  disabled={exportingSheet}
                  onClick={() => void handleExportAuditToSheets()}
                  className="w-full h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  {exportingSheet ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating 4-Tab Google Sheet...</span>
                    </>
                  ) : (
                    <>
                      <Table className="w-4 h-4" />
                      <span>Create Audit Workbook in Google Sheets</span>
                    </>
                  )}
                </button>

                {sheetExportResult && (
                  <div className="p-3 rounded-xl border border-emerald-300 dark:border-emerald-700/50 bg-emerald-50/70 dark:bg-emerald-950/25 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono tabular-nums text-emerald-900 dark:text-emerald-200 truncate">
                      {sheetExportResult.totalRowsWritten} rows · 4 tabs written
                    </span>
                    <a
                      href={sheetExportResult.spreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <span>Open in Google Sheets</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Two-Column Explorer (Left: Google Drive Browser | Right: Live Google Sheets Inspector & Editor) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (5 cols): Google Drive Browser & Workspace Importer */}
            <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-2xs">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Google Drive Explorer ({driveFiles.length})
                  </h2>
                  <button
                    type="button"
                    disabled={loadingDrive}
                    onClick={() => void fetchDriveFiles()}
                    className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingDrive ? 'animate-spin' : ''}`} />
                    <span>Sync List</span>
                  </button>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs font-semibold">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'folders', label: 'Folders' },
                      { id: 'sheets', label: 'Sheets' },
                      { id: 'code', label: 'Files' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDriveFilter(t.id)}
                      className={`flex-1 py-1 px-2 rounded-md transition-colors cursor-pointer ${
                        driveFilter === t.id
                          ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={driveSearch}
                    onChange={(e) => setDriveSearch(e.target.value)}
                    placeholder="Search Google Drive files or folders..."
                    className="w-full h-8 pl-8 pr-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* Create New Drive Folder Form */}
                <form onSubmit={handleCreateDriveFolder} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newDriveFolderName}
                    onChange={(e) => setNewDriveFolderName(e.target.value)}
                    placeholder="New Google Drive folder name..."
                    className="flex-1 h-8 px-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="submit"
                    disabled={creatingFolder || !newDriveFolderName.trim()}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {creatingFolder ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                    )}
                    <span>New Folder</span>
                  </button>
                </form>
              </div>

              <div className="max-h-[540px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
                {loadingDrive && driveFiles.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-600" />
                    <span>Loading files from Google Drive...</span>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No matching files found in your Google Drive.
                  </div>
                ) : (
                  driveFiles.map((item) => {
                    const isFolder = item.mimeType === 'application/vnd.google-apps.folder';
                    const isSheet = item.mimeType === 'application/vnd.google-apps.spreadsheet';
                    const isSelectedSheet = activeSheetMeta?.spreadsheetId === item.id;

                    return (
                      <div
                        key={item.id}
                        className={`px-4 py-3 flex items-center justify-between gap-3 text-xs transition-colors ${
                          isSelectedSheet
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          {isFolder ? (
                            <Folder className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          ) : isSheet ? (
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <FileText className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
                          )}

                          <div className="min-w-0 flex-1">
                            <div
                              className="font-semibold text-slate-900 dark:text-slate-100 truncate"
                              title={item.name}
                            >
                              {item.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                              {isFolder
                                ? 'Drive Folder'
                                : isSheet
                                ? 'Google Sheet'
                                : item.size
                                ? formatBytes(Number(item.size))
                                : item.mimeType.replace('application/vnd.google-apps.', 'google-')}
                              {item.modifiedTime
                                ? ` · ${new Date(item.modifiedTime).toLocaleDateString()}`
                                : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isSheet ? (
                            <button
                              type="button"
                              onClick={() => void openSpreadsheetById(item.id)}
                              className="h-7 px-2.5 rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 font-semibold cursor-pointer whitespace-nowrap"
                            >
                              Inspect Sheet
                            </button>
                          ) : isFolder ? (
                            <button
                              type="button"
                              onClick={() => void handleImportDriveFileToWorkspace(item)}
                              className={`h-7 px-2.5 rounded-md border font-semibold cursor-pointer whitespace-nowrap ${
                                targetDriveFolderId === item.id
                                  ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {targetDriveFolderId === item.id ? 'Target Folder' : 'Use Folder'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={importingFileId === item.id}
                              onClick={() => void handleImportDriveFileToWorkspace(item)}
                              title="Import file into cloned workspace"
                              className="h-7 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              {importingFileId === item.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                              )}
                              <span>Import</span>
                            </button>
                          )}

                          {item.webViewLink && (
                            <a
                              href={item.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in Google Drive"
                              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => requestTrashDriveItem(item)}
                            title="Move to Google Drive Trash"
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column (7 cols): Live Google Sheets Inspector, Cell Editor & Release Tracker */}
            <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] rounded-2xl overflow-hidden shadow-2xs">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Google Sheets Live Inspector &amp; Release Row Logger
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Pick a spreadsheet from your Drive or paste any Google Sheets URL/ID to inspect tabs dynamically, edit cells, or append build audit rows.
                    </p>
                  </div>

                  {activeSheetMeta && (
                    <a
                      href={activeSheetMeta.spreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <span>Open in Sheets</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {/* Quick Spreadsheet Selector + Direct URL/ID Loader */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-5">
                    <select
                      value={activeSheetMeta?.spreadsheetId || ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          void openSpreadsheetById(e.target.value);
                        }
                      }}
                      aria-label="Select a Google Spreadsheet from Drive"
                      className="w-full h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    >
                      <option value="">
                        {driveSpreadsheets.length > 0
                          ? `Select from ${driveSpreadsheets.length} Drive Sheet(s)...`
                          : 'No spreadsheets in recent list'}
                      </option>
                      {driveSpreadsheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void openSpreadsheetById(spreadsheetInput);
                    }}
                    className="sm:col-span-7 flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={spreadsheetInput}
                      onChange={(e) => setSpreadsheetInput(e.target.value)}
                      placeholder="Paste Google Sheets URL or Spreadsheet ID..."
                      className="flex-1 h-9 px-3 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    />
                    <button
                      type="submit"
                      disabled={loadingSheet || !spreadsheetInput.trim()}
                      className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Load Sheet
                    </button>
                  </form>
                </div>
              </div>

              {!activeSheetMeta ? (
                <div className="p-12 text-center space-y-3 text-xs text-slate-500 dark:text-slate-400">
                  <Table className="w-6 h-6 text-emerald-600 dark:text-emerald-400 mx-auto" />
                  <div className="max-w-md mx-auto space-y-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      No Google Spreadsheet Loaded Yet
                    </p>
                    <p>
                      Click <strong>Create Audit Workbook in Google Sheets</strong> above to generate a fresh 4-tab repository report, or choose any existing spreadsheet from the dropdown.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {/* Dynamic Sheet Tab Switcher + Action Toolbar */}
                  <div className="px-5 py-3 bg-slate-50/70 dark:bg-[#0B0F17] flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        {activeSheetMeta.sheets.map((tab) => {
                          const isCurrent = tab.title === selectedTabTitle;
                          return (
                            <button
                              key={tab.sheetId}
                              type="button"
                              onClick={() => {
                                setSelectedTabTitle(tab.title);
                                void loadSheetTabValues(activeSheetMeta.spreadsheetId, tab.title);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                                isCurrent
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                              }`}
                            >
                              {tab.title}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={requestAppendWorkspaceRowToSheet}
                          className="h-8 px-3 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Log Build Row to Tab</span>
                        </button>

                        <button
                          type="button"
                          disabled={savingSheetToRepo || sheetRows.length === 0}
                          onClick={() => void handleSaveSheetTabToWorkspace('csv')}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <FileCode2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                          <span>Save .csv to Repo</span>
                        </button>

                        <button
                          type="button"
                          disabled={savingSheetToRepo || sheetRows.length === 0}
                          onClick={() => void handleSaveSheetTabToWorkspace('json')}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <FileCode2 className="w-3.5 h-3.5 text-orange-500" />
                          <span>Save .json to Repo</span>
                        </button>
                      </div>
                    </div>

                    {/* Selected Cell Inline Editor */}
                    {editingCell && (
                      <form
                        onSubmit={handleRequestSaveCellEdit}
                        className="p-3 rounded-xl border border-cyan-300 dark:border-cyan-700/60 bg-cyan-50/60 dark:bg-cyan-950/25 flex flex-col sm:flex-row sm:items-center gap-2.5 text-xs"
                      >
                        <div className="flex items-center gap-1.5 font-mono font-bold text-cyan-900 dark:text-cyan-200 shrink-0">
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>
                            {selectedTabTitle}!{editingCell.a1Ref}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editingCell.draftValue}
                          onChange={(e) =>
                            setEditingCell((prev) =>
                              prev ? { ...prev, draftValue: e.target.value } : null
                            )
                          }
                          className="flex-1 h-8 px-3 rounded-lg bg-white dark:bg-[#0B0F17] border border-cyan-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
                        />
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setEditingCell(null)}
                            className="h-8 px-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="h-8 px-3 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white font-semibold cursor-pointer"
                          >
                            Review Cell Update
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  {/* Spreadsheet Data Grid */}
                  <div className="max-h-[420px] overflow-auto">
                    {loadingSheet ? (
                      <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                        <span>Reading rows from {selectedTabTitle}...</span>
                      </div>
                    ) : sheetRows.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                        This tab has no populated cells yet. Use <strong>Log Build Row to Tab</strong> or append a row below.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-100 dark:bg-[#0E1420] text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-200 dark:border-slate-800 font-mono">
                          <tr>
                            <th className="py-2 px-3 w-10 text-center border-r border-slate-200 dark:border-slate-800">
                              #
                            </th>
                            {Array.from({ length: maxGridCols }).map((_, cIdx) => (
                              <th
                                key={cIdx}
                                className="py-2 px-3 font-semibold border-r border-slate-200/70 dark:border-slate-800/70 last:border-r-0"
                              >
                                {columnIndexToLetter(cIdx)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {sheetRows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={
                                rIdx === 0
                                  ? 'bg-slate-50/90 dark:bg-slate-800/50 font-semibold text-slate-900 dark:text-white'
                                  : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30 text-slate-700 dark:text-slate-300'
                              }
                            >
                              <td className="py-2 px-3 text-center font-mono tabular-nums text-[11px] text-slate-400 border-r border-slate-200 dark:border-slate-800">
                                {rIdx + 1}
                              </td>
                              {Array.from({ length: maxGridCols }).map((_, cIdx) => {
                                const cellVal = row[cIdx] ?? '';
                                const a1Ref = `${columnIndexToLetter(cIdx)}${rIdx + 1}`;
                                const isEditingThis = editingCell?.a1Ref === a1Ref;

                                return (
                                  <td
                                    key={cIdx}
                                    onClick={() =>
                                      setEditingCell({
                                        rowIdx: rIdx,
                                        colIdx: cIdx,
                                        a1Ref,
                                        currentValue: String(cellVal),
                                        draftValue: String(cellVal),
                                      })
                                    }
                                    title={`Click to edit ${selectedTabTitle}!${a1Ref}`}
                                    className={`py-2 px-3 font-mono border-r border-slate-100 dark:border-slate-800/60 last:border-r-0 max-w-56 truncate cursor-pointer transition-colors ${
                                      isEditingThis
                                        ? 'bg-cyan-100/70 dark:bg-cyan-900/40 text-cyan-950 dark:text-cyan-100'
                                        : 'hover:bg-cyan-50/50 dark:hover:bg-slate-800/60'
                                    }`}
                                  >
                                    {cellVal}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Custom Row Appender Footer */}
                  <form
                    onSubmit={handleRequestAppendCustomRow}
                    className="p-4 bg-slate-50/60 dark:bg-[#0B0F17] flex flex-col sm:flex-row sm:items-center gap-2.5"
                  >
                    <input
                      type="text"
                      value={customRowInput}
                      onChange={(e) => setCustomRowInput(e.target.value)}
                      placeholder={`Append comma-separated cells to "${selectedTabTitle}" (e.g. v1.2.0, Ready, Passed)...`}
                      className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-600"
                    />
                    <button
                      type="submit"
                      disabled={!customRowInput.trim()}
                      className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Append Row</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
