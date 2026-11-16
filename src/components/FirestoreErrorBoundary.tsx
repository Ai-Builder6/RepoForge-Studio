import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../lib/firebaseBridge';

interface FirestoreErrorBoundaryProps {
  children: React.ReactNode;
}

interface FirestoreErrorBoundaryState {
  hasError: boolean;
  rawMessage: string;
  parsedInfo: FirestoreErrorInfo | null;
}

export class FirestoreErrorBoundary extends React.Component<
  FirestoreErrorBoundaryProps,
  FirestoreErrorBoundaryState
> {
  public state: FirestoreErrorBoundaryState = {
    hasError: false,
    rawMessage: '',
    parsedInfo: null,
  };

  public static getDerivedStateFromError(error: unknown): FirestoreErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    let parsed: FirestoreErrorInfo | null = null;
    try {
      const candidate = JSON.parse(raw) as FirestoreErrorInfo;
      if (candidate && typeof candidate.error === 'string' && candidate.operationType) {
        parsed = candidate;
      }
    } catch {
      parsed = null;
    }

    return {
      hasError: true,
      rawMessage: raw,
      parsedInfo: parsed,
    };
  }

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { parsedInfo, rawMessage } = this.state;

    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-xl w-full border border-rose-300 dark:border-rose-600/50 bg-white dark:bg-[#111827] rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {parsedInfo ? 'Cloud Firestore Operation Blocked' : 'Application Error'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                {parsedInfo ? parsedInfo.error : rawMessage}
              </p>
            </div>
          </div>

          {parsedInfo && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1 text-slate-700 dark:text-slate-300">
              <div>Operation: {parsedInfo.operationType}</div>
              <div>Path: {parsedInfo.path || '(none)'}</div>
              <div>Signed In UID: {parsedInfo.authInfo.userId || 'unauthenticated'}</div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                this.setState({ hasError: false, rawMessage: '', parsedInfo: null })
              }
              className="h-9 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Dismiss &amp; Resume Studio</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
