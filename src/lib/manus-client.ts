/* eslint-disable @typescript-eslint/no-explicit-any */
export interface User {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Session {
  user: User;
  access_token?: string;
  [key: string]: unknown;
}

type ClientResult<T = unknown> = { data: T; error: { message: string; code?: string } | null; count?: number };

type Filter = { column: string; operator: string; value: unknown };

class QueryBuilder<T = any> implements PromiseLike<ClientResult<T>> {
  private readonly table: string;
  private operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private columns = '*';
  private payload: unknown;
  private filters: Filter[] = [];
  private orderBy?: { column: string; ascending: boolean };
  private limitValue?: number;
  private offsetValue?: number;
  private wantsSingle = false;
  private wantsMaybeSingle = false;
  private returnsRows = false;

  constructor(table: string) { this.table = table; }

  select(columns = '*', _options?: unknown): this {
    this.columns = columns;
    if (this.operation !== 'select') this.returnsRows = true;
    return this;
  }
  eq(column: string, value: unknown): this { this.filters.push({ column, operator: 'eq', value }); return this; }
  neq(column: string, value: unknown): this { this.filters.push({ column, operator: 'neq', value }); return this; }
  gt(column: string, value: unknown): this { this.filters.push({ column, operator: 'gt', value }); return this; }
  gte(column: string, value: unknown): this { this.filters.push({ column, operator: 'gte', value }); return this; }
  lt(column: string, value: unknown): this { this.filters.push({ column, operator: 'lt', value }); return this; }
  lte(column: string, value: unknown): this { this.filters.push({ column, operator: 'lte', value }); return this; }
  like(column: string, value: string): this { this.filters.push({ column, operator: 'like', value }); return this; }
  ilike(column: string, value: string): this { this.filters.push({ column, operator: 'ilike', value }); return this; }
  in(column: string, value: unknown[]): this { this.filters.push({ column, operator: 'in', value }); return this; }
  is(column: string, value: unknown): this { this.filters.push({ column, operator: 'is', value }); return this; }
  not(column: string, operator: string, value: unknown): this { this.filters.push({ column, operator, value }); return this; }
  or(value: string): this { this.filters.push({ column: '__or', operator: 'raw', value }); return this; }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orderBy = { column, ascending: options.ascending !== false };
    return this;
  }
  limit(value: number): this { this.limitValue = value; return this; }
  range(from: number, to: number): this { this.offsetValue = from; this.limitValue = Math.max(0, to - from + 1); return this; }
  single(): this { this.wantsSingle = true; return this; }
  maybeSingle(): this { this.wantsMaybeSingle = true; return this; }
  insert(payload: unknown): this { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: unknown): this { this.operation = 'update'; this.payload = payload; return this; }
  upsert(payload: unknown, options?: { onConflict?: string }): this {
    this.operation = 'upsert'; this.payload = payload;
    if (options?.onConflict) this.filters.push({ column: '__onConflict', operator: 'conflict', value: options.onConflict });
    return this;
  }
  delete(): this { this.operation = 'delete'; return this; }

  then<TResult1 = ClientResult<T>, TResult2 = never>(
    onfulfilled?: ((value: ClientResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const request = fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        table: this.table,
        operation: this.operation,
        columns: this.columns,
        payload: this.payload,
        filters: this.filters,
        order: this.orderBy,
        limit: this.limitValue,
        offset: this.offsetValue,
        single: this.wantsSingle,
        maybeSingle: this.wantsMaybeSingle,
        returnsRows: this.returnsRows,
      }),
    }).then(async response => {
      const body = await response.json().catch(() => ({ error: 'Invalid server response' }));
      if (!response.ok) return { data: null as T, error: { message: body.error || 'Database request failed' } };
      return body as ClientResult<T>;
    });
    return request.then(onfulfilled || undefined, onrejected || undefined);
  }
}

class AuthClient {
  private listeners = new Set<(event: string, session: Session | null) => void>();
  private session: Session | null = null;

  private notify(event: string, session: Session | null) {
    this.session = session;
    this.listeners.forEach(listener => listener(event, session));
  }

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    this.listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => { this.listeners.delete(callback); } } } };
  }

  async getSession(): Promise<{ data: { session: Session | null }; error: null }> {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      const body = await response.json();
      this.session = body.session || null;
    } catch { this.session = null; }
    return { data: { session: this.session }, error: null };
  }

  async signInWithPassword(credentials: { email: string; password: string }) {
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(credentials),
    });
    const body = await response.json().catch(() => ({}));
    const error = response.ok ? null : new Error(body.error || 'Unable to sign in');
    if (!error) this.notify('SIGNED_IN', body.session);
    return { data: { session: body.session || null }, error };
  }

  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, unknown>; emailRedirectTo?: string } }) {
    const response = await fetch('/api/auth/sign-up', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ email, password, fullName: options?.data?.full_name }),
    });
    const body = await response.json().catch(() => ({}));
    const error = response.ok ? null : new Error(body.error || 'Unable to sign up');
    if (!error) this.notify('SIGNED_IN', body.session);
    return { data: { session: body.session || null, user: body.user || null }, error };
  }

  async signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    this.notify('SIGNED_OUT', null);
    return { error: null };
  }
}

class StorageClient {
  from(bucket: string) {
    return {
      upload: async (path: string, file: Blob, options?: { upsert?: boolean; contentType?: string; cacheControl?: string }) => {
        const form = new FormData();
        form.append('file', file);
        form.append('bucket', bucket);
        form.append('path', path);
        form.append('upsert', String(Boolean(options?.upsert)));
        const response = await fetch('/api/storage', { method: 'POST', body: form, credentials: 'include' });
        const body = await response.json().catch(() => ({}));
        return { data: response.ok ? { path } : null, error: response.ok ? null : { message: body.error || 'Upload failed' } };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `/manus-storage/${bucket}/${path}` } }),
      remove: async (paths: string[]) => {
        const response = await fetch('/api/storage', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ bucket, paths }),
        });
        const body = await response.json().catch(() => ({}));
        return { data: response.ok ? body : null, error: response.ok ? null : { message: body.error || 'Delete failed' } };
      },
    };
  }
}

class FunctionClient {
  async invoke<T = any>(name: string, options: { body?: unknown; method?: string } = {}): Promise<ClientResult<T>> {
    const response = await fetch(`/api/functions/${encodeURIComponent(name)}`, {
      method: options.method || 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null as T, error: { message: body.error || 'Server function failed' } };
    return { data: body.data === undefined ? body : body.data, error: null };
  }
}

export const manus = {
  from: <T = any>(table: string) => new QueryBuilder<T>(table),
  auth: new AuthClient(),
  storage: new StorageClient(),
  functions: new FunctionClient(),
};

export type { ClientResult };
