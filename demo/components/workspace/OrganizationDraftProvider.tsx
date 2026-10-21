"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SaveWorkspaceResult } from "../../lib/workspace/persistence";
import type { WorkspaceDraft } from "../../lib/workspace/types";
import { DraftContext, stamp, type DraftContextValue, type SaveState } from "./DraftProvider";


/** Debounce between the last edit and the save request. */
const SAVE_DELAY_MS = 700;

/**
 * Supplies the shared workspace screens with an organization's data. Edits
 * apply immediately in the browser and are saved to the server shortly after,
 * one request at a time. Knowledge entries created in the browser get their
 * server ids from the save response. A revision conflict stops saving until
 * the page is reloaded, so another person's changes are never overwritten.
 */
export default function OrganizationDraftProvider({ initialDraft, initialRevision, readOnly, save, children }: {
  initialDraft: WorkspaceDraft;
  initialRevision: number;
  readOnly: boolean;
  save: (draft: WorkspaceDraft, expectedRevision: number) => Promise<SaveWorkspaceResult>;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle", savedAt: initialDraft.updatedAt });
  const [flash, setFlash] = useState<string | null>(null);
  const draftRef = useRef(initialDraft);
  const revisionRef = useRef(initialRevision);
  const editVersion = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef(false);
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: WorkspaceDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const flush = useCallback(async () => {
    if (inFlight.current || stopped.current || savedVersion.current === editVersion.current) return;
    inFlight.current = true;
    const version = editVersion.current;
    setSaveState((current) => ({ ...current, status: "saving" }));
    let result: SaveWorkspaceResult;
    try {
      result = await save(draftRef.current, revisionRef.current);
    } catch {
      result = { status: "error" };
    }
    inFlight.current = false;

    if (result.status === "saved") {
      revisionRef.current = result.revision;
      savedVersion.current = version;
      const { idMap } = result;
      if (Object.keys(idMap).length) {
        commit({ ...draftRef.current, knowledge: draftRef.current.knowledge.map((entry) => (idMap[entry.id] ? { ...entry, id: idMap[entry.id] } : entry)) });
      }
      setSaveState({ status: "saved", savedAt: result.savedAt });
      // Edits made while this request was running are saved next.
      if (editVersion.current !== savedVersion.current) void flush();
      return;
    }
    if (result.status === "conflict" || result.status === "forbidden" || result.status === "signed-out") stopped.current = true;
    setSaveState({ status: result.status, message: result.status === "invalid" ? result.message : undefined });
  }, [commit, save]);

  const schedule = useCallback(() => {
    editVersion.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const updateDraft = useCallback((recipe: (draft: WorkspaceDraft) => WorkspaceDraft) => {
    if (readOnly) return;
    commit(stamp(recipe(draftRef.current)));
    schedule();
  }, [commit, readOnly, schedule]);

  const replaceDraft = useCallback((next: WorkspaceDraft) => {
    if (readOnly) return;
    commit(stamp(next));
    schedule();
  }, [commit, readOnly, schedule]);

  // Warn before leaving while changes are not yet on the server.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editVersion.current !== savedVersion.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const value = useMemo<DraftContextValue>(() => ({
    draft,
    ready: true,
    readOnly,
    saveState,
    storageMode: "server",
    loadNotice: null,
    flash,
    dismissLoadNotice: () => undefined,
    setFlash,
    updateDraft,
    replaceDraft,
    // Organizations are not reset from the editor.
    resetDraft: () => undefined,
  }), [draft, readOnly, saveState, flash, updateDraft, replaceDraft]);

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}
