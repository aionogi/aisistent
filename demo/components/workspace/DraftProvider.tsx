"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearDraft, loadDraft, saveDraft } from "../../lib/workspace/storage";
import { createEmptyDraft } from "../../lib/workspace/templates";
import type { WorkspaceDraft } from "../../lib/workspace/types";

/**
 * `session`: kept in this tab's sessionStorage. `memory`: storage is blocked, so a reload loses the draft.
 * `server`: an organization's data, saved through the server (see OrganizationDraftProvider).
 */
export type StorageMode = "session" | "memory" | "server";
export type LoadNotice = "discarded" | null;

/** Server save progress; the demo stays `idle`. */
export type SaveState = {
  status: "idle" | "saving" | "saved" | "error" | "conflict" | "forbidden" | "signed-out" | "invalid";
  savedAt?: string | null;
  message?: string;
};

export type DraftContextValue = {
  draft: WorkspaceDraft;
  ready: boolean;
  /** Edits are ignored, for example for organization members without edit rights. */
  readOnly: boolean;
  saveState: SaveState;
  storageMode: StorageMode;
  loadNotice: LoadNotice;
  flash: string | null;
  dismissLoadNotice: () => void;
  setFlash: (message: string | null) => void;
  updateDraft: (recipe: (draft: WorkspaceDraft) => WorkspaceDraft) => void;
  replaceDraft: (draft: WorkspaceDraft) => void;
  resetDraft: () => void;
};

export const DraftContext = createContext<DraftContextValue | null>(null);

export const stamp = (draft: WorkspaceDraft): WorkspaceDraft => ({ ...draft, updatedAt: new Date().toISOString() });

const IDLE: SaveState = { status: "idle" };

/** Demo workspace: example data kept only in this browser tab. */
export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<WorkspaceDraft>(createEmptyDraft);
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("session");
  const [loadNotice, setLoadNotice] = useState<LoadNotice>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // sessionStorage exists only in the browser, so the draft is read after the prerendered HTML hydrates.
  useEffect(() => {
    const result = loadDraft();
    if (result.status === "loaded") setDraft(result.draft);
    if (result.status === "invalid") {
      clearDraft();
      setLoadNotice("discarded");
    }
    if (result.status === "unavailable") setStorageMode("memory");
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || storageMode !== "session") return;
    if (!saveDraft(draft)) setStorageMode("memory");
  }, [draft, ready, storageMode]);

  const updateDraft = useCallback((recipe: (draft: WorkspaceDraft) => WorkspaceDraft) => {
    setDraft((current) => stamp(recipe(current)));
  }, []);

  const replaceDraft = useCallback((next: WorkspaceDraft) => setDraft(stamp(next)), []);

  const resetDraft = useCallback(() => {
    clearDraft();
    setDraft(createEmptyDraft());
    setLoadNotice(null);
  }, []);

  const value = useMemo<DraftContextValue>(() => ({
    draft,
    ready,
    readOnly: false,
    saveState: IDLE,
    storageMode,
    loadNotice,
    flash,
    dismissLoadNotice: () => setLoadNotice(null),
    setFlash,
    updateDraft,
    replaceDraft,
    resetDraft,
  }), [draft, ready, storageMode, loadNotice, flash, updateDraft, replaceDraft, resetDraft]);

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftContextValue {
  const context = useContext(DraftContext);
  if (!context) throw new Error("useDraft must be used inside a draft provider.");
  return context;
}
