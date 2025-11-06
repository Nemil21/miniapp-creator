'use client';
import { logger } from "../../lib/logger";


import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

interface Patch {
  id: string;
  projectId: string;
  patchData: {
    prompt: string;
    diffs: Array<{
      filename: string;
      oldContent: string;
      newContent: string;
      hunks: unknown[];
    }>;
    changedFiles: string[];
    timestamp: string;
  };
  description: string;
  appliedAt: string;
  revertedAt?: string;
}

interface PatchHistoryProps {
  projectId: string;
  onPatchSelect?: (patch: Patch) => void;
}

export function PatchHistory({ projectId, onPatchSelect }: PatchHistoryProps) {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);
  const [expandedPatchId, setExpandedPatchId] = useState<string | null>(null);
  const { sessionToken } = useAuthContext();

  const fetchPatches = useCallback(async () => {
    if (!sessionToken) {
      setError('Authentication required');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/patches`, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch patches: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setPatches(data.patches || []);
    } catch (err) {
      logger.error('Error fetching patches:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch patches');
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionToken]);

  useEffect(() => {
    if (projectId) {
      fetchPatches();
    }
  }, [projectId, fetchPatches]);

  const handleRevertPatch = async (patchId: string) => {
    if (!sessionToken) {
      alert('Authentication required');
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/patches`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ patchId, action: 'revert' }),
      });

      if (!response.ok) {
        throw new Error(`Failed to revert patch: ${response.status} ${response.statusText}`);
      }

      // Refresh patches
      await fetchPatches();
    } catch (err) {
      logger.error('Error reverting patch:', err);
      alert('Failed to revert patch');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    return date.toLocaleDateString();
  };

  const toggleExpand = (patchId: string) => {
    setExpandedPatchId(expandedPatchId === patchId ? null : patchId);
  };

  if (loading) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Loading patch history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  if (patches.length === 0) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        No changes yet. Make some edits to see the history here.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-200">Change History</h3>
        <p className="text-xs text-gray-400 mt-1">{patches.length} change{patches.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {patches.map((patch) => (
          <div
            key={patch.id}
            className={`border-b border-gray-700 hover:bg-gray-800/50 transition-colors ${
              selectedPatchId === patch.id ? 'bg-gray-800' : ''
            }`}
          >
            <div
              className="p-3 cursor-pointer"
              onClick={() => {
                setSelectedPatchId(patch.id);
                toggleExpand(patch.id);
                onPatchSelect?.(patch);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400">
                      {patch.id.substring(0, 8)}
                    </span>
                    {patch.revertedAt && (
                      <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                        Reverted
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-200 mt-1 truncate">
                    {patch.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {formatDate(patch.appliedAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {patch.patchData.changedFiles?.length || 0} file{patch.patchData.changedFiles?.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <button
                  className="text-gray-400 hover:text-gray-200 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(patch.id);
                  }}
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${
                      expandedPatchId === patch.id ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {expandedPatchId === patch.id && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  {/* User prompt */}
                  {patch.patchData.prompt && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 mb-1">Request:</p>
                      <p className="text-xs text-gray-200 bg-gray-900 p-2 rounded">
                        {patch.patchData.prompt}
                      </p>
                    </div>
                  )}

                  {/* Changed files list */}
                  <div className="mb-3">
                    <p className="text-xs text-gray-400 mb-1">Changed files:</p>
                    <ul className="space-y-1">
                      {patch.patchData.changedFiles?.map((file, idx) => (
                        <li key={idx} className="text-xs text-green-400 font-mono flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {file}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Action buttons */}
                  {!patch.revertedAt && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Are you sure you want to revert this change?')) {
                            handleRevertPatch(patch.id);
                          }
                        }}
                        className="text-xs px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded transition-colors"
                      >
                        Revert
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
