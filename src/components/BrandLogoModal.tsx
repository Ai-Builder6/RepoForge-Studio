import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Github,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import brandEmblemUrl from '../assets/images/repoforge_brand_emblem_1794613955556.jpg';
import type { GitHubAuthStatus } from '../types';
import { apiFetch } from '../utils/api';

interface BrandLogoModalProps {
  isOpen: boolean;
  onClose: () => void;
  githubAuth?: GitHubAuthStatus | null;
  onConnectGitHub?: () => void;
}

export const REPOFORGE_SHORT_DESCRIPTION =
  'Clone, inspect, compile, and launch any public or private GitHub repository in seconds—complete with live previews, branch diffs, automated README & CI workflows, and Google Drive export.';

export const REPOFORGE_FULL_DESCRIPTION =
  'RepoForge Studio is an interactive GitHub repository workspace, compiler, and live sandbox launcher. Paste any public or private GitHub repository URL to shallow-clone and index its source tree, edit files and environment variables, run full production builds and backend API subprocesses, compare branches side-by-side, synthesize tailored README.md documentation and GitHub Actions CI/CD workflows, sync snapshots to Cloud Firestore, and export the complete project folder directly to Google Drive.';

export const REPOFORGE_TOPICS = [
  'repoforge-studio',
  'github-importer',
  'sandbox-builder',
  'branch-diff',
  'github-actions',
  'google-drive',
  'developer-tools',
];

const VECTOR_EMBLEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#FFFFFF"/>
  <path d="M32 6L55 19.2V44.8L32 58L9 44.8V19.2L32 6Z" fill="#F97316"/>
  <path d="M32 6L55 19.2L32 32L9 19.2L32 6Z" fill="#F59E0B"/>
  <path d="M32 32L55 19.2V44.8L32 58V32Z" fill="#06B6D4"/>
  <path d="M9 44.8L32 32V58L9 44.8Z" fill="#EA580C"/>
  <circle cx="24" cy="26" r="4" fill="#FFFFFF"/>
  <circle cx="40" cy="22" r="4" fill="#FFFFFF"/>
  <circle cx="32" cy="43" r="4" fill="#FFFFFF"/>
  <path d="M24 26V34C24 37.8 32 38 32 43M40 22V31.5C40 36 32 37.2 32 43" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/>
