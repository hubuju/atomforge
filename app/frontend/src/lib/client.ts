import { useCallback, useEffect, useState } from 'react';
import { http } from './http';

/** loading -> resolving token; authenticated -> ready; anonymous -> needs sign in. */
export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

const TOKEN_KEY = 'atomforge.token';

export interface AccountInfo {
  id: number;
  name: string;
}

/** One source file of a generated project — this is the real deliverable unit. */
export interface ProjectFile {
  path: string;
  content: string;
}

export interface WorkspaceRecord {
  id: number;
  name: string;
  description?: string;
  files: ProjectFile[];
  is_published?: boolean;
  share_slug?: string;
  version_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface MessageRecord {
  id: number;
  workspace_id: number;
  role: 'user' | 'assistant';
  content: string;
  kind?: string;
  created_at?: string;
}

export interface VersionRecord {
  id: number;
  workspace_id: number;
  version_no: number;
  files: ProjectFile[];
  summary?: string;
  /** Human-written label so a snapshot means something a week later. */
  note?: string;
  /** Serialized self-check result captured when the snapshot was taken. */
  audit?: string;
  created_at?: string;
}

export function loadToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — session lives for this page load only */
  }
}

/** Readable error text extracted from SDK / axios style failures. */
export function errorText(error: unknown, fallback = '操作失败，请重试'): string {
  const err = error as {
    data?: { detail?: string };
    response?: { data?: { detail?: string } };
    message?: string;
  };
  return err?.data?.detail || err?.response?.data?.detail || err?.message || fallback;
}

/** POST a hub route with the current session token attached. */
async function callHub<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  return http<T>(`/api/v1/hub${path}`, { data: { token: loadToken(), ...body } });
}

export const api = {
  async register(name: string, password: string) {
    return http<{ token: string; account: AccountInfo }>('/api/v1/hub/register', {
      data: { name, password },
    });
  },

  async login(name: string, password: string) {
    return http<{ token: string; account: AccountInfo }>('/api/v1/hub/login', {
      data: { name, password },
    });
  },

  me() {
    return callHub<AccountInfo>('/me');
  },

  /** One-tap anonymous entry: the backend mints a throwaway account. */
  guest() {
    return callHub<{ token: string; account: AccountInfo }>('/guest');
  },

  logout() {
    return callHub<{ ok: boolean }>('/logout');
  },

  async listWorkspaces() {
    const res = await callHub<{ items: WorkspaceRecord[] }>('/workspaces/list');
    return res?.items || [];
  },
  getWorkspace(id: number) {
    return callHub<WorkspaceRecord>('/workspaces/get', { id });
  },

  createWorkspace(data: { name: string; description?: string; files?: ProjectFile[] }) {
    return callHub<WorkspaceRecord>('/workspaces/create', data);
  },

  updateWorkspace(
    id: number,
    patch: { name?: string; description?: string; files?: ProjectFile[]; version_count?: number },
  ) {
    return callHub<WorkspaceRecord>('/workspaces/update', { id, ...patch });
  },

  deleteWorkspace(id: number) {
    return callHub<{ ok: boolean }>('/workspaces/delete', { id });
  },

  publishWorkspace(id: number) {
    return callHub<{ share_slug: string }>('/workspaces/publish', { id });
  },

  async listMessages(id: number) {
    const res = await callHub<{ items: MessageRecord[] }>('/messages/list', { id });
    return res?.items || [];
  },

  createMessage(data: {
    workspace_id: number;
    role: 'user' | 'assistant';
    content: string;
    kind?: string;
  }) {
    return callHub<MessageRecord>('/messages/create', data);
  },

  async listVersions(id: number) {
    const res = await callHub<{ items: VersionRecord[] }>('/versions/list', { id });
    return res?.items || [];
  },

  createVersion(data: {
    workspace_id: number;
    version_no: number;
    files: ProjectFile[];
    summary?: string;
    note?: string;
    audit?: string;
    /** Retention window; older unlabelled snapshots are pruned server-side. */
    keep_limit?: number;
  }) {
    return callHub<VersionRecord>('/versions/create', data);
  },

  updateVersionNote(id: number, note: string) {
    return callHub<VersionRecord>('/versions/note', { id, note });
  },

  async listTemplates() {
    const res = await callHub<{ items: TemplateRecord[] }>('/templates/list');
    return res?.items || [];
  },

  saveTemplate(data: {
    name: string;
    description?: string;
    keywords?: string;
    files: ProjectFile[];
    source_workspace_id?: number;
  }) {
    return callHub<TemplateRecord>('/templates/save', data);
  },

  useTemplate(id: number) {
    return callHub<TemplateRecord>('/templates/use', { id });
  },

  deleteTemplate(id: number) {
    return callHub<{ ok: boolean }>('/templates/delete', { id });
  },
};

/** A personal template saved from an existing project (T5). */
export interface TemplateRecord {
  id: number;
  name: string;
  description?: string;
  keywords?: string;
  files: ProjectFile[];
  source_workspace_id?: number;
  use_count?: number;
  created_at?: string;
}

export interface Session {
  status: SessionStatus;
  account: AccountInfo | null;
  signIn: (token: string, account: AccountInfo) => void;
  signOut: () => Promise<void>;
}

/**
 * Resolve the stored token once per mount. While `status === 'loading'` callers
 * must not treat the visitor as anonymous or redirect them away.
 */
export function useSession(): Session {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    let alive = true;
    if (!loadToken()) {
      setStatus('anonymous');
      return () => {
        alive = false;
      };
    }
    api
      .me()
      .then((info) => {
        if (!alive) return;
        if (info?.id) {
          setAccount(info);
          setStatus('authenticated');
        } else {
          saveToken('');
          setStatus('anonymous');
        }
      })
      .catch(() => {
        if (!alive) return;
        saveToken('');
        setStatus('anonymous');
      });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback((token: string, info: AccountInfo) => {
    saveToken(token);
    setAccount(info);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* token may already be invalid — clear locally regardless */
    }
    saveToken('');
    setAccount(null);
    setStatus('anonymous');
    window.location.href = '/auth';
  }, []);

  return { status, account, signIn, signOut };
}

export function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}