"use client";

import { useEffect } from "react";

/**
 * Form drafts that survive an expired session (R-038). While a form is open its values are
 * kept in sessionStorage; if the session expires the browser goes to sign-in and back, and
 * the form picks the draft up again. Drafts belong to the signed-in person: sign-in keeps
 * them only when the same email signs back in (see LoginForm).
 */
const PREFIX = "bc:draft:";
export const DRAFT_OWNER_KEY = "bc:draft-owner";

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, value: unknown) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: drafts are a convenience */
  }
}

export function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Keep `value` saved under `key` while `active` (debounced). */
export function useDraft(key: string, value: unknown, active: boolean) {
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(PREFIX + key, serialized);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key, serialized, active]);
}

/** Called by sign-in: drafts kept only if the same person signs back in. */
export function keepDraftsFor(email: string, clearEverythingElse: () => void) {
  let drafts: [string, string][] = [];
  try {
    const owner = sessionStorage.getItem(DRAFT_OWNER_KEY);
    if (owner && owner.toLowerCase() === email.trim().toLowerCase()) {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(PREFIX)) drafts.push([k, sessionStorage.getItem(k) ?? ""]);
      }
    }
  } catch {
    drafts = [];
  }
  clearEverythingElse();
  try {
    for (const [k, v] of drafts) sessionStorage.setItem(k, v);
    sessionStorage.setItem(DRAFT_OWNER_KEY, email.trim().toLowerCase());
  } catch {
    /* ignore */
  }
}