</svg>`;

function buildHorizontalLockupSvg(variant: 'light' | 'dark'): string {
  const bg = variant === 'light' ? '#FFFFFF' : '#0B0F17';
  const primaryText = variant === 'light' ? '#0F172A' : '#F8FAFC';
  const accentText = variant === 'light' ? '#EA580C' : '#FB923C';
  const borderStroke = variant === 'light' ? '#E2E8F0' : '#1E293B';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160" fill="none">
  <rect x="2" y="2" width="636" height="156" rx="24" fill="${bg}" stroke="${borderStroke}" stroke-width="4"/>
  <g transform="translate(36, 28) scale(1.625)">
    <path d="M32 6L55 19.2V44.8L32 58L9 44.8V19.2L32 6Z" fill="#F97316"/>
    <path d="M32 6L55 19.2L32 32L9 19.2L32 6Z" fill="#F59E0B"/>
    <path d="M32 32L55 19.2V44.8L32 58V32Z" fill="#06B6D4"/>
    <path d="M9 44.8L32 32V58L9 44.8Z" fill="#EA580C"/>
    <circle cx="24" cy="26" r="4" fill="#FFFFFF"/>
    <circle cx="40" cy="22" r="4" fill="#FFFFFF"/>
    <circle cx="32" cy="43" r="4" fill="#FFFFFF"/>
    <path d="M24 26V34C24 37.8 32 38 32 43M40 22V31.5C40 36 32 37.2 32 43" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/>
  </g>
  <text x="164" y="95" font-family="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif" font-size="46" font-weight="800" letter-spacing="-0.8" fill="${primaryText}">
    RepoForge <tspan fill="${accentText}">Studio</tspan>
  </text>
</svg>`;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const BrandLogoModal: React.FC<BrandLogoModalProps> = ({
  isOpen,
  onClose,
  githubAuth,
  onConnectGitHub,
}) => {
  const [downloadedKey, setDownloadedKey] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [renderingPng, setRenderingPng] = useState(false);
  const [previewImgFailed, setPreviewImgFailed] = useState(false);

  // Direct GitHub Repo Description Sync State
  const [targetGithubRepo, setTargetGithubRepo] = useState('');
  const [customGithubDesc, setCustomGithubDesc] = useState(REPOFORGE_SHORT_DESCRIPTION);
  const [pushingToGitHub, setPushingToGitHub] = useState(false);
  const [githubSyncNotice, setGithubSyncNotice] = useState<string | null>(null);
  const [githubSyncError, setGithubSyncError] = useState<string | null>(null);

  if (!isOpen) return null;

  const markDownloaded = (key: string) => {
    setDownloadedKey(key);
    setTimeout(() => {
      setDownloadedKey((prev) => (prev === key ? null : prev));
    }, 2200);
  };

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(key);
      setTimeout(() => {
        setCopiedField((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const handlePushDescriptionToGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    setGithubSyncNotice(null);
    setGithubSyncError(null);

    if (!githubAuth?.connected) {
      if (onConnectGitHub) {
        onConnectGitHub();
      } else {
        setGithubSyncError('Connect your GitHub account first to push repository metadata.');
      }
      return;
    }

    const cleaned = targetGithubRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length < 2) {
      setGithubSyncError('Enter a valid GitHub repository in owner/repo format.');
      return;
    }

    setPushingToGitHub(true);
    try {
      const res = await apiFetch(`/api/github/repos/${parts[0]}/${parts[1]}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: customGithubDesc.trim(),
          homepage: window.location.origin,
          topics: REPOFORGE_TOPICS,
        }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        full_name?: string;
        error?: string;
      };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || 'Failed to update GitHub repository description.');
      }
      setGithubSyncNotice(
        `Updated description, homepage URL, and topics on github.com/${payload.full_name}.`
      );
    } catch (err) {
      setGithubSyncError(
        err instanceof Error ? err.message : 'Unable to push description to GitHub.'
      );
    } finally {
      setPushingToGitHub(false);
    }
  };

  const handleDownloadSvg = (svgContent: string, filename: string, key: string) => {
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobDownload(blob, filename);
    markDownloaded(key);
  };

  const handleDownloadHighResPng = async () => {
    setRenderingPng(true);
    try {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const drawFromUrl = (src: string): Promise<void> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            resolve();
          };
          img.onerror = () => reject(new Error('Image load failed'));
          img.src = src;
        });

      try {
        await drawFromUrl(brandEmblemUrl);
      } catch {
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          VECTOR_EMBLEM_SVG
        )}`;
        await drawFromUrl(svgDataUrl);
      }

      canvas.toBlob((blob) => {
        if (blob) {
          triggerBlobDownload(blob, 'repoforge-studio-logo-1024.png');
          markDownloaded('png-1024');
        }
        setRenderingPng(false);
      }, 'image/png');
    } catch {
      setRenderingPng(false);
    }
  };

  const handleDirectAssetDownload = async (assetUrl: string, filename: string, key: string) => {
    try {
      const res = await fetch(assetUrl);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      markDownloaded(key);
    } catch {
      const a = document.createElement('a');
      a.href = assetUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      markDownloaded(key);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brand-logo-modal-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <h2
              id="brand-logo-modal-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              RepoForge Studio — App Description, GitHub Sync &amp; Brand Logo Kit
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Section 1: Ready-to-Copy App Descriptions & One-Click GitHub Sync */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-slate-50/70 dark:bg-[#0B0F17] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  RepoForge Studio App Descriptions &amp; GitHub &ldquo;About&rdquo; Sync
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Copy either description for your repository, app store listing, or social card—or push it directly to GitHub.
                </p>
              </div>
            </div>

            {/* Short GitHub About Description */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Short GitHub Repository &ldquo;About&rdquo; Description ({customGithubDesc.length}/350 chars)
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyText(customGithubDesc, 'short-desc')}
                  className="h-7 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedField === 'short-desc' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Short Description</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                rows={2}
                maxLength={350}
                value={customGithubDesc}
                onChange={(e) => setCustomGithubDesc(e.target.value)}
                className="w-full p-3 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:border-orange-500"
              />
            </div>

            {/* Full App Overview Description */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Full Application Description (README &amp; Project Listing)
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyText(REPOFORGE_FULL_DESCRIPTION, 'full-desc')}
                  className="h-7 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedField === 'full-desc' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Full Description</span>
                    </>
                  )}
                </button>
              </div>
              <div className="p-3 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {REPOFORGE_FULL_DESCRIPTION}
              </div>
            </div>

            {/* Topics Line */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
              <div className="text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-800 dark:text-slate-200 mr-2">
                  Suggested GitHub Topics:
                </span>
                <span className="font-mono text-cyan-700 dark:text-cyan-400">
                  {REPOFORGE_TOPICS.join(' · ')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyText(REPOFORGE_TOPICS.join(', '), 'topics')}
                className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                {copiedField === 'topics' ? 'Copied topics' : 'Copy topics'}
              </button>
            </div>

            {/* Direct Push to GitHub Form */}
            <form
              onSubmit={(e) => void handlePushDescriptionToGitHub(e)}
              className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
            >
              <input
                type="text"
                value={targetGithubRepo}
                onChange={(e) => setTargetGithubRepo(e.target.value)}
                placeholder={
                  githubAuth?.user?.login
                    ? `${githubAuth.user.login}/repoforge-studio`
                    : 'owner/repoforge-studio (or paste GitHub repo URL)'
                }
                className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-orange-500"
              />
              <button
                type="submit"
                disabled={pushingToGitHub}
                className="h-9 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {pushingToGitHub ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Github className="w-3.5 h-3.5" />
                )}
                <span>
                  {githubAuth?.connected
                    ? 'Add Description to GitHub Repo'
                    : 'Connect GitHub to Push Description'}
                </span>
              </button>
            </form>

            {githubSyncNotice && (
              <div className="p-2.5 rounded-lg border border-emerald-300 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>{githubSyncNotice}</span>
              </div>
            )}

            {githubSyncError && (
              <div className="p-2.5 rounded-lg border border-rose-300 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300">
                {githubSyncError}
              </div>
            )}
          </div>

          {/* Section 2: Visual Previews on Light & Dark Surfaces */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-[#F8FAFC] p-5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl overflow-hidden border border-orange-200 bg-white shrink-0 flex items-center justify-center shadow-2xs">
                {!previewImgFailed ? (
                  <img
                    src={brandEmblemUrl}
                    alt="RepoForge Studio Emblem Light Preview"
                    referrerPolicy="no-referrer"
                    onError={() => setPreviewImgFailed(true)}
                    className="w-full h-full object-cover scale-105"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-orange-500" />
                )}
              </div>
              <div>
                <div className="text-base font-extrabold tracking-tight text-slate-900">
                  RepoForge <span className="text-orange-600">Studio</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Light Mode Lockup</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0B0F17] p-5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl overflow-hidden border border-slate-700 bg-slate-900 shrink-0 flex items-center justify-center">
                {!previewImgFailed ? (
                  <img
                    src={brandEmblemUrl}
                    alt="RepoForge Studio Emblem Dark Preview"
                    referrerPolicy="no-referrer"
                    onError={() => setPreviewImgFailed(true)}
                    className="w-full h-full object-cover scale-105"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-orange-400" />
                )}
              </div>
              <div>
                <div className="text-base font-extrabold tracking-tight text-white">
                  RepoForge <span className="text-orange-400">Studio</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Dark Mode Lockup</div>
              </div>
            </div>
          </div>

          {/* Section 3: Download Options List */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3.5 flex items-center justify-between gap-4 bg-white dark:bg-[#111827]">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  High-Resolution PNG Emblem (1024 × 1024)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Crisp rasterized PNG mark ideal for app stores, README headers, and social cards
                </div>
              </div>
              <button
                type="button"
                disabled={renderingPng}
                onClick={() => void handleDownloadHighResPng()}
                className="h-9 px-3.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {downloadedKey === 'png-1024' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Downloaded</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>{renderingPng ? 'Rendering...' : 'Download .PNG'}</span>
                  </>
                )}
              </button>
            </div>

            <div className="px-4 py-3.5 flex items-center justify-between gap-4 bg-white dark:bg-[#111827]">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Scalable Vector Brand Emblem (.SVG)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Infinite-resolution geometric prism &amp; Git branch icon mark
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleDownloadSvg(VECTOR_EMBLEM_SVG, 'repoforge-studio-emblem.svg', 'svg-emblem')
                }
                className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {downloadedKey === 'svg-emblem' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Downloaded</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                    <span>Download .SVG</span>
                  </>
                )}
              </button>
            </div>

            <div className="px-4 py-3.5 flex items-center justify-between gap-4 bg-white dark:bg-[#111827]">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Full Wordmark Lockups — Light &amp; Dark (.SVG)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Horizontal emblem + RepoForge Studio wordmark banners
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadSvg(
                      buildHorizontalLockupSvg('light'),
                      'repoforge-studio-lockup-light.svg',
                      'svg-light'
                    )
                  }
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {downloadedKey === 'svg-light' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-orange-500" />
                  )}
                  <span>Light .SVG</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadSvg(
                      buildHorizontalLockupSvg('dark'),
                      'repoforge-studio-lockup-dark.svg',
                      'svg-dark'
                    )
                  }
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {downloadedKey === 'svg-dark' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  )}
                  <span>Dark .SVG</span>
                </button>
              </div>
            </div>

            <div className="px-4 py-3.5 flex items-center justify-between gap-4 bg-white dark:bg-[#111827]">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Original Studio Artwork (.JPG) &amp; App Favicon (.ICO)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Download original brand artwork image or browser favicon asset
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    void handleDirectAssetDownload(
                      brandEmblemUrl,
                      'repoforge-brand-emblem.jpg',
                      'raw-jpg'
                    )
                  }
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {downloadedKey === 'raw-jpg' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-orange-500" />
                  )}
                  <span>Artwork .JPG</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleDirectAssetDownload('/favicon.ico', 'favicon.ico', 'favicon-ico')
                  }
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {downloadedKey === 'favicon-ico' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  )}
                  <span>Favicon .ICO</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
