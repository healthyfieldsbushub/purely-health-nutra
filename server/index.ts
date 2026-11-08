import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import mysql from 'mysql2/promise';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import Busboy from 'busboy';
import sharp from 'sharp';

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const distDir = path.join(root, 'dist');
const storageDir = path.join(root, '.runtime-storage');
const cookieName = 'webdev_app_session';
const sessionTtlSeconds = 60 * 60 * 24 * 30;
const providerRequestTimeoutMs = 35000;
const pool = process.env.DATABASE_URL ? mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 }) : null;
let schemaReady: Promise<void> | null = null;

const json = (res: http.ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

const readBody = async (req: http.IncomingMessage, limit = 2 * 1024 * 1024): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > limit) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const readJson = async (req: http.IncomingMessage) => {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new Error('Request body must be valid JSON'); }
};

const safeTable = (table: string) => /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(table) && table !== 'schema_migrations';
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

type AppRecord = { id: string; [key: string]: any };
type Filter = { column: string; operator: string; value: unknown };

async function ensureSchema() {
  if (!pool) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS app_records (
        table_name VARCHAR(64) NOT NULL,
        record_id VARCHAR(64) NOT NULL,
        data_json JSON NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (table_name, record_id),
        INDEX idx_app_records_table_updated (table_name, updated_at)
      )`);
      await pool.query(`INSERT IGNORE INTO schema_migrations (version) VALUES ('0001_manus_records')`);
    })().catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

async function allRecords(table: string): Promise<AppRecord[]> {
  if (!pool) return [];
  await ensureSchema();
  const [rows] = await pool.query('SELECT record_id, data_json FROM app_records WHERE table_name = ?', [table]);
  return (rows as any[]).map(row => {
    const data = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json;
    return { id: row.record_id, ...(data || {}) };
  });
}

const valueAt = (row: AppRecord, column: string) => column.split('.').reduce((value, key) => value == null ? undefined : value[key], row as any);
const compare = (actual: any, operator: string, expected: any) => {
  if (operator === 'eq') return actual === expected || String(actual) === String(expected);
  if (operator === 'neq') return actual !== expected && String(actual) !== String(expected);
  if (operator === 'is') return expected === 'null' ? actual == null : actual === expected;
  if (operator === 'in') return Array.isArray(expected) && expected.some(item => String(item) === String(actual));
  if (operator === 'gt') return actual > expected;
  if (operator === 'gte') return actual >= expected;
  if (operator === 'lt') return actual < expected;
  if (operator === 'lte') return actual <= expected;
  if (operator === 'like' || operator === 'ilike') {
    const escaped = String(expected).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${escaped}$`, operator === 'ilike' ? 'i' : '').test(String(actual ?? ''));
  }
  return true;
};

function filterRows(rows: AppRecord[], filters: Filter[] = []) {
  return rows.filter(row => filters.filter(filter => filter.column !== '__or' && filter.column !== '__onConflict').every(filter => compare(valueAt(row, filter.column), filter.operator, filter.value)));
}

async function projectRows(rows: AppRecord[], columns: string) {
  if (!columns || columns === '*' || columns.includes('(*)')) return rows;
  const requested = columns.split(',').map(column => column.trim()).filter(Boolean).filter(column => !column.includes('('));
  if (!requested.length || requested.includes('*')) {
    // A leading "*" means every column; relation selects (e.g. categories(name, slug))
    // are resolved on top of the full row.
    // Split on top-level commas only — a relation like "categories(name, slug)"
    // contains an inner comma that must not split the token.
    const parts: string[] = [];
    let depth = 0, buf = '';
    for (const ch of columns) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; } else { buf += ch; }
    }
    if (buf.trim()) parts.push(buf.trim());
    const relations = parts.filter(c => /^[a-z_]+\([^)]*\)$/i.test(c));
    if (!relations.length) return rows;
    const enriched = rows.map(row => ({ ...row }));
    for (const rel of relations) {
      const m = rel.match(/^([a-z_]+)\(([^)]*)\)$/i);
      if (!m) continue;
      const relTable = m[1].toLowerCase();
      const fields = m[2].split(',').map(s => s.trim()).filter(Boolean);
      if (relTable === 'categories') {
        const cats = await allRecords('categories');
        const byId = new Map(cats.map((c: any) => [c.id, fields.length ? Object.fromEntries(fields.map(f => [f, (c as any)[f]])) : c]));
        for (const row of enriched) {
          (row as any).categories = (row as any).category_id ? byId.get((row as any).category_id) || null : null;
        }
      }
    }
    return enriched;
  }
  return rows.map(row => Object.fromEntries(requested.map(column => [column, valueAt(row, column)])));
}

async function saveRecord(table: string, row: AppRecord) {
  if (!pool) return row;
  await ensureSchema();
  const data = { ...row } as Record<string, any>;
  delete data.id;
  await pool.query(
    `INSERT INTO app_records (table_name, record_id, data_json) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), updated_at = CURRENT_TIMESTAMP(3)`,
    [table, row.id, JSON.stringify(data)],
  );
  return row;
}

async function deleteRecord(table: string, id: string) {
  if (pool) {
    await ensureSchema();
    await pool.query('DELETE FROM app_records WHERE table_name = ? AND record_id = ?', [table, id]);
  }
}

async function dataRequest(body: any) {
  const { table, operation = 'select', columns = '*', payload, filters = [], order, limit, offset = 0, single, maybeSingle, returnsRows } = body;
  if (!safeTable(table)) throw new Error('Invalid table name');
  let rows = await allRecords(table);
  if (operation === 'select') {
    rows = filterRows(rows, filters);
    if (order?.column) rows.sort((a, b) => {
      const av = valueAt(a, order.column); const bv = valueAt(b, order.column);
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
      return order.ascending === false ? -result : result;
    });
    const count = rows.length;
    if (offset) rows = rows.slice(Number(offset));
    if (limit !== undefined) rows = rows.slice(0, Number(limit));
    const projected = await projectRows(rows, columns);
    if (single || maybeSingle) {
      if (!projected.length) return { data: null, error: maybeSingle ? null : { message: 'No rows found' }, count };
      if (single && projected.length > 1) return { data: null, error: { message: 'Multiple rows found' }, count };
      return { data: projected[0], error: null, count };
    }
    return { data: projected, error: null, count };
  }
  if (operation === 'insert' || operation === 'upsert') {
    const inputRows = Array.isArray(payload) ? payload : [payload];
    const conflict = filters.find((filter: Filter) => filter.column === '__onConflict')?.value as string | undefined;
    const conflictColumns = conflict?.split(',').map(value => value.trim()).filter(Boolean) || [];
    const saved: AppRecord[] = [];
    for (const input of inputRows) {
      const candidate = { ...(input || {}) } as AppRecord;
      const existing = conflictColumns.length ? rows.find(row => conflictColumns.every(column => valueAt(row, column) === candidate[column])) : undefined;
      const row = { ...(existing || {}), ...candidate, id: existing?.id || candidate.id || newId(), created_at: existing?.created_at || candidate.created_at || now(), updated_at: now() };
      saved.push(await saveRecord(table, row));
    }
    return { data: returnsRows || columns !== '*' ? await projectRows(saved, columns) : saved, error: null };
  }
  if (operation === 'update') {
    const matches = filterRows(rows, filters);
    const saved: AppRecord[] = [];
    for (const row of matches) saved.push(await saveRecord(table, { ...row, ...(payload || {}), updated_at: now() }));
    return { data: returnsRows ? await projectRows(saved, columns) : null, error: null };
  }
  if (operation === 'delete') {
    const matches = filterRows(rows, filters);
    for (const row of matches) await deleteRecord(table, row.id);
    return { data: returnsRows ? matches : null, error: null };
  }
  throw new Error('Unsupported data operation');
}

function parseCookies(req: http.IncomingMessage) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(item => item.trim().split('=' as any)).filter(pair => pair.length === 2).map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]));
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password: string, stored: string) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function publicUser(row: AppRecord): UserLike {
  return { id: row.id, email: row.email, user_metadata: { full_name: row.full_name || null, address: row.address || null, city: row.city || null, postal_code: row.postal_code || null } };
}
type UserLike = { id: string; email?: string; user_metadata?: Record<string, unknown> };

async function findUserById(id: string) { return (await allRecords('auth_users')).find(row => row.id === id); }
async function bootstrapAdminUser() {
  // Keep the durable bootstrap secret as the preferred source, while supporting
  // the older admin secret names already configured on this project.
  const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.ADMIN_PANEL_PASSWORD || '').trim();
  if (!pool || !password) return;

  const configuredEmail = String(process.env.ADMIN_EMAIL || process.env.ADMIN_PANEL_USERNAME || '').trim().toLowerCase();
  const email = configuredEmail.includes('@') ? configuredEmail : 'admin@proagrisa.co.za';
  const users = await allRecords('auth_users');
  let user = users.find(row => row.email === email);
  if (!user) {
    user = { id: newId(), email, password_hash: hashPassword(password), full_name: 'Purely Health Nutra Admin', created_at: now() };
    await saveRecord('auth_users', user);
  } else if (!verifyPassword(password, String(user.password_hash || ''))) {
    // A database rotation can preserve the user row but lose the matching
    // credential. Re-align only this bootstrap account with the server secret.
    user = { ...user, password_hash: hashPassword(password), updated_at: now() };
    await saveRecord('auth_users', user);
  }

  const roles = await allRecords('user_roles');
  if (!roles.some(row => row.user_id === user?.id && row.role === 'admin')) {
    await saveRecord('user_roles', { id: newId(), user_id: user.id, role: 'admin', created_at: now() });
  }
}

async function currentUser(req: http.IncomingMessage) {
  const token = parseCookies(req)[cookieName];
  if (!token) return null;
  const session = (await allRecords('auth_sessions')).find(row => row.id === token && new Date(row.expires_at).getTime() > Date.now());
  return session ? findUserById(session.user_id) : null;
}
async function createSession(user: AppRecord) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  await saveRecord('auth_sessions', { id: sessionId, user_id: user.id, expires_at: new Date(Date.now() + sessionTtlSeconds * 1000).toISOString() });
  return { id: sessionId, user: publicUser(user), access_token: sessionId };
}
function sessionCookie(value: string, maxAge = sessionTtlSeconds) { return `${cookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=None; Secure`; }

async function authRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    const user = await currentUser(req);
    return json(res, 200, { session: user ? await createSession(user) : null });
  }
  if (pathname === '/api/auth/sign-out' && req.method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  if ((pathname === '/api/auth/sign-in' || pathname === '/api/auth/sign-up') && req.method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || password.length < 8) return json(res, 400, { error: 'A valid email and password of at least 8 characters are required' });
    let user = (await allRecords('auth_users')).find(row => row.email === email);
    if (pathname.endsWith('sign-up')) {
      if (user) return json(res, 409, { error: 'An account with this email already exists' });
      user = {
        id: newId(), email, password_hash: hashPassword(password), full_name: body.fullName || null,
        address: String(body.address || '').trim() || null,
        city: String(body.city || '').trim() || null,
        postal_code: String(body.postalCode || '').trim() || null,
        created_at: now(),
      };
      await saveRecord('auth_users', user);
    } else if (!user || !verifyPassword(password, user.password_hash)) {
      return json(res, 401, { error: 'Invalid email or password' });
    }
    const session = await createSession(user);
    return json(res, 200, { user: session.user, session }, { 'Set-Cookie': sessionCookie(session.id) });
  }
  return false;
}

async function getPaymentSettings() {
  const rows = await allRecords('payment_settings');
  const stored = rows.find(row => row.id === 'default') || ({} as any);
  return {
    payfast_enabled: stored.payfast_enabled !== false,
    yoco_enabled: stored.yoco_enabled !== false,
    paypal_enabled: stored.paypal_enabled !== false,
    paypal_usd_rate: Number.isFinite(Number(stored.paypal_usd_rate)) && Number(stored.paypal_usd_rate) > 0 ? Number(stored.paypal_usd_rate) : 18.5,
  };
}
async function paymentConfig() {
  const configured = (keys: string[]) => keys.every(key => Boolean(process.env[key]));
  const mode = (key: string, fallback: string) => String(process.env[key] || fallback).trim().toLowerCase();
  const settings = await getPaymentSettings();
  return {
    payfast: { configured: configured(['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE']), enabled: settings.payfast_enabled, mode: mode('PAYFAST_MODE', 'sandbox'), required: ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE'] },
    yoco: { configured: Boolean(String(process.env.YOCO_SECRET_KEY || process.env.YOCO_LIVE_SECRET_KEY || '').trim()), enabled: settings.yoco_enabled, mode: mode('YOCO_MODE', 'test'), required: ['YOCO_SECRET_KEY (or YOCO_LIVE_SECRET_KEY)'] },
    paypal: { configured: configured(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']), enabled: settings.paypal_enabled, mode: mode('PAYPAL_MODE', 'sandbox'), required: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'], zarSupported: false, usdRate: settings.paypal_usd_rate },
    courierGuy: { configured: Boolean(process.env.COURIER_GUY_API_KEY || process.env.THE_COURIER_GUY_API), mode: mode('COURIER_GUY_MODE', 'live'), required: ['THE_COURIER_GUY_API', 'TCG_COLLECTION_ADDRESS_JSON'] },
    pudo: { configured: Boolean(process.env.PUDO_API_KEY || process.env.PUDO_SHIPPING_API), mode: mode('PUDO_MODE', 'live'), required: ['PUDO_SHIPPING_API'] },
  };
}

function payfastSignature(fields: Record<string, string>, passphrase?: string) {
  const encoded = Object.entries(fields).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`).join('&');
  return crypto.createHash('md5').update(passphrase ? `${encoded}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}` : encoded).digest('hex');
}
async function recalcOrderTotal(orderIdOrNumber: string) {
  const orders = await allRecords('orders');
  const order = orders.find((o: any) => String(o.id) === String(orderIdOrNumber) || String(o.order_number) === String(orderIdOrNumber));
  if (!order) throw new Error('Order not found for payment initiation');
  const orderItems = (await allRecords('order_items')).filter((item: any) => item.order_id === order.id);
  const subtotal = orderItems.reduce((sum: number, item: any) => sum + Number(item.unit_price_zar || 0) * Math.max(1, Number(item.quantity || 1)), 0);
  const shipping = Number(order.shipping_cost_zar || 0);
  const discount = Number(order.coupon_discount_zar || 0);
  return Math.max(0, Math.round((subtotal + shipping - discount) * 100) / 100);
}

async function initiatePayFast(body: any) {
  const settings = await getPaymentSettings();
  if (!settings.payfast_enabled) throw new Error('PayFast is currently disabled in admin settings');
  // Stored secrets can carry stray whitespace; PayFast requires an exact 13-character merchant key.
  // PayFast merchant IDs and keys are strictly alphanumeric; strip any paste artifacts
  // (spaces, newlines, quotes) that secret storage may have captured.
  const payfastMerchantId = String(process.env.PAYFAST_MERCHANT_ID || '').replace(/[^0-9]/g, '');
  const payfastMerchantKey = String(process.env.PAYFAST_MERCHANT_KEY || '').replace(/[^a-zA-Z0-9]/g, '');
  const payfastPassphrase = String(process.env.PAYFAST_PASSPHRASE || process.env.PAYFAST_SECURITY_PASSPHRASE || '').trim();
  if (!payfastMerchantId || !payfastMerchantKey || !payfastPassphrase) throw new Error('PayFast is not fully configured in Manus secrets');
  // Recalculate the total server-side from the order record; never trust browser amounts.
  const serverTotal = await recalcOrderTotal(body.orderId);
  const origin = String(body.origin || (() => {
    try { return new URL(String(body.returnUrl || '')).origin; } catch { return ''; }
  })());
  const fields: Record<string, string> = {
    merchant_id: payfastMerchantId,
    merchant_key: payfastMerchantKey,
    return_url: String(body.returnUrl || ''),
    cancel_url: String(body.cancelUrl || ''),
    notify_url: `${origin}/api/webhooks/payfast`,
    name_first: String(body.customerName || '').split(' ')[0] || 'Customer',
    email_address: String(body.customerEmail || ''),
    m_payment_id: String(body.orderId || ''),
    amount: serverTotal.toFixed(2),
    item_name: String(body.itemName || 'Purely Health Nutra order'),
  };
  fields.signature = payfastSignature(fields, payfastPassphrase);
  console.log(`[payfast] merchant_key length after sanitise: ${payfastMerchantKey.length}`);
  return { success: true, actionUrl: String(process.env.PAYFAST_MODE || 'sandbox').trim().toLowerCase() === 'live' ? 'https://www.payfast.co.za/eng/process' : 'https://sandbox.payfast.co.za/eng/process', formFields: fields };
}

async function initiateYoco(body: any) {
  const settings = await getPaymentSettings();
  if (!settings.yoco_enabled) throw new Error('Yoco is currently disabled in admin settings');
  const secretKey = String(process.env.YOCO_SECRET_KEY || process.env.YOCO_LIVE_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('Yoco is not configured in Manus secrets');
  const serverTotal = await recalcOrderTotal(body.orderId);
  const endpoint = 'https://payments.yoco.com/api/checkouts';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': String(body.orderId || newId()),
    },
    signal: AbortSignal.timeout(providerRequestTimeoutMs),
    body: JSON.stringify({
      amount: Math.round(serverTotal * 100),
      currency: body.currency || 'ZAR',
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      failureUrl: body.failureUrl || body.cancelUrl,
      metadata: { orderId: String(body.orderId || ''), customerEmail: String(body.customerEmail || '') },
      externalId: String(body.orderId || ''),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProviderError('Yoco', `Yoco checkout creation failed: ${String(result.message || result.reason || result.error || 'upstream request rejected').slice(0, 300)}`, response.status === 401 || response.status === 403 ? 424 : 422, response.status);
  return { success: true, redirectUrl: result.redirectUrl || result.redirect_url, checkoutId: result.id };
}

async function paypalToken() {
  const preferred = String(process.env.PAYPAL_MODE || 'sandbox').trim().toLowerCase() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const alternate = preferred === 'https://api-m.paypal.com' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  let base = preferred;
  let response = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(providerRequestTimeoutMs), body: 'grant_type=client_credentials' });
  // The credentials may be live keys while PAYFAST-style mode defaults to sandbox; try the other API host once.
  if (!response.ok) {
    base = alternate;
    response = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(providerRequestTimeoutMs), body: 'grant_type=client_credentials' });
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProviderError('PayPal', `PayPal authentication failed: ${String(result.error_description || result.error || 'invalid credentials').slice(0, 300)}`, response.status === 401 || response.status === 403 ? 424 : 422, response.status);
  return { base, token: result.access_token };
}

async function initiatePayPal(body: any) {
  const settings = await getPaymentSettings();
  if (!settings.paypal_enabled) throw new Error('PayPal is currently disabled in admin settings');
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal is not configured in Manus secrets');
  const { base, token } = await paypalToken();
  const serverTotal = await recalcOrderTotal(body.orderId);
  // PayPal does not accept ZAR directly. If currency is ZAR, convert to USD.
  let currencyCode = String(body.currency || 'USD').toUpperCase();
  let amountVal = Number(body.amount || 0);
  if (currencyCode === 'ZAR') {
    currencyCode = 'USD';
    const settings = await getPaymentSettings();
    const rate = settings.paypal_usd_rate;
    amountVal = Math.max(1, Math.round((amountVal / rate) * 100) / 100);
  }
  const response = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': String(body.orderId || newId())
    },
    signal: AbortSignal.timeout(providerRequestTimeoutMs),
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(body.orderId || ''),
        custom_id: String(body.orderId || '').slice(0, 127),
        description: String(body.itemName || 'Purely Health Nutra order').slice(0, 127),
        amount: {
          currency_code: currencyCode,
          value: amountVal.toFixed(2)
        }
      }],
      application_context: {
        return_url: body.successUrl,
        cancel_url: body.cancelUrl,
        user_action: 'PAY_NOW'
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detailMsg = JSON.stringify(result.details || result);
    throw new ProviderError('PayPal', `PayPal order creation failed: ${detailMsg.slice(0, 400)}`, response.status === 401 || response.status === 403 ? 424 : 422, response.status);
  }
  return {
    success: true,
    orderId: result.id,
    approvalUrl: result.links?.find((link: any) => link.rel === 'approve')?.href,
    status: result.status,
    convertedCurrency: currencyCode,
    convertedAmount: amountVal
  };
}

async function createGuestOrder(body: any) {
  const items = Array.isArray(body.items) ? body.items : [];
  const address = body.shippingAddress || {};
  if (!items.length) throw new Error('Cart is empty');
  if (!String(address.name || '').trim() || !String(address.email || '').trim() || !String(address.address || '').trim() || !String(address.postalCode || '').trim()) {
    throw new Error('Complete the required shipping details before placing the order');
  }

  const orderId = newId();
  const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const accessToken = newId();
  // Recalculate each unit price from the database and apply the 40cm (+R70)
  // cutting-size delta server-side. Never trust prices sent from the browser.
  const productRows = await allRecords('products');
  const productById = new Map(productRows.map((p: any) => [String(p.id), p]));
  const sizedItems = items.map((item: any) => {
    const product: any = productById.get(String(item.productId || ''));
    const dbPrice = Number(product?.price_zar || 0);
    const largeDelta = String(item.size || '') === 'large' ? 70 : 0;
    const unitPrice = Math.max(Number(item.unitPrice || 0), dbPrice) + largeDelta;
    return { ...item, unitPrice };
  });
  const subtotal = sizedItems.reduce((sum: number, item: any) => sum + Number(item.unitPrice || 0) * Math.max(1, Number(item.quantity || 1)), 0);
  // Always recalculate shipping on the server; never trust a price sent from the browser.
  let shippingCost = Number(body.shippingCost || 0);
  let chosenRate: any = null;
  try {
    const parcel = await cartParcel(items);
    const destination = {
      ...address,
      country: address.country || 'South Africa',
      province: address.province || '',
    };
    const quote = await shippingRates({
      weight: parcel.billableWeight,
      billableWeight: parcel.billableWeight,
      dimensions: parcel.dimensions,
      destinationAddress: destination,
      destinationPostalCode: address.postalCode || '',
      pudoLockerId: body.pudoLockerId || '',
      provider: 'all',
      subtotal,
    });
    const key = String(body.shippingOptionKey || '');
    chosenRate = (key ? quote.rates.find((rate: any) => rate.id === key) : null) || quote.rates[0] || null;
    if (chosenRate) shippingCost = Number(chosenRate.price || 0);
  } catch (error) {
    // Server quoting failed entirely; keep the requested cost as a last resort so checkout is not blocked.
  }
  // Recompute the rooting service cost server-side (1-10 plants: R30, 150+: R5, 600+: R2.50).
  const rootedUnits = sizedItems.filter((item: any) => item.includeRooting).reduce((s: number, item: any) => s + Math.max(1, Number(item.quantity || 1)), 0);
  const rootingPerUnit = rootedUnits >= 600 ? 2.5 : rootedUnits >= 150 ? 5 : 30;
  const rootingCost = rootedUnits > 0 ? rootedUnits * rootingPerUnit : 0;
  const discount = Number(body.couponDiscount || 0);
  const total = Math.max(0, subtotal + shippingCost + rootingCost - discount);

  await saveRecord('orders', {
    id: orderId,
    order_number: orderNumber,
    access_token: accessToken,
    guest_email: String(address.email).trim().toLowerCase(),
    shipping_address: address,
    billing_address: address,
    shipping_method: String(chosenRate?.service || body.shippingMethod || 'Standard'),
    shipping_cost_zar: shippingCost,
    shipping_option: chosenRate ? { id: chosenRate.id, provider: chosenRate.provider, service: chosenRate.service, price: shippingCost, estimated_days: chosenRate.estimatedDays } : null,
    pudo_locker_id: body.pudoLockerId ? String(body.pudoLockerId) : null,
    customer_id: body.customerId ? String(body.customerId) : null,
    subtotal_zar: subtotal + rootingCost,
    discount_zar: discount,
    total_zar: total,
    status: 'pending',
    payment_status: 'pending',
    coupon_code: body.couponCode || null,
    coupon_discount_zar: discount,
    payment_method: body.paymentGateway || null,
    created_at: now(),
    updated_at: now(),
  });

  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity || 1));
    await saveRecord('order_items', {
      id: newId(),
      order_id: orderId,
      product_id: String(item.productId || ''),
      product_sku: String(item.productSku || ''),
      quantity,
      unit_price_zar: Number(item.unitPrice || 0),
      total_price_zar: Number(item.unitPrice || 0) * quantity,
      size: String(item.size || 'standard'),
      include_rooting: Boolean(item.includeRooting),
      // Invoice-visible option labels directly on the line item.
      product_name: String(item.productName || 'Product') + (String(item.size || '') === 'large' ? ' — 40cm cutting (350g-700g)' : '') + (item.includeRooting ? ' [Rooting service: 3-5 weeks]' : ''),
      created_at: now(),
    });
  }
  return { success: true, orderId, orderNumber };
}

function configured(keys: string[]) { return keys.every(key => Boolean(process.env[key])); }
function courierGuyApiKey() { return String(process.env.COURIER_GUY_API_KEY || process.env.THE_COURIER_GUY_API || '').trim(); }
function courierGuyBaseUrl() {
  const configured = String(process.env.COURIER_GUY_BASE_URL || '').replace(/\/+$/, '');
  if (!configured) return 'https://api.portal.thecourierguy.co.za';
  return configured;
}
function courierGuyAccountId() {
  const configured = Number(process.env.COURIER_GUY_ACCOUNT_ID || process.env.COURIER_GUY_ACCOUNT_CODE || 0);
  return Number.isFinite(configured) && configured > 0 ? configured : 83;
}
function pudoApiKey() { return String(process.env.PUDO_API_KEY || process.env.PUDO_SHIPPING_API || '').trim(); }
const lockerCache = new Map<string, { at: number; data: any[] }>();
function pudoBaseUrl() {
  const configured = String(process.env.PUDO_BASE_URL || '').replace(/\/+$/, '');
  if (!configured) return 'https://api-pudo.co.za';
  return configured;
}
function configuredJson(name: string) {
  const value = process.env[name];
  if (!value) return null;
  try { return JSON.parse(value); } catch { throw new Error(`${name} must contain valid JSON`); }
}
function checkoutAddress(input: any, fallbackCode = '') {
  const address = input || {};
  const street = address.street_address || address.address || '';
  const city = address.city || '';
  const suburb = address.suburb || city;
  const code = String(address.code || address.postalCode || fallbackCode || '');
  return {
    street_address: street,
    local_area: address.local_area || suburb,
    suburb,
    city,
    code,
    zone: address.zone || address.province || '',
    country: address.country || 'South Africa',
    entered_address: address.entered_address || [street, suburb, city, code, 'South Africa'].filter(Boolean).join(', '),
    type: address.type || 'residential',
    ...(address.company ? { company: address.company } : {}),
  };
}
function collectionAddress(provider: 'courier' | 'pudo', body: any) {
  const configuredAddress = provider === 'courier'
    ? (configuredJson('TCG_COLLECTION_ADDRESS_JSON') || configuredJson('COURIER_GUY_COLLECTION_ADDRESS_JSON'))
    : configuredJson('PUDO_COLLECTION_ADDRESS_JSON');
  const address = configuredAddress || body.collectionAddress;
  if (!address) throw new Error(`${provider === 'courier' ? 'Courier Guy' : 'PUDO'} collection address is not configured in Manus secrets`);
  return checkoutAddress(address);
}
function collectionContact(body: any) {
  const raw = process.env.TCG_COLLECTION_CONTACT_JSON;
  let contact: any = null;
  if (raw) {
    try { contact = JSON.parse(raw); } catch { contact = { name: raw }; }
  }
  const merged = { ...(body.collectionContact || {}), ...(contact || {}) };
  // PUDO requires an email or mobile number on the collection contact.
  if (!merged.email && !merged.mobile_number) {
    merged.email = body.deliveryContact?.email || process.env.PAYFAST_EMAIL || '';
    merged.mobile_number = body.deliveryContact?.mobile_number || '';
  }
  return Object.keys(merged).length ? merged : undefined;
}
function parcelFromBody(body: any) {
  const dimensions = body.dimensions || {};
  const numberOr = (value: unknown, fallback: number, minimum: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
  };
  return {
    submitted_length_cm: numberOr(dimensions.length, 30, 1),
    submitted_width_cm: numberOr(dimensions.width, 20, 1),
    submitted_height_cm: numberOr(dimensions.height, 15, 1),
    submitted_weight_kg: numberOr(body.weight, 0.5, 0.1),
    parcel_description: 'Purely Health Nutra order',
    alternative_tracking_reference: String(body.orderId || ''),
    packaging: String(body.packaging || 'Standard flyer'),
  };
}
// ---- Server-side SEO audit, search-engine submission and indexing tools ----
const SITE_ORIGIN = 'https://purelyhealthnutra.company';
const stripTags = (value: unknown) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function productKeywords(p: AppRecord): string[] {
  const raw = Array.isArray(p.keywords) ? p.keywords : Array.isArray(p.tags) ? p.tags : String(p.keywords || p.tags || '').split(',');
  return raw.map(k => String(k).trim()).filter(Boolean);
}

function seoScoreProduct(p: AppRecord) {
  const issues: string[] = [];
  let score = 100;
  const metaTitle = stripTags(p.meta_title);
  const metaDesc = stripTags(p.meta_description);
  const shortDesc = stripTags(p.short_description);
  const desc = stripTags(p.description);
  const keywords = productKeywords(p);
  const images = Array.isArray(p.images) ? p.images : p.image_url ? [p.image_url] : [];

  if (!metaTitle) { issues.push('Missing meta title — add one (30–60 characters)'); score -= 20; }
  else if (metaTitle.length < 30 || metaTitle.length > 60) { issues.push(`Meta title is ${metaTitle.length} chars — aim for 30–60`); score -= 8; }
  if (!metaDesc) { issues.push('Missing meta description — add one (70–160 characters)'); score -= 15; }
  else if (metaDesc.length < 70 || metaDesc.length > 160) { issues.push(`Meta description is ${metaDesc.length} chars — aim for 70–160`); score -= 6; }
  if (!shortDesc) { issues.push('Missing short description (max 160 characters)'); score -= 10; }
  else if (shortDesc.length > 160) { issues.push(`Short description is ${shortDesc.length} chars — trim to 160`); score -= 4; }
  if (desc.length < 200) { issues.push('Long description is thin — aim for 200+ characters of unique copy'); score -= 10; }
  if (keywords.length < 3) { issues.push(`Only ${keywords.length} keyword${keywords.length === 1 ? '' : 's'} — add at least 3 for search matching`); score -= 10; }
  if (!images.length) { issues.push('No product image — Google Shopping requires one'); score -= 15; }
  if (!p.slug) { issues.push('Missing URL slug'); score -= 10; }
  if (!p.sku) { issues.push('Missing SKU'); score -= 5; }
  if (!(Number(p.weight_kg) > 0)) { issues.push('Missing weight — required for live shipping rates'); score -= 5; }
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues, metaTitle, metaDesc, shortDesc, keywords, images, desc };
}

async function seoAudit() {
  const products = (await allRecords('products')).filter(p => p.is_active !== false);
  const audits = products.map(p => {
    const audit = seoScoreProduct(p);
    return {
      id: String(p.id), name: String(p.name || ''), slug: String(p.slug || ''),
      meta_title: audit.metaTitle || null, meta_title_length: audit.metaTitle.length,
      meta_description: audit.metaDesc || null, meta_description_length: audit.metaDesc.length,
      tags_count: audit.keywords.length, issues: audit.issues, score: audit.score,
    };
  });
  const scores = audits.map(a => a.score);
  return {
    products: audits,
    summary: {
      total: audits.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      needsOptimization: audits.filter(a => a.score < 80).length,
      optimized: audits.filter(a => a.score >= 80).length,
    },
    generated_at: now(),
  };
}

function autoMetaForProduct(p: AppRecord) {
  const brand = String(p.brand || 'Purely Health Nutra');
  const name = stripTags(p.name).slice(0, 44);
  let metaTitle = stripTags(p.meta_title);
  if (!metaTitle) metaTitle = `${name} | ${brand}`.slice(0, 60);
  let metaDesc = stripTags(p.meta_description);
  if (!metaDesc) {
    const source = stripTags(p.short_description) || stripTags(p.description);
    if (source) metaDesc = source.length > 157 ? `${source.slice(0, 157).replace(/\s+\S*$/, '')}…` : source;
  }
  let keywords = productKeywords(p);
  if (keywords.length < 3) {
    const stop = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'our', 'are', 'all', 'this', 'that', 'use', 'per', 'can', 'has', 'have', 'will', 'each', 'into', 'more', 'when', 'how', 'why', 'what']);
    const freq = new Map<string, number>();
    for (const token of `${stripTags(p.name)} ${stripTags(p.description).slice(0, 400)}`.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
      if (token.length < 4 || stop.has(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    const derived = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word);
    keywords = [...new Set([...keywords, ...derived, 'gut health', 'south africa'])].slice(0, 10);
  }
  return { metaTitle, metaDesc, keywords };
}

async function seoOptimizeProduct(productId: string) {
  const product = (await allRecords('products')).find(p => String(p.id) === String(productId));
  if (!product) throw new Error('Product not found');
  const auto = autoMetaForProduct(product);
  const updates: AppRecord = { ...product, updated_at: now() };
  if (!stripTags(product.meta_title)) updates.meta_title = auto.metaTitle;
  if (!stripTags(product.meta_description)) updates.meta_description = auto.metaDesc;
  if (productKeywords(product).length < 3) updates.keywords = auto.keywords;
  await saveRecord('products', updates);
  return { optimized: { id: String(product.id), name: String(product.name || ''), meta_title: updates.meta_title, meta_description: updates.meta_description, keywords: updates.keywords || productKeywords(product) } };
}

async function seoOptimizeBulk(productIds: unknown) {
  const ids = Array.isArray(productIds) ? productIds.map(String) : [];
  const results: any[] = [];
  for (const id of ids) {
    try { await seoOptimizeProduct(id); results.push({ id, success: true }); }
    catch (error: any) { results.push({ id, success: false, error: error?.message || 'optimization failed' }); }
  }
  return { results };
}

async function seoResearch(body: any) {
  const keyword = String(body.keyword || body.seed || '').trim();
  if (!keyword) throw new Error('Provide a keyword');
  const result = await serpApi('google', { q: keyword, num: '10' });
  const relatedKeywords: string[] = [];
  for (const item of result.related_searches || []) {
    const value = String(item.query || '').trim();
    if (value) relatedKeywords.push(value);
  }
  const questions: string[] = [];
  for (const item of result.people_also_ask || []) {
    const value = String(item.question || '').trim();
    if (value) questions.push(value);
  }
  const competitorTitles: string[] = [];
  const competitorSnippets: string[] = [];
  for (const item of result.organic_results || []) {
    if (item.title) competitorTitles.push(String(item.title));
    if (item.snippet) competitorSnippets.push(String(item.snippet));
  }
  return { relatedKeywords, questions, competitorTitles, competitorSnippets, retrieved_at: now() };
}

// AI-powered SEO copy generation for a product, grounded in live SerpAPI competitor data.
async function seoAiOptimizeProduct(body: any) {
  const products = await allRecords('products');
  const product = products.find(p => String(p.id) === String(String(body.productId || '')));
  if (!product) throw new Error('Product not found');
  const name = String(product.name || '').trim();
  if (!name) throw new Error('Product has no name');

  // Optional live search context for the target keyword.
  let searchContext = '';
  const keyword = String(body.keyword || name).trim();
  try {
    const serp = await serpApi('google', { q: `${keyword} south africa`, num: '10' });
    searchContext = (serp.organic_results || [])
      .slice(0, 6)
      .map((item: any, i: number) => `${i + 1}. ${item.title} — ${String(item.snippet || '').slice(0, 150)}`)
      .join('\n');
  } catch { /* SerpAPI is optional context */ }

  const audit = seoScoreProduct(product);
  const prompt = `You are the senior SEO copywriter for Purely Health Nutra, a South African gut-health and dragon fruit nursery store.
Write search-optimized listing content for this product.

Product name: ${name}
Current short description: ${audit.shortDesc || '(none)'}
Current description (first 800 chars): ${audit.desc.slice(0, 800)}
Category: ${String(product.category || 'uncategorised')} | Brand: ${String(product.brand || 'Purely Health Nutra')}

${searchContext ? `Live Google results for "${keyword} south africa" (for context on what ranks — do NOT copy them):\n${searchContext}` : ''}

Rules:
- Brand focus: gut health, live probiotic cultures, and rare dragon fruit cultivars.
- South African audience, English, no invented medical claims, no invented prices or stock.
- meta_title: max 60 characters, include the product name and a buying intent phrase.
- meta_description: 120-160 characters, benefit-led, ends with an action.
- short_description: max 160 characters.
- keywords: 8-12 comma-separated search phrases real buyers would type (include "south africa" and gut-health terms where natural).

Return ONLY valid JSON (no markdown fences) with keys: meta_title, meta_description, short_description, keywords (string).`;

  const gemini = await geminiChat([{ role: 'user', content: prompt }], { temperature: 0.5, maxOutputTokens: 900 });
  let parsed: any;
  try {
    const start = gemini.text.indexOf('{');
    const end = gemini.text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    parsed = JSON.parse(gemini.text.slice(start, end + 1));
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${gemini.text.slice(0, 120)}`);
  }

  const metaTitle = String(parsed.meta_title || '').trim().slice(0, 60);
  const metaDescription = String(parsed.meta_description || '').trim().slice(0, 160);
  const shortDescription = String(parsed.short_description || '').trim().slice(0, 160);
  const keywords = String(parsed.keywords || '').split(',').map((k: string) => k.trim()).filter(Boolean).slice(0, 12);
  const updates: AppRecord = { ...product, updated_at: now() };
  if (metaTitle) updates.meta_title = metaTitle;
  if (metaDescription) updates.meta_description = metaDescription;
  if (shortDescription) updates.short_description = shortDescription;
  if (keywords.length >= 3) updates.keywords = keywords;
  await saveRecord('products', updates);
  const refreshed = seoScoreProduct(updates);
  return { ai_generated: true, provider: gemini.provider, model: gemini.model, keyword_used: keyword, updates: { meta_title: metaTitle, meta_description: metaDescription, short_description: shortDescription, keywords }, new_score: refreshed.score, remaining_issues: refreshed.issues };
}

async function indexNowKey() {
  const settings = await allRecords('seo_settings');
  const stored = settings.find(row => row.id === 'indexnow');
  if (stored?.key) return String(stored.key);
  const key = crypto.randomBytes(16).toString('hex');
  await saveRecord('seo_settings', { id: 'indexnow', key, created_at: now(), updated_at: now() });
  return key;
}

async function indexNowSubmit(urls: string[]) {
  const key = await indexNowKey();
  const host = new URL(SITE_ORIGIN).host;
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    signal: AbortSignal.timeout(providerRequestTimeoutMs),
    body: JSON.stringify({ host, key, keyLocation: `${SITE_ORIGIN}/${key}.txt`, urlList: urls }),
  });
  return { status: response.ok || response.status === 202 ? 'success' : 'error', http: response.status, submitted: urls.length };
}

async function submitToSearchEngines(body: any) {
  const siteUrl = String(body.siteUrl || SITE_ORIGIN).replace(/\/+$/, '');
  let origin = SITE_ORIGIN;
  try { origin = new URL(siteUrl).origin; } catch { /* keep canonical origin */ }
  const sitemapUrl = `${origin}/sitemap.xml`;
  const submissions: any[] = [];
  // Google removed its sitemap ping endpoint; the Search Console API is the supported channel.
  try {
    const gsc = await gscApiSubmitSitemap(origin);
    if (!gsc.available) {
      submissions.push({ service: 'Google Search Console', status: 'manual', details: 'Paste the sitemap URL in Search Console → Sitemaps. Google has no public ping API.' });
    } else if (gsc.submitted) {
      submissions.push({ service: 'Google Search Console', status: 'success', details: `Sitemap submitted via the Search Console API (property ${gsc.siteUrl})` });
    } else {
      const first = (gsc.attempts || []).find((a: any) => !a.ok) || {};
      submissions.push({ service: 'Google Search Console', status: 'blocked', details: first.details || 'Service account could not submit the sitemap — grant Search Console access to the service account email.' });
    }
  } catch (error: any) {
    submissions.push({ service: 'Google Search Console', status: 'error', details: error?.message || 'Search Console API submission failed' });
  }
  try {
    const response = await fetch(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, { signal: AbortSignal.timeout(providerRequestTimeoutMs) });
    // Bing retired its ping endpoint (HTTP 410 Gone); IndexNow is its supported instant-submission channel.
    submissions.push(response.status === 410
      ? { service: 'Bing Webmaster', status: 'skipped', details: 'Bing removed its ping endpoint — covered by the IndexNow submission; also add the sitemap once in Bing Webmaster Tools.' }
      : { service: 'Bing Webmaster', status: response.ok ? 'success' : 'error', details: `HTTP ${response.status}` });
  } catch (error: any) {
    submissions.push({ service: 'Bing Webmaster', status: 'error', details: error?.message || 'Bing ping failed' });
  }
  try {
    const indexNow = await indexNowSubmit([`${origin}/`, sitemapUrl]);
    submissions.push({ service: 'IndexNow', status: indexNow.status, details: `HTTP ${indexNow.http} — submitted ${indexNow.submitted} URLs (Bing, Yandex, DuckDuckGo, Seznam, Yep)` });
  } catch (error: any) {
    submissions.push({ service: 'IndexNow', status: 'error', details: error?.message || 'IndexNow submission failed' });
  }
  try {
    const indexing = await googleIndexingSubmit([`${origin}/`, `${origin}/products`, sitemapUrl]);
    submissions.push(indexing.available
      ? { service: 'Google Indexing API', status: (indexing.submitted || 0) > 0 ? 'success' : 'blocked', details: `${indexing.submitted || 0} URL(s) queued for instant indexing`, results: indexing.results }
      : { service: 'Google Indexing API', status: 'skipped', details: indexing.details });
  } catch (error: any) {
    submissions.push({ service: 'Google Indexing API', status: 'error', details: error?.message || 'Indexing API submission failed' });
  }
  return { message: 'Search-engine submission run complete', submissions, submitted_at: now() };
}

async function gscPriorityIndexing() {
  const products = (await allRecords('products'))
    .filter(p => p.is_active !== false && p.slug)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const urls = [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/products`,
    `${SITE_ORIGIN}/kefir-grains`,
    `${SITE_ORIGIN}/kombucha`,
    `${SITE_ORIGIN}/blog`,
    ...products.slice(0, 4).map(p => `${SITE_ORIGIN}/product/${p.slug}`),
  ];
  let indexNow: { status: string; http: number; submitted?: number };
  try { indexNow = await indexNowSubmit(urls); }
  catch { indexNow = { status: 'error', http: 0 }; }
  const host = new URL(SITE_ORIGIN).host;
  const inspections: any[] = [];
  for (const url of urls) {
    let indexed = false;
    let error: string | null = null;
    try {
      const result = await serpApi('google', { q: `site:${url.replace(/^https?:\/\//, '')}`, num: '10' });
      indexed = (result.organic_results || []).some((item: any) => String(item.link || '').replace(/\/+$/, '') === url);
    } catch (e: any) {
      // SerpAPI returns "no results" when Google holds nothing for site:<url> — that is a real
      // not-indexed verdict, not a tool failure.
      if (/hasn't returned any results/i.test(String(e?.message || ''))) indexed = false;
      else error = e?.message || 'index check failed';
    }
    inspections.push({
      url,
      coverageState: error ? `Index check failed: ${error}` : indexed ? 'Indexed — found in Google (site: search)' : 'Not found in the Google index (site: search)',
      verdict: error ? 'FAIL' : indexed ? 'PASS' : 'FAIL',
      error,
      inspectionDeepLink: `https://search.google.com/search-console/inspect?url=${encodeURIComponent(url)}&id=sc-domain%3A${host}`,
    });
  }
  return {
    indexNow,
    inspections,
    note: 'Index status is measured with real Google site: searches via SerpAPI. Open each Inspect link to request indexing in Search Console.',
    checked_at: now(),
  };
}

function diffPaths(sitemapPaths: Set<string>, dbPaths: Set<string>) {
  const inSitemapNotInDb: string[] = [];
  const inDbNotInSitemap: string[] = [];
  let matched = 0;
  sitemapPaths.forEach(path => { if (dbPaths.has(path)) matched++; else inSitemapNotInDb.push(path); });
  dbPaths.forEach(path => { if (!sitemapPaths.has(path)) inDbNotInSitemap.push(path); });
  return { inSitemapNotInDb: inSitemapNotInDb.sort(), inDbNotInSitemap: inDbNotInSitemap.sort(), matched };
}

async function sitemapAudit() {
  const response = await fetch(`http://127.0.0.1:${port}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
  const xml = await response.text();
  const locs = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map(m => m.replace(/<\/?loc>/g, '').trim());
  const urlIssues: any[] = [];
  const canonicalHost = new URL(SITE_ORIGIN).host;
  for (const loc of locs) {
    let parsed: URL;
    try { parsed = new URL(loc); } catch { urlIssues.push({ url: loc, reason: 'Not a valid absolute URL' }); continue; }
    if (parsed.protocol !== 'https:') urlIssues.push({ url: loc, reason: `Protocol must be https (got '${parsed.protocol}')` });
    if (parsed.host !== canonicalHost) urlIssues.push({ url: loc, reason: `Host '${parsed.host}' should be '${canonicalHost}'` });
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) urlIssues.push({ url: loc, reason: 'Trailing slash on non-root path' });
  }
  const sitemapPaths = new Set(locs.map(loc => { try { return new URL(loc).pathname.replace(/\/$/, '') || '/'; } catch { return loc; } }));
  const [products, posts, pages] = await Promise.all([
    allRecords('products'), allRecords('blog_posts'), allRecords('pages'),
  ]);
  const dbProducts = new Set(products.filter(p => p.is_active !== false && p.slug).map(p => `/product/${p.slug}`));
  const dbBlogs = new Set(posts.filter(b => b.is_published !== false && b.slug).map(b => `/blog/${b.slug}`));
  const dbPages = new Set(pages.filter(p => p.is_published !== false && p.slug).map(p => `/page/${p.slug}`));
  const pick = (prefix: string) => new Set([...sitemapPaths].filter(path => path.startsWith(prefix)));
  return {
    products: diffPaths(pick('/product/'), dbProducts),
    blogs: diffPaths(pick('/blog/'), dbBlogs),
    pages: diffPaths(pick('/page/'), dbPages),
    totalSitemapUrls: locs.length,
    urlIssues,
    checkedAt: now(),
  };
}

class ProviderError extends Error {
  constructor(public provider: string, message: string, public httpStatus = 503, public upstreamStatus?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}
async function providerJson(url: string, options: RequestInit, label: string) {
  let response: Response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(providerRequestTimeoutMs) });
  } catch (error: any) {
    throw new ProviderError(label, `${label} connection failed: ${error?.message || 'upstream request failed'}`, 503);
  }
  const raw = await response.text();
  let result: any = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { /* Some provider errors are plain text. */ }
  if (!response.ok) {
    const detail = String(result.message || result.error || result.errors || raw || `${label} request failed`).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
    const httpStatus = response.status === 401 || response.status === 403 ? 424 : response.status >= 500 ? 503 : 422;
    throw new ProviderError(label, `${label} rejected the request: ${detail}`, httpStatus, response.status);
  }
  return result;
}
function normaliseRate(item: any, provider: string, fallbackService: string) {
  const serviceLevel = item.service_level || item.service_level_obj || {};
  const service = item.service_level_code || serviceLevel.code || item.service_level_name || serviceLevel.name || item.service || item.code || fallbackService;
  const price = Number(item.rate ?? item.total ?? item.price ?? item.amount ?? item.charge ?? item.base_rate?.charge ?? item.base_rate_obj?.charge ?? 0);
  const deliveryDate = item.estimated_delivery_to || item.delivery_date_to || serviceLevel.delivery_date_to;
  let estimated = 'Live quote';
  if (deliveryDate) {
    const parsed = new Date(deliveryDate);
    estimated = Number.isNaN(parsed.getTime())
      ? `By ${deliveryDate}`
      : `By ${parsed.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  }
  return { provider, service: String(service), price: Number.isFinite(price) ? price : 0, estimatedDays: estimated, description: item.service_level_name || serviceLevel.name || item.name || 'Live API shipping quote' };
}
// Maps the human-readable service shown at checkout back to the service-level
// code the ShipLogic booking endpoint requires (rate quotes return names, the
// booking POST rejects them: "Could not find rates for the requested service
// level code"). Codes verified against the TCG v3 rates response.
function courierGuyServiceCode(service: string): string | undefined {
  const name = String(service || '').toLowerCase();
  if (/same-day express|sdx/.test(name)) return 'SDX';
  if (/same-day/.test(name)) return 'SAME_DAY';
  if (/overnight/.test(name)) return 'OVN';
  if (/priority/.test(name)) return 'PRI';
  if (/economy/.test(name)) return 'ECO';
  return undefined;
}
function providerDiagnostic(error: any) {
  return error instanceof ProviderError
    ? { provider: error.provider, error: error.message, upstreamStatus: error.upstreamStatus }
    : { provider: 'shipping-provider', error: error?.message || 'Shipping provider request failed' };
}
const metaToken = () => String(process.env.FACEBOOK_PAGE_ACCSESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_GRAPH_TOKEN || '').replace(/\s+/g, '').trim();
const safeMetaError = (value: unknown) => String(value || 'upstream request failed').replace(/\s+/g, ' ').replace(/Bearer\s+[^ ]+/gi, 'Bearer [redacted]').replace(/EAA[A-Za-z0-9_-]{12,}/g, '[redacted]').slice(0, 500);
const metaGraphVersion = () => String(process.env.META_GRAPH_VERSION || 'v26.0').trim();
const socialRequestTimeoutMs = 10000;
async function metaGraphGet(pathname: string, params: Record<string, string>, label: string) {
  const token = metaToken();
  if (!token) throw new Error('Meta social credentials are not configured in Manus secrets');
  const url = new URL(`https://graph.facebook.com/${metaGraphVersion()}/${pathname.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'PurelyHealthNutra/1.0' }, signal: AbortSignal.timeout(socialRequestTimeoutMs) });
  } catch (error: any) {
    throw new ProviderError(label, `${label} connection failed: ${safeMetaError(error?.message)}`, 503);
  }
  const raw = await response.text();
  let result: any = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { /* Keep non-JSON provider errors safe. */ }
  if (!response.ok) {
    const detail = safeMetaError(result.error?.message || result.message || raw || `${label} request failed`);
    const httpStatus = response.status === 401 || response.status === 403 ? 424 : response.status >= 500 ? 503 : 422;
    throw new ProviderError(label, `${label} rejected the request: ${detail}`, httpStatus, response.status);
  }
  return result;
}
function mediaFromFacebookPost(post: any) {
  const attachment = post.attachments?.data?.[0];
  const media = attachment?.media?.image?.src || attachment?.media?.source || post.full_picture;
  return {
    id: String(post.id),
    platform: 'facebook',
    accountName: process.env.FACEBOOK_PAGE_NAME || 'Facebook Page',
    text: String(post.message || post.story || '').trim(),
    mediaUrl: media ? String(media) : undefined,
    permalink: post.permalink_url ? String(post.permalink_url) : `https://www.facebook.com/${post.id}`,
    publishedAt: post.created_time || null,
    type: attachment?.type || 'post',
  };
}
function mediaFromInstagramPost(post: any) {
  return {
    id: String(post.id),
    platform: 'instagram',
    accountName: process.env.INSTAGRAM_USERNAME || '@instagram',
    text: String(post.caption || '').trim(),
    mediaUrl: post.media_url || post.thumbnail_url || undefined,
    permalink: post.permalink ? String(post.permalink) : `https://www.instagram.com/p/${post.id}/`,
    publishedAt: post.timestamp || null,
    type: post.media_type || 'MEDIA',
  };
}
async function socialFeed(body: any) {
  const platform = body.platform === 'instagram' ? 'instagram' : 'facebook';
  const limit = String(Math.min(25, Math.max(1, Number(body.limit) || 12)));
  if (platform === 'facebook') {
    const pageId = String(process.env.FACEBOOK_PAGE_ID || '').trim();
    if (!pageId) throw new Error('FACEBOOK_PAGE_ID is not configured in Manus secrets');
    const result = await metaGraphGet(`${pageId}/feed`, {
      fields: 'id,message,story,created_time,permalink_url,full_picture,is_published,attachments{media,type,url,subattachments}',
      limit,
    }, 'Facebook Page feed');
    return { platform, accountName: process.env.FACEBOOK_PAGE_NAME || 'Facebook Page', items: (result.data || []).filter((post: any) => post.is_published !== false).map(mediaFromFacebookPost), hasMore: Boolean(result.paging?.next) };
  }
  const instagramIdValue = String(process.env.INSTAGRAM_ID || '').trim();
  const instagramId = instagramIdValue.match(/\d{5,}/)?.[0] || '';
  if (!instagramId) throw new Error('INSTAGRAM_ID is not configured in Manus secrets');
  const result = await metaGraphGet(`${instagramId}/media`, {
    fields: 'id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,username,children{media_type,media_url,permalink,thumbnail_url}',
    limit,
  }, 'Instagram media feed');
  return { platform, accountName: result.data?.[0]?.username ? `@${result.data[0].username}` : '@instagram', items: (result.data || []).map(mediaFromInstagramPost), hasMore: Boolean(result.paging?.next) };
}
async function courierGuyRates(body: any) {
  const apiKey = courierGuyApiKey();
  if (!apiKey) throw new Error('Courier Guy is not configured in Manus secrets');
  const payload = {
    account_id: courierGuyAccountId(),
    collection_address: collectionAddress('courier', body),
    delivery_address: checkoutAddress(body.destinationAddress, body.destinationPostalCode),
    parcels: [parcelFromBody(body)],
  };
  // Verified live endpoint: POST https://api.portal.thecourierguy.co.za/v3/rates (Bearer TCG key + account_id).
  const result = await providerJson(`${courierGuyBaseUrl()}/v3/rates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 'Courier Guy rates');
  const entries = Array.isArray(result) ? result : (result.rates || result.data || result.service_levels || []);
  const serviceNames: Record<string, string> = { ECO: 'Courier Guy Economy', OVN: 'Courier Guy Overnight', PRI: 'Courier Guy Priority', SDX: 'Courier Guy Same-Day Express', SAME_DAY: 'Courier Guy Same-Day' };
  return entries
    .map((item: any) => {
      const rate = normaliseRate(item, 'courier-guy', 'Courier Guy');
      const code = String(item.service_level?.code || item.service_level_code || '').trim().toUpperCase();
      rate.service = serviceNames[code] || rate.service;
      rate.description = rate.description === 'Live API shipping quote' ? 'Courier Guy door-to-door' : rate.description;
      return rate;
    })
    .filter((rate: any) => rate.price >= 0);
}
async function pudoLockers(body: any) {
  const apiKey = pudoApiKey();
  if (!apiKey) throw new Error('PUDO is not configured in Manus secrets');
  // Verified live endpoint: GET /api/v1/lockers-data (Bearer full key, ~3600 lockers).
  // The upstream call takes ~20s, so cache the full list in memory for 12 hours.
  const cacheKey = `pudo-lockers:${apiKey.length}`;
  const cached = lockerCache.get(cacheKey);
  let entries: any[];
  if (cached && Date.now() - cached.at < 12 * 60 * 60 * 1000) {
    entries = cached.data;
  } else {
    const result = await providerJson(`${pudoBaseUrl()}/api/v1/lockers-data`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    }, 'PUDO lockers');
    entries = Array.isArray(result) ? result : (result.lockers || result.data || []);
    lockerCache.set(cacheKey, { at: Date.now(), data: entries });
  }
  const destinationCode = String(body.destinationPostalCode || body.postalCode || '');
  const query = String(body.q || '').trim().toLowerCase();
  const matched = entries.filter((locker: any) => {
    if (query) {
      const name = String(locker.name || '').toLowerCase();
      const addr = String(locker.address || locker.entered_address || '').toLowerCase();
      const town = String(locker.place?.town || locker.town || '').toLowerCase();
      const postal = String(locker.place?.postalCode || locker.postalCode || '');
      return name.includes(query) || addr.includes(query) || town.includes(query) || postal.startsWith(query);
    }
    if (!destinationCode) return true;
    const postal = String(locker.place?.postalCode || locker.postalCode || '');
    // Match exact postal code first; fall back to first two digits (suburb area).
    return postal === destinationCode || postal.startsWith(destinationCode.slice(0, 2));
  });
  matched.sort((a: any, b: any) => {
    const postalA = String(a.place?.postalCode || a.postalCode || '');
    const postalB = String(b.place?.postalCode || b.postalCode || '');
    const exactA = postalA === destinationCode ? 0 : 1;
    const exactB = postalB === destinationCode ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    return postalA.localeCompare(postalB);
  });
  const list = query
    ? matched
    : matched.length
      ? matched
      : (destinationCode ? entries.filter((locker: any) => String(locker.place?.town || '').toLowerCase().includes(String(body.destinationAddress?.city || '').toLowerCase())) : entries);
  // Show the full matched set (up to 200) so the customer can browse every locker
  // near them; the searchable picker handles long lists comfortably.
  return list.slice(0, 200).map((locker: any) => ({
    id: String(locker.code || locker.id),
    name: locker.name || locker.code || 'PUDO locker',
    address: locker.address || locker.entered_address || '',
    postalCode: String(locker.place?.postalCode || locker.postalCode || ''),
    availableSlots: Number(locker.availableSlots ?? locker.available_slots ?? 0),
    latitude: Number(locker.latitude || locker.lat || 0),
    longitude: Number(locker.longitude || locker.lng || 0),
  }));
}
async function pudoRates(body: any, lockerId: string) {
  const apiKey = pudoApiKey();
  if (!apiKey) throw new Error('PUDO is not configured in Manus secrets');
  const terminalId = String(process.env.PUDO_COLLECTION_TERMINAL_ID || '').trim();
  // Verified live endpoint: POST /api/v1/locker-rates-new. Locker collection uses terminal_id;
  // without a terminal configured, fall back to the store's street address (door-to-locker).
  const parcel = parcelFromBody(body);
  const payload = terminalId
    ? {
        collection_address: { terminal_id: terminalId },
        delivery_address: { terminal_id: lockerId },
        parcels: [parcel],
      }
    : {
        collection_address: collectionAddress('pudo', body),
        delivery_address: { terminal_id: lockerId },
        parcels: [parcel],
      };
  const result = await providerJson(`${pudoBaseUrl()}/api/v1/locker-rates-new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 'PUDO rates');
  const entries = Array.isArray(result) ? result : (result.rates || result.data || [result]);
  // PUDO lockers hold a maximum of 15 kg — hide locker-to-locker options for heavier parcels.
  const parcelWeightKg = Number((parcel as any).submitted_weight_kg || 0);
  return entries
    .map((item: any) => normaliseRate(item, 'pudo', 'PUDO Locker'))
    .filter((rate: any) => rate.price >= 0 && (parcelWeightKg <= 15 || !/^L2L/i.test(String(rate.service || ''))));
}
async function pudoDoorRates(body: any) {
  const apiKey = pudoApiKey();
  if (!apiKey) throw new Error('PUDO is not configured in Manus secrets');
  const terminalId = String(process.env.PUDO_COLLECTION_TERMINAL_ID || '').trim();
  // Verified live endpoint: POST /api/v1/rates (Locker-to-Door home delivery).
  const parcel = parcelFromBody(body);
  const parcelWeightKg = Number((parcel as any).submitted_weight_kg || 0);
  const payload = {
    collection_address: terminalId ? { terminal_id: terminalId } : collectionAddress('pudo', body),
    delivery_address: checkoutAddress(body.destinationAddress, body.destinationPostalCode),
    parcels: [parcel],
  };
  const result = await providerJson(`${pudoBaseUrl()}/api/v1/rates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 'PUDO home delivery rates');
  const entries = Array.isArray(result) ? result : (result.rates || result.data || [result]);
  return entries
    .map((item: any) => {
      const rate = normaliseRate(item, 'pudo-home', 'PUDO Home Delivery');
      rate.description = 'PUDO home delivery (courier to your door)';
      return rate;
    })
    // PUDO's courier network accepts parcels up to 30 kg — heavier items quote Courier Guy only.
    .filter((rate: any) => rate.price >= 0 && (parcelWeightKg <= 30));
}
async function shippingSettings() {
  const rows = await allRecords('shipping_settings');
  const stored = rows.find(row => row.id === 'default') || ({} as any);
  const boxes = Array.isArray(stored.box_sizes) && stored.box_sizes.length
    ? stored.box_sizes
    : [
        { name: 'Small box', length: 25, width: 20, height: 12 },
        { name: 'Medium box', length: 35, width: 28, height: 20 },
        { name: 'Large box', length: 45, width: 35, height: 30 },
      ];
  const num = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    default_packaging_weight_kg: num(stored.default_packaging_weight_kg, 0.3),
    box_sizes: boxes,
    free_shipping_threshold_zar: num(stored.free_shipping_threshold_zar, 0),
    handling_fee_zar: num(stored.handling_fee_zar, 0),
  };
}

async function cartParcel(items: any[]) {
  const products = await allRecords('products');
  const byId = new Map(products.map((product: any) => [String(product.id), product]));
  let actual = 0;
  let volume = 0;
  let anyWeight = false;
  let parcelCount = 1;
  for (const item of items || []) {
    const quantity = Math.max(1, Number(item?.quantity || 1));
    const product = byId.get(String(item?.productId || item?.product_id || ''));
    const weight = Math.max(0, Number(product?.weight_kg ?? product?.weight ?? 0));
    // Dragon fruit cutting sizes: standard 20-30cm cuttings weigh 150-300g,
    // large 40cm cuttings weigh 350-700g. Use the heavier bound per unit.
    const itemSize = String(item?.size || '');
    const effWeight = itemSize === 'large' ? Math.max(weight, 0.7) : (itemSize === 'standard' ? (weight > 0 ? weight : 0.3) : weight);
    if (effWeight > 0) anyWeight = true;
    // Per-product packed-parcel overrides (admin): use the final packed
    // dimensions when fully supplied, otherwise the product's own dimensions.
    const pLength = Math.max(0, Number(product?.packed_length_cm ?? 0));
    const pWidth = Math.max(0, Number(product?.packed_width_cm ?? 0));
    const pHeight = Math.max(0, Number(product?.packed_height_cm ?? 0));
    const hasPacked = pLength > 0 && pWidth > 0 && pHeight > 0;
    const length = hasPacked ? pLength : Math.max(0, Number(product?.length_cm ?? 0));
    const width = hasPacked ? pWidth : Math.max(0, Number(product?.width_cm ?? 0));
    const height = hasPacked ? pHeight : Math.max(0, Number(product?.height_cm ?? 0));
    parcelCount = Math.max(parcelCount, Math.max(1, Math.round(Number(product?.parcel_count ?? 1) || 1)));
    actual += effWeight * quantity;
    volume += length * width * height * quantity;
  }
  const settings = await shippingSettings();
  // The largest per-product packaging weight in the cart wins; otherwise the global default.
  let perProductPackaging = 0;
  for (const item of items || []) {
    const product = byId.get(String(item?.productId || item?.product_id || ''));
    perProductPackaging = Math.max(perProductPackaging, Math.max(0, Number(product?.packaging_weight_kg ?? 0)));
  }
  const packagingWeight = perProductPackaging || settings.default_packaging_weight_kg;
  const packedWeight = actual + (anyWeight ? packagingWeight : 0);
  const boxes = [...settings.box_sizes].sort((a: any, b: any) => (a.length * a.width * a.height) - (b.length * b.width * b.height));
  const box = boxes.find((candidate: any) => candidate.length * candidate.width * candidate.height >= volume) || boxes[boxes.length - 1] || { name: 'Standard flyer', length: 30, width: 20, height: 15 };
  const volumetricWeight = (Number(box.length) * Number(box.width) * Number(box.height)) / 5000;
  const billable = Math.max(anyWeight ? packedWeight : 0.5, volumetricWeight);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const parcel = {
    actualWeight: round(anyWeight ? actual : 0.5),
    packagingWeight,
    volumetricWeight: round(volumetricWeight),
    billableWeight: Math.max(0.1, round(billable)),
    box,
    dimensions: { length: Number(box.length), width: Number(box.width), height: Number(box.height) },
    parcelCount,
  };
  // When products declare multiple parcels, provide the per-parcel array for couriers.
  if (parcelCount > 1) {
    const perWeight = Math.max(0.1, round(billable / parcelCount));
    (parcel as any).parcels = Array.from({ length: parcelCount }, () => ({
      submitted_length_cm: Number(box.length),
      submitted_width_cm: Number(box.width),
      submitted_height_cm: Number(box.height),
      submitted_weight_kg: perWeight,
      parcel_description: 'Purely Health Nutra order',
    }));
  }
  return parcel;
}

function zoneSpecificity(zone: any, destinationCountry: string, destinationRegion: string) {
  const countries = (Array.isArray(zone.countries) ? zone.countries : []).map((value: any) => String(value).trim().toLowerCase()).filter(Boolean);
  const regions = (Array.isArray(zone.regions) ? zone.regions : []).map((value: any) => String(value).trim().toLowerCase()).filter(Boolean);
  const country = String(destinationCountry || '').trim().toLowerCase();
  const region = String(destinationRegion || '').trim().toLowerCase();
  const countryMatch = !countries.length || countries.includes(country) || countries.includes('*');
  const regionMatch = !regions.length || regions.includes(region) || regions.includes('*');
  if (!countryMatch || !regionMatch) return -1;
  let score = 0;
  if (country && countries.includes(country)) score += 4;
  if (region && regions.includes(region)) score += 2;
  return score;
}

async function zoneShippingRates(body: any) {
  const destination = body.destinationAddress || {};
  const country = String(destination.country || body.country || 'South Africa');
  const region = String(destination.zone || destination.province || body.province || '');
  const billable = Number(body.billableWeight ?? body.weight ?? 0);
  const length = Number(body.dimensions?.length || 0);
  const width = Number(body.dimensions?.width || 0);
  const height = Number(body.dimensions?.height || 0);
  const zones = await allRecords('shipping_zones');
  const rows = await allRecords('shipping_rates');
  const scored = zones
    .map(zone => ({ zone, score: zoneSpecificity(zone, country, region) }))
    .filter((entry: any) => entry.score >= 0)
    .sort((a: any, b: any) => b.score - a.score);
  const bestZone = scored[0]?.zone || null;
  const zoneRows = bestZone
    ? rows.filter((row: any) => row.is_active !== false && String(row.zone_id || '') !== '' && (String(row.zone_id) === String(bestZone.id) || String(row.zone_id) === String(bestZone.name)))
    : [];
  const globalRows = rows.filter((row: any) => row.is_active !== false && !row.zone_id);
  return [...zoneRows, ...globalRows]
    .filter((row: any) => {
      const min = Number(row.min_weight_kg);
      const max = Number(row.max_weight_kg);
      if (Number.isFinite(min) && min > 0 && billable < min) return false;
      if (Number.isFinite(max) && max > 0 && billable > max) return false;
      if (Number.isFinite(Number(row.max_length_cm)) && Number(row.max_length_cm) > 0 && length > Number(row.max_length_cm)) return false;
      if (Number.isFinite(Number(row.max_width_cm)) && Number(row.max_width_cm) > 0 && width > Number(row.max_width_cm)) return false;
      if (Number.isFinite(Number(row.max_height_cm)) && Number(row.max_height_cm) > 0 && height > Number(row.max_height_cm)) return false;
      return true;
    })
    .map((row: any) => ({
      id: `zone:${row.id}`,
      provider: String(row.provider || 'manual'),
      zoneName: row.zone_id ? String(bestZone?.name || 'Zone') : 'All zones',
      service: String(row.service_name || row.service_code || 'Standard delivery'),
      price: Number(row.price_zar || 0),
      estimatedDays: String(row.estimated_days || '2–5 business days'),
      description: String(row.description || (row.zone_id ? `${bestZone?.name || 'Zone'} rate` : 'Store rate')),
    }))
    .sort((a: any, b: any) => a.price - b.price);
}

async function shippingRates(body: any) {
  const rates: any[] = [];
  const errors: any[] = [];
  const provider = body.provider || 'all';
  rates.push(...await zoneShippingRates(body));
  if (provider !== 'pudo') {
    try { rates.push(...await courierGuyRates(body)); } catch (error) { errors.push(providerDiagnostic(error)); }
  }
  if (provider !== 'courier-guy') {
    try {
      let lockerId = String(body.pudoLockerId || process.env.PUDO_COLLECTION_TERMINAL_ID || '');
      if (!lockerId) {
        const lockers = await pudoLockers(body);
        lockerId = String(lockers[0]?.id || '');
      }
      if (lockerId) rates.push(...await pudoRates(body, lockerId));
      else errors.push({ provider: 'PUDO rates', error: 'No PUDO locker was available for this destination.' });
    } catch (error) { errors.push(providerDiagnostic(error)); }
    try { rates.push(...await pudoDoorRates(body)); } catch (error) { errors.push(providerDiagnostic(error)); }
  }
  if (!rates.length) {
    const configuredFallback = Number(process.env.FALLBACK_SHIPPING_FLAT_RATE_ZAR || 99);
    const fallbackPrice = Number.isFinite(configuredFallback) && configuredFallback >= 0 ? configuredFallback : 99;
    rates.push({ provider: 'fallback', service: 'Standard delivery', price: fallbackPrice, estimatedDays: '2–5 business days', description: 'Flat-rate fallback; live carrier quote unavailable.' });
  }
  const settings = await shippingSettings();
  const subtotal = Number(body.subtotal || 0);
  for (const rate of rates) {
    rate.id = rate.id || `live:${rate.provider}:${rate.service}`;
    if (settings.handling_fee_zar > 0) {
      rate.price = Math.round((Number(rate.price || 0) + settings.handling_fee_zar) * 100) / 100;
      rate.description = `${rate.description} · includes R${settings.handling_fee_zar.toFixed(2)} handling`;
    }
  }
  // Store policy: free shipping is never offered. The setting is kept only for
  // backwards compatibility with existing records but is always treated as off.
  if (false && settings.free_shipping_threshold_zar > 0 && subtotal >= settings.free_shipping_threshold_zar) {
    rates.push({ id: 'free:free-shipping', provider: 'free', service: 'Free delivery', price: 0, estimatedDays: '2–5 business days', description: `Free delivery on orders over R${settings.free_shipping_threshold_zar.toFixed(2)}` });
  }
  rates.sort((a: any, b: any) => a.price - b.price);
  return { rates, errors };
}
async function createCourierShipment(body: any) {
  const apiKey = courierGuyApiKey();
  if (!apiKey) throw new Error('Courier Guy is not configured in Manus secrets');
  const payload = { account_id: courierGuyAccountId(), collection_address: collectionAddress('courier', body), collection_contact: collectionContact(body), delivery_address: checkoutAddress(body.destinationAddress, body.destinationPostalCode), delivery_contact: body.deliveryContact, parcels: Array.isArray(body.parcels) && body.parcels.length ? body.parcels : [parcelFromBody(body)], service_level_code: body.serviceLevelCode };
  return providerJson(`${courierGuyBaseUrl()}/v3/shipments`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Courier Guy shipment');
}

async function createPudoShipment(body: any) {
  const apiKey = pudoApiKey();
  if (!apiKey) throw new Error('PUDO is not configured in Manus secrets');
  const terminalId = String(process.env.PUDO_COLLECTION_TERMINAL_ID || '').trim();
  // Verified live endpoint: POST /api/v1/shipments. Locker addresses use terminal_id objects;
  // home delivery (Locker-to-Door) books with the customer's full street address.
  const isHomeDelivery = !body.pudoLockerId;
  const parcel = parcelFromBody(body);
  // The full quoted string IS the service code ("L2DXS - ECO" — verified against
  // the rates response); only stray locker names appended by checkout are trimmed.
  const pudoServiceCode = String(body.serviceLevelCode || '').replace(/\s*-\s*[^(-]*\([^)]*\)\s*$/, '').trim() || undefined;
  const payload = {
    collection_address: terminalId ? { terminal_id: terminalId } : collectionAddress('pudo', body),
    collection_contact: collectionContact(body),
    delivery_address: isHomeDelivery ? checkoutAddress(body.destinationAddress, body.destinationPostalCode) : { terminal_id: body.pudoLockerId },
    delivery_contact: body.deliveryContact,
    service_level_code: pudoServiceCode,
    parcels: Array.isArray(body.parcels) && body.parcels.length ? body.parcels : [parcel],
  };
  const result = await providerJson(`${pudoBaseUrl()}/api/v1/shipments`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'PUDO shipment');
  // Verified: waybill/label downloads use the api_key query parameter on /generate/waybill.
  const bookingId = String(result.id || result.booking_id || result.shipment_id || '');
  if (bookingId) {
    result.waybill_url = `${pudoBaseUrl()}/generate/waybill/${bookingId}?api_key=${encodeURIComponent(apiKey)}`;
    result.label_url = `${pudoBaseUrl()}/generate/sticker/${bookingId}?api_key=${encodeURIComponent(apiKey)}`;
  }
  return result;
}

async function functionRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!pathname.startsWith('/api/functions/')) return false;
  const name = decodeURIComponent(pathname.slice('/api/functions/'.length));
  const body = req.method === 'GET'
    ? Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries())
    : await readJson(req);
  try {
    if (name === 'create-order') return json(res, 200, await createGuestOrder(body));
    if (name === 'payment-config') return json(res, 200, { data: await paymentConfig() });
    if (name === 'payment-settings-get') return json(res, 200, { data: await getPaymentSettings() });
    if (name === 'payment-settings-set') {
      const rows = await allRecords('payment_settings');
      const stored = rows.find(row => row.id === 'default') || { id: 'default' };
      const updated = {
        ...stored,
        ...(body.payfast_enabled !== undefined ? { payfast_enabled: Boolean(body.payfast_enabled) } : {}),
        ...(body.yoco_enabled !== undefined ? { yoco_enabled: Boolean(body.yoco_enabled) } : {}),
        ...(body.paypal_enabled !== undefined ? { paypal_enabled: Boolean(body.paypal_enabled) } : {}),
        ...(body.paypal_usd_rate !== undefined ? { paypal_usd_rate: Number(body.paypal_usd_rate) } : {}),
        updated_at: now(),
      };
      await saveRecord('payment_settings', updated);
      return json(res, 200, { success: true, data: await getPaymentSettings() });
    }
    if (name === 'payment-events') {
      const events = await allRecords('payment_webhook_events');
      events.sort((a: any, b: any) => String(b.received_at || '').localeCompare(String(a.received_at || '')));
      return json(res, 200, { data: events.slice(0, 50) });
    }
    if (name === 'payfast-payment') return json(res, 200, { data: await initiatePayFast({ ...body, origin: `${body.origin || ''}` }) });
    if (name === 'yoco-payment') return json(res, 200, { data: await initiateYoco(body) });
    if (name === 'paypal-payment') return json(res, 200, { data: await initiatePayPal(body) });
    if (name === 'shipping-rates') return json(res, 200, await shippingRates(body));
    if (name === 'pudo-lockers') return json(res, 200, { lockers: await pudoLockers(body) });
    if (name === 'social-feed') return json(res, 200, { data: await socialFeed(body) });
    if (name === 'create-shipment') {
      const shipment = body.provider === 'pudo' ? await createPudoShipment(body) : await createCourierShipment(body);
      return json(res, 200, { success: true, shipment });
    }
    if (name === 'book-order-shipment') {
      const orders = await allRecords('orders');
      const order = orders.find((row: any) => row.id === body.orderId || row.order_number === body.orderId);
      if (!order) return json(res, 404, { error: 'Order not found' });
      const orderItems = (await allRecords('order_items')).filter((item: any) => item.order_id === order.id);
      const parcel = await cartParcel(orderItems.map((item: any) => ({ productId: item.product_id, quantity: item.quantity })));
      const option = order.shipping_option || {};
      const isPudo = (body.provider ? String(body.provider) : String(option.provider || '')).toLowerCase().includes('pudo');
      // Locker-to-locker service with no destination locker stored: book the
      // door-delivery (L2D) equivalent so the address types match the service.
      const retryService = isPudo && !order.pudo_locker_id && /^L2L/i.test(String(option.service || ''))
        ? String(option.service).replace(/^L2L/i, 'L2D')
        : (option.service || undefined);
      const bookingBody = {
        provider: isPudo ? 'pudo' : 'courier',
        weight: parcel.billableWeight,
        dimensions: parcel.dimensions,
        parcels: (parcel as any).parcels,
        destinationAddress: { ...(order.shipping_address || {}), country: order.shipping_address?.country || 'South Africa', province: order.shipping_address?.province || '' },
        destinationPostalCode: order.shipping_address?.postalCode || '',
        pudoLockerId: order.pudo_locker_id || '',
        deliveryContact: { name: order.shipping_address?.name || '', email: order.guest_email || '', mobile_number: order.shipping_address?.phone || '' },
        serviceLevelCode: isPudo ? retryService : (courierGuyServiceCode(option.service) || option.service || undefined),
        orderId: order.order_number,
      };
      const result = isPudo ? await createPudoShipment(bookingBody) : await createCourierShipment(bookingBody);
      const trackingNumber = String(result.tracking_number || result.reference || result.id || '');
      const waybillUrl = String(result.waybill_url || result.waybillUrl || result.label_url || result.sticker_url || result.links?.waybill || '');
      const record = {
        id: newId(),
        order_id: order.id,
        order_number: order.order_number,
        provider: isPudo ? 'pudo' : 'courier-guy',
        service: String(option.service || order.shipping_method || 'Standard'),
        shipment_ref: String(result.id || result.shipment_id || ''),
        tracking_number: trackingNumber,
        waybill_url: waybillUrl,
        parcel_weight_kg: parcel.billableWeight,
        parcel_dimensions: parcel.dimensions,
        parcel_count: parcel.parcelCount || 1,
        status: 'booked',
        created_at: now(),
        updated_at: now(),
      };
      await saveRecord('shipments', record);
      await saveRecord('orders', { ...order, tracking_number: trackingNumber || order.tracking_number, tracking_carrier: isPudo ? 'PUDO' : 'Courier Guy', updated_at: now() });
      return json(res, 200, { success: true, shipment: record });
    }
    if (name === 'shipment-tracking') {
      const apiKey = courierGuyApiKey() || pudoApiKey();
      if (!apiKey) return json(res, 200, { status: 'unavailable', detail: 'Courier credentials are not configured' });
      const shipmentRef = String(body.shipmentRef || body.trackingNumber || '');
      // Documented tracking endpoint: GET /tracking/shipments/public?waybill=TCGD...
      const result = await providerJson(`${courierGuyBaseUrl()}/tracking/shipments/public?waybill=${encodeURIComponent(shipmentRef)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }, 'Shipment tracking');
      return json(res, 200, { status: String(result.status || result.state || 'unknown'), events: result.tracking_events || [], detail: result });
    }
    if (name === 'payment-health') return json(res, 200, { data: await paymentConfig() });
    if (name === 'chat-message') return json(res, 200, await chatMessage(body));
    if (name === 'generate-product-content') return json(res, 200, { data: await generateProductContent(body) });
    if (name === 'product-search') return json(res, 200, { data: await productSearch(body) });
    if (name === 'product-duplicate-check') return json(res, 200, { data: await productDuplicateCheck(body) });
    if (name === 'product-dashboard') return json(res, 200, { data: await productDashboard() });
    if (name === 'social-generate-post') return json(res, 200, { data: await socialGeneratePost(body) });
    if (name === 'social-log-publish') return json(res, 200, { data: await socialLogPublish(body) });
    if (name === 'email-settings') return json(res, 200, { data: await emailSettingsHandler(body) });
    if (name === 'email-inbox') return json(res, 200, { data: await emailInboxHandler(body) });
    if (name === 'partnership-enquiry') return json(res, 200, { data: await partnershipEnquiry(body) });
    if (name === 'seo-optimizer') {
      const action = String(body.action || 'audit');
      if (action === 'audit') return json(res, 200, { data: await seoAudit() });
      if (action === 'optimize-product') return json(res, 200, { data: await seoOptimizeProduct(String(body.productId || '')) });
      if (action === 'bulk-optimize') return json(res, 200, { data: await seoOptimizeBulk(body.productIds) });
      if (action === 'research') return json(res, 200, { data: await seoResearch(body) });
      if (action === 'ai-optimize-product') return json(res, 200, { data: await seoAiOptimizeProduct(body) });
      return json(res, 400, { error: `Unknown seo-optimizer action: ${action}` });
    }
    if (name === 'gemini-generate') {
      if (body.action === 'status') return json(res, 200, { data: await geminiStatus() });
      const messages: GeminiTurn[] = Array.isArray(body.messages)
        ? body.messages.map((m: any) => ({ role: String(m.role || 'user'), content: String(m.content || '').slice(0, 8000) }))
        : [{ role: 'user', content: String(body.prompt || '').slice(0, 8000) }];
      if (!messages.some(m => m.content.trim())) return json(res, 400, { error: 'Provide a prompt or messages' });
      return json(res, 200, { data: await geminiChat(messages, { temperature: Number(body.temperature) || 0.4, model: body.model ? String(body.model) : undefined }) });
    }
    if (name === 'submit-to-search-engines') return json(res, 200, { data: await submitToSearchEngines(body) });
    if (name === 'seo-health') return json(res, 200, { data: await seoHealthCheck() });
    if (name === 'google-services') {
      const action = String(body.action || 'status');
      if (action === 'status') {
        const accounts = loadServiceAccounts().map(({ name, sa }) => ({ env_var: name, client_email: sa.client_email, project: sa.project_id }));
        return json(res, 200, { data: { accounts, checked_at: now() } });
      }
      if (action === 'submit-sitemap') return json(res, 200, { data: await gscApiSubmitSitemap(SITE_ORIGIN) });
      if (action === 'submit-products') return json(res, 200, { data: await merchantSubmitProducts() });
      if (action === 'index-urls') {
        const urls = (Array.isArray(body.urls) ? body.urls : []).map((u: any) => String(u)).filter((u: string) => /^https:\/\//.test(u)).slice(0, 10);
        return json(res, 200, { data: await googleIndexingSubmit(urls.length ? urls : [`${SITE_ORIGIN}/`]) });
      }
      return json(res, 400, { error: `Unknown google-services action: ${action}` });
    }
    if (name === 'gsc-priority-indexing' || name === 'priority-indexing') return json(res, 200, { data: await gscPriorityIndexing() });
    if (name === 'sitemap-audit') return json(res, 200, { data: await sitemapAudit() });
    if (name === 'seo-keywords') return json(res, 200, { data: await serpKeywordResearch(body) });
    if (name === 'seo-rank-check') return json(res, 200, { data: await serpRankCheck(body) });
    if (name === 'address-suggest') return json(res, 200, { data: await addressSuggest(body) });
    if (name === 'address-details') return json(res, 200, { data: await addressDetails(body) });
    if (['ai-orchestrator', 'zai-chat', 'admin-ai', 'onemin-chat', 'openrouter-ai'].includes(name)) {
      if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) throw new Error('Manus AI runtime is not available');
      const response = await fetch(`${process.env.MANUS_API_URL}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MANUS_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: body.model || 'default', messages: body.messages || [{ role: 'user', content: body.prompt || body.message || '' }], temperature: body.temperature ?? 0.4 }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, response.status, { error: result.error?.message || 'Manus AI request failed' });
      return json(res, 200, { data: result });
    }
    return json(res, 200, { data: { ok: true, migrated: true, function: name } });
  } catch (error: any) {
    if (error instanceof ProviderError && name === 'shipping-rates') return json(res, 200, { rates: [], errors: [providerDiagnostic(error)] });
    if (error instanceof ProviderError && name === 'pudo-lockers') return json(res, 200, { lockers: [], error: error.message, provider: error.provider, upstreamStatus: error.upstreamStatus });
    if (error instanceof ProviderError && name === 'social-feed') return json(res, 200, { data: { platform: body.platform, accountName: body.platform === 'instagram' ? '@instagram' : process.env.FACEBOOK_PAGE_NAME || 'Facebook Page', items: [], hasMore: false, error: providerDiagnostic(error) } });
    if (['payfast-payment', 'yoco-payment', 'paypal-payment'].includes(name)) {
      const diagnostic = error instanceof ProviderError
        ? { provider: error.provider, error: error.message, upstreamStatus: error.upstreamStatus }
        : { provider: name.replace('-payment', ''), error: error?.message || 'Payment provider request failed' };
      return json(res, 200, { data: { success: false, ...diagnostic } });
    }
    if (error instanceof ProviderError) return json(res, error.httpStatus, { error: error.message, provider: error.provider, upstreamStatus: error.upstreamStatus });
    if (name === 'social-feed') return json(res, 200, { data: { platform: body.platform, accountName: String(body.platform).toLowerCase() === 'instagram' ? '@instagram' : process.env.FACEBOOK_PAGE_NAME || 'Facebook Page', items: [], hasMore: false, error: { provider: 'Meta', error: error?.message || 'Social feed request failed' } } });
    return json(res, 502, { error: error?.message || 'Server function failed' });
  }
}

let chatContextCache: { at: number; kb: AppRecord[]; products: AppRecord[]; keywords: AppRecord[] } | null = null;

function tokenize(text: string): string[] {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2);
}

function scoreRecord(record: AppRecord, fields: string[], tokens: string[]): number {
  const hay = tokenize(fields.map(f => String(record[f] ?? '')).join(' '));
  const set = new Set(hay);
  return tokens.reduce((score, token) => score + (set.has(token) ? 1 : 0), 0);
}

// ---- Google Gemini (server-side only) with key rotation across all configured keys ----
function geminiApiKeys(): string[] {
  return [
    process.env.GOOGLE_API_VERTEX,
    process.env.GOOGLE_GEMINI_VERTEX_API,
    process.env.GOOGLE_API_100_SERVICES,
    process.env.GOOGLE_ALL_SERVICES,
    process.env.GOOGLE_API_KEY_1,
  ].map(k => (k || '').trim()).filter(Boolean);
}

interface GeminiTurn { role: string; content: string }

// Vertex AI via service account: cache the short-lived OAuth token in memory.
let vertexTokenCache: { token: string; expiresAt: number } | null = null;

async function vertexAccessToken() {
  if (vertexTokenCache && Date.now() < vertexTokenCache.expiresAt) return vertexTokenCache.token;
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured in Manus secrets');
  const sa = JSON.parse(raw);
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
  const claims = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, iat: issuedAt, exp: issuedAt + 3600 });
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(String(sa.private_key)).toString('base64url');
  const response = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  const result: any = await response.json().catch(() => ({}));
  if (!result.access_token) throw new Error(`Vertex token request failed: ${JSON.stringify(result).slice(0, 160)}`);
  vertexTokenCache = { token: result.access_token, expiresAt: Date.now() + (Number(result.expires_in || 3600) - 300) * 1000 };
  return result.access_token as string;
}

async function vertexGemini(messages: GeminiTurn[], options: { temperature?: number; model?: string; maxOutputTokens?: number } = {}) {
  const sa = JSON.parse((process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim());
  const token = await vertexAccessToken();
  const model = options.model || 'gemini-2.5-flash';
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  let lastError = 'unknown error';
  for (const location of ['us-central1', 'europe-west1']) {
    try {
      const response = await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${location}/publishers/google/models/${model}:generateContent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { temperature: options.temperature ?? 0.4, maxOutputTokens: options.maxOutputTokens ?? 2048, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) { lastError = result?.error?.message || `Vertex request failed (HTTP ${response.status})`; continue; }
      const text = (result.candidates?.[0]?.content?.parts || []).map((p: any) => String(p.text || '')).join('').trim();
      if (!text) { lastError = 'Vertex returned an empty response'; continue; }
      return { text, provider: 'vertex-ai', model, location };
    } catch (error: any) { lastError = error?.message || 'Vertex request failed'; }
  }
  throw new Error(lastError);
}

async function serviceAccountConfigured() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return false;
  try { const sa = JSON.parse(raw); return Boolean(sa.client_email && sa.private_key && sa.project_id); }
  catch { return false; }
}

async function geminiStatus() {
  const results: { env_var: string; ok: boolean; message: string }[] = [];
  if (await serviceAccountConfigured()) {
    try {
      const vertex = await vertexGemini([{ role: 'user', content: 'Say OK' }], { maxOutputTokens: 200 });
      results.push({ env_var: 'GOOGLE_SERVICE_ACCOUNT_JSON', ok: true, message: `Working (Vertex AI ${vertex.model}, ${vertex.location})` });
    } catch (error: any) {
      results.push({ env_var: 'GOOGLE_SERVICE_ACCOUNT_JSON', ok: false, message: String(error?.message || 'Vertex request failed').slice(0, 160) });
    }
  } else {
    results.push({ env_var: 'GOOGLE_SERVICE_ACCOUNT_JSON', ok: false, message: 'Not set in Manus secrets' });
  }
  const names = ['GOOGLE_API_VERTEX', 'GOOGLE_GEMINI_VERTEX_API', 'GOOGLE_API_100_SERVICES', 'GOOGLE_ALL_SERVICES', 'GOOGLE_API_KEY_1'];
  for (const name of names) {
    const key = (process.env[name] || '').trim();
    if (!key) { results.push({ env_var: name, ok: false, message: 'Not set in Manus secrets' }); continue; }
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 8 } }),
      });
      const result: any = await response.json().catch(() => ({}));
      const text = (result.candidates?.[0]?.content?.parts || []).map((p: any) => String(p.text || '')).join('').trim();
      results.push(response.ok && text
        ? { env_var: name, ok: true, message: 'Working (model gemini-2.5-flash)' }
        : { env_var: name, ok: false, message: `HTTP ${response.status}: ${String(result?.error?.message || 'empty response').slice(0, 160)}` });
    } catch (error: any) {
      results.push({ env_var: name, ok: false, message: error?.message || 'request failed' });
    }
  }
  return { keys: results, working: results.filter(r => r.ok).length, checked_at: now() };
}

async function geminiChat(messages: GeminiTurn[], options: { temperature?: number; model?: string; maxOutputTokens?: number } = {}) {
  // Prefer the working Vertex AI service account when it is configured.
  if (await serviceAccountConfigured()) {
    try { return await vertexGemini(messages, options); }
    catch { /* fall through to API-key rotation */ }
  }
  const keys = geminiApiKeys();
  if (!keys.length) throw new Error('No Google Gemini key is configured in Manus secrets');
  const model = options.model || 'gemini-2.5-flash';
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  let lastError = 'unknown error';
  for (const key of keys) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { temperature: options.temperature ?? 0.4, maxOutputTokens: options.maxOutputTokens ?? 2048, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) { lastError = result?.error?.message || `Gemini request failed (HTTP ${response.status})`; continue; }
      const text = (result.candidates?.[0]?.content?.parts || [])
        .map((p: any) => String(p.text || '')).join('').trim();
      if (!text) { lastError = 'Gemini returned an empty response'; continue; }
      return { text, provider: 'gemini', model };
    } catch (error: any) {
      lastError = error?.message || 'Gemini request failed';
    }
  }
  throw new Error(lastError);
}

// ---- Google web services via service accounts (Search Console, Indexing, Shopping) ----
function loadServiceAccounts(): { name: string; sa: any }[] {
  const out: { name: string; sa: any }[] = [];
  for (const name of ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_JSON_2', 'GOOGLE_JSON']) {
    const raw = (process.env[name] || '').trim();
    if (!raw) continue;
    try {
      const sa = JSON.parse(raw);
      if (sa?.client_email && sa?.private_key && sa?.token_uri) out.push({ name, sa });
    } catch { /* invalid JSON — skip */ }
  }
  return out;
}

// Weekly SEO health probe: everything a monitoring run needs in one call.
async function seoHealthCheck() {
  const checks: { name: string; ok: boolean; details: string }[] = [];
  const probe = async (url: string, expect: (body: string, status: number) => boolean, name: string, note?: (body: string) => string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const body = await r.text();
      checks.push({ name, ok: expect(body, r.status), details: note ? note(body) : `HTTP ${r.status}` });
    } catch (error: any) {
      checks.push({ name, ok: false, details: error?.message || 'request failed' });
    }
  };
  await probe(`${SITE_ORIGIN}/robots.txt`, (b, s) => s === 200 && /sitemap:/i.test(b), 'robots.txt + sitemap directive');
  await probe(`${SITE_ORIGIN}/sitemap.xml`, (b, s) => s === 200 && (b.match(/<loc>/g) || []).length > 100, 'sitemap.xml', b => `${(b.match(/<loc>/g) || []).length} URLs in sitemap`);
  await probe(`${SITE_ORIGIN}/feeds/google-shopping.xml`, (b, s) => s === 200 && b.includes('<item>'), 'Google Shopping feed');
  await probe(`${SITE_ORIGIN}/`, (b, s) => s === 200 && b.includes('GTM-PQH6D3S4') && b.includes('G-MQXDSTLS52'), 'GTM + GA4 tags present');
  await probe(`${SITE_ORIGIN}/`, (b, s) => s === 200 && b.includes('msvalidate.01'), 'Bing verification meta tag');
  await probe(`${SITE_ORIGIN}/`, (b, s) => s === 200 && /rel="canonical"/.test(b), 'canonical tag present');
  await probe(`${SITE_ORIGIN}/this-seo-monitor-probe-should-404`, (_b, s) => s === 404, 'soft-404 protection', () => 'unknown paths return HTTP 404');
  try {
    const indexNow = await indexNowSubmit([`${SITE_ORIGIN}/`]);
    checks.push({ name: 'IndexNow submission', ok: indexNow.status === 'success', details: `HTTP ${indexNow.http}` });
  } catch (error: any) {
    checks.push({ name: 'IndexNow submission', ok: false, details: error?.message || 'failed' });
  }
  return { checked_at: now(), origin: SITE_ORIGIN, overall_ok: checks.every(c => c.ok), checks };
}

const googleApiTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function googleApiToken(sa: any, scope: string) {
  const cacheKey = `${sa.client_email}:${scope}`;
  const cached = googleApiTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
  const claims = b64({ iss: sa.client_email, scope, aud: sa.token_uri, iat: issuedAt, exp: issuedAt + 3600 });
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(String(sa.private_key)).toString('base64url');
  const response = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  const result: any = await response.json().catch(() => ({}));
  if (!result.access_token) throw new Error(`Google token request failed: ${JSON.stringify(result).slice(0, 140)}`);
  googleApiTokenCache.set(cacheKey, { token: result.access_token, expiresAt: Date.now() + (Number(result.expires_in || 3600) - 300) * 1000 });
  return result.access_token as string;
}

// Pushes every active product into Google Merchant Center through the Content API
// (products custombatch). Works once a service account has been added as a user in
// Merchant Center; otherwise it reports the exact account email to grant.
async function merchantSubmitProducts() {
  const accounts = loadServiceAccounts();
  if (!accounts.length) return { available: false, details: 'No Google service account is configured in Manus secrets' };
  const origin = SITE_ORIGIN;
  const attempts: any[] = [];
  for (const { name, sa } of accounts) {
    try {
      const token = await googleApiToken(sa, 'https://www.googleapis.com/auth/content');
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const infoRes = await fetch('https://shoppingcontent.googleapis.com/content/v2.1/accounts/authinfo', { headers, signal: AbortSignal.timeout(30000) });
      const info: any = await infoRes.json().catch(() => ({}));
      const merchantId = String((info.accounts || [])[0]?.merchantId || '');
      if (!merchantId) {
        attempts.push({ account: name, ok: false, details: `No Merchant Center account linked. Add ${sa.client_email} as a user in Merchant Center → Account access, then retry.` });
        continue;
      }
      const products = (await allRecords('products')).filter((p: any) => p.is_active && Number(p.price_zar) > 0);
      const entries = products.slice(0, 500).map((p: any, i: number) => {
        const image = String(p.primary_image_url || '');
        const desc = String(p.short_description || p.description || p.name || '').replace(/<[^>]+>/g, ' ').slice(0, 5000);
        return {
          batchId: i,
          merchantId: Number(merchantId),
          method: 'insert',
          product: {
            offerId: String(p.sku || p.id),
            title: String(p.meta_title || p.name || '').slice(0, 150),
            description: desc,
            link: `${origin}/product/${p.slug}`,
            imageLink: image.startsWith('http') ? image : `${origin}${image}`,
            contentLanguage: 'en',
            targetCountry: 'ZA',
            channel: 'online',
            availability: Number(p.stock_quantity ?? 0) > 0 ? 'in stock' : 'out of stock',
            condition: 'new',
            brand: String(p.brand || 'Purely Health Nutra'),
            price: { value: Number(p.price_zar).toFixed(2), currency: 'ZAR' },
          },
        };
      });
      if (!entries.length) { attempts.push({ account: name, ok: false, details: 'No active products to submit' }); continue; }
      const out: any[] = [];
      for (let i = 0; i < entries.length; i += 100) {
        const batchRes = await fetch(`https://shoppingcontent.googleapis.com/content/v2.1/products/batch`, {
          method: 'POST', headers, signal: AbortSignal.timeout(120000),
          body: JSON.stringify({ entries: entries.slice(i, i + 100) }),
        });
        const batch: any = await batchRes.json().catch(() => ({}));
        out.push(...(batch.entries || []));
      }
      const failed = out.filter((e: any) => e.errors?.length);
      attempts.push({ account: name, ok: failed.length === 0, details: `Merchant Center batch submitted: ${entries.length - failed.length} ok, ${failed.length} failed (merchantId ${merchantId})` });
    } catch (error: any) {
      attempts.push({ account: name, ok: false, details: String(error?.message || error).slice(0, 160) });
    }
  }
  return { available: true, submitted: attempts.some(a => a.ok), attempts, checked_at: now() };
}

// Submits the sitemap through the Search Console API with the first service account
// that has access to the property. Real submission, no dashboard click required.
async function gscApiSubmitSitemap(origin: string) {
  const accounts = loadServiceAccounts();
  if (!accounts.length) return { available: false, details: 'No Google service account is configured in Manus secrets' };
  const host = new URL(origin).host;
  const sitemapUrl = `${origin}/sitemap.xml`;
  const attempts: any[] = [];
  for (const { name, sa } of accounts) {
    try {
      const token = await googleApiToken(sa, 'https://www.googleapis.com/auth/webmasters');
      const headers = { Authorization: `Bearer ${token}` };
      const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers, signal: AbortSignal.timeout(30000) });
      const sites: any = await sitesRes.json().catch(() => ({}));
      if (!sitesRes.ok) { attempts.push({ account: name, ok: false, details: `HTTP ${sitesRes.status}: ${String(sites.error?.message || '').slice(0, 120)}` }); continue; }
      const entry = (sites.siteEntry || []).find((s: any) => {
        const url = String(s.siteUrl || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
        return url === host || url.endsWith(`.${host}`);
      });
      if (!entry) {
        attempts.push({ account: name, ok: false, details: `No Search Console access for ${host}. Grant it in Search Console → Settings → Users with ${sa.client_email}.` });
        continue;
      }
      const siteUrl = entry.siteUrl;
      const submitRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT', headers, signal: AbortSignal.timeout(30000) });
      const done = submitRes.ok || submitRes.status === 204;
      attempts.push({
        account: name,
        ok: done,
        details: done
          ? `Sitemap submitted to Search Console for ${siteUrl}`
          : `HTTP ${submitRes.status}: ${String((await submitRes.json().catch(() => ({}))).error?.message || '').slice(0, 120)}`,
      });
      if (done) return { available: true, submitted: true, siteUrl, attempts };
    } catch (error: any) {
      attempts.push({ account: name, ok: false, details: error?.message || 'request failed' });
    }
  }
  return { available: true, submitted: false, attempts };
}

// Instant indexing requests for up to 10 URLs per run (Indexing API daily quota: 200).
async function googleIndexingSubmit(urls: string[]) {
  const accounts = loadServiceAccounts();
  if (!accounts.length) return { available: false, details: 'No Google service account is configured' };
  const picked = urls.slice(0, 10);
  const results: any[] = [];
  for (const { name, sa } of accounts) {
    try {
      const token = await googleApiToken(sa, 'https://www.googleapis.com/auth/indexing');
      for (const url of picked) {
        const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ url, type: 'URL_UPDATED' }),
        });
        const body: any = await res.json().catch(() => ({}));
        results.push({ account: name, url, ok: res.ok, details: res.ok ? `accepted, notifyTime=${body.urlNotificationMetadata?.latestUpdate?.notifyTime || 'queued'}` : `HTTP ${res.status}: ${String(body.error?.message || '').slice(0, 100)}` });
        if (res.ok) break; // one working account is enough per URL
      }
    } catch (error: any) {
      results.push({ account: name, ok: false, details: error?.message || 'request failed' });
    }
  }
  return { available: true, submitted: results.filter(r => r.ok).length, results };
}

// ===== Admin product AI engine: NVIDIA NIM (NVIDIA_API_KEY), LongCat only as fallback =====
const AI_PROVIDER_NAME = 'nvidia';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = process.env.NVIDIA_AI_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';

async function openaiCompatibleComplete(baseUrl: string, apiKey: string, model: string, messages: { role: string; content: string }[], label: string): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.4 }),
    signal: AbortSignal.timeout(120_000),
  });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `${label} request failed (${response.status})`);
  return String(result.choices?.[0]?.message?.content || '').trim();
}

async function longcatComplete(messages: { role: string; content: string }[]): Promise<string> {
  const nvidiaKey = (process.env.NVIDIA_API_KEY || '').trim();
  if (nvidiaKey) {
    try {
      return await openaiCompatibleComplete(NVIDIA_BASE_URL, nvidiaKey, NVIDIA_MODEL, messages, 'NVIDIA NIM');
    } catch (error: any) {
      console.error('NVIDIA NIM request failed, trying LongCat fallback:', error?.message);
    }
  }
  const longcatKey = (process.env.LONGCAT_AI_API_KEY || process.env.LONGCAT_API_KEY || '').trim();
  if (!longcatKey) throw new Error(nvidiaKey ? 'NVIDIA NIM request failed and LongCat is not configured' : 'NVIDIA_API_KEY is not configured in Manus secrets');
  let model = 'LongCat-2.5';
  try {
    const configs = await allRecords('chat_provider_config');
    const cfg = configs.find(c => c.provider_name === 'longcat' && c.is_active !== false);
    if (cfg?.selected_model) model = String(cfg.selected_model);
  } catch { /* optional */ }
  return openaiCompatibleComplete('https://api.longcat.chat/openai/v1', longcatKey, model, messages, 'LongCat');
}

const SITE_BRAND = 'Purely Health Nutra';
const NO_FABRICATION_RULES = `STRICT ACCURACY RULES:
- Use ONLY the factual information the administrator supplied below. Never invent: ingredients, specifications, variety characteristics, plant age, yields, nutritional or medical claims, certifications, prices, stock levels, weights, dimensions, manufacturer details or product origin.
- If a fact is missing, leave that field EMPTY ("") — do not guess.
- Never make medical or health-treatment claims; describe traditional/culinary uses only.
- Write in clear, professional English for a South African audience. Prices are ZAR. Brand is ${SITE_BRAND}. No refunds, no free shipping — never mention discounts that were not supplied.
- The administrator will review and edit everything before publishing.`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

const SCOPE_FIELDS: Record<string, string[]> = {
  all: ['name_suggestion', 'slug', 'short_description', 'description', 'highlights', 'benefits', 'features', 'specifications', 'applications', 'instructions', 'warnings', 'faqs', 'keywords', 'search_tags', 'hashtags', 'primary_keyword', 'secondary_keywords', 'longtail_keywords', 'synonyms', 'alternative_names', 'customer_questions', 'meta_title', 'meta_description', 'geo_title', 'geo_summary', 'ai_questions', 'og_title', 'og_description', 'twitter_title', 'twitter_description', 'social_posts', 'image_alt', 'image_description', 'internal_links', 'related_products'],
  seo: ['primary_keyword', 'secondary_keywords', 'longtail_keywords', 'meta_title', 'meta_description', 'og_title', 'og_description', 'twitter_title', 'twitter_description', 'image_alt', 'image_description'],
  geo: ['geo_title', 'geo_summary', 'ai_questions', 'customer_questions', 'entity_description', 'geo_attributes'],
  keywords: ['keywords', 'search_tags', 'hashtags', 'primary_keyword', 'secondary_keywords', 'longtail_keywords', 'synonyms', 'alternative_names'],
  description: ['short_description', 'description', 'highlights', 'benefits', 'features', 'applications'],
  social: ['social_posts', 'hashtags'],
};

async function generateProductContent(body: any) {
  const scope = String(body.scope || 'all');
  const fields = SCOPE_FIELDS[scope] || SCOPE_FIELDS.all;
  const supplied = body.product || {};
  const adminInput = [
    supplied.name && `Product name: ${supplied.name}`,
    supplied.category_id && `Category: ${supplied.category_id}`,
    supplied.brand && `Brand: ${supplied.brand}`,
    supplied.short_description && `Existing short description: ${supplied.short_description}`,
    supplied.description && `Existing long description (keep its facts): ${String(supplied.description).slice(0, 3000)}`,
    supplied.specifications && `Specifications (verbatim facts): ${JSON.stringify(supplied.specifications).slice(0, 2000)}`,
    supplied.facts && `Administrator-supplied facts (use ONLY these): ${String(supplied.facts).slice(0, 3000)}`,
    supplied.keywords && `Existing keywords: ${supplied.keywords}`,
    supplied.price_zar != null && `Price: R${supplied.price_zar} (never change or invent prices)`,
  ].filter(Boolean).join('\n');
  const system = `You are the product content engine for ${SITE_BRAND} (purelyhealthnutra.company), a South African gut-health live-cultures and dragon fruit specialist store.\n${NO_FABRICATION_RULES}\nGenerate a JSON object with exactly these keys (omit none; empty string "" where information is missing):\n${fields.join(', ')}.\n- keywords/search_tags/hashtags/secondary_keywords/longtail_keywords/synonyms/alternative_names/ai_questions/customer_questions/internal_links/related_products: comma-separated strings.\n- specifications: array of {label, value} (only administrator-supplied facts).\n- faqs: array of {question, answer} grounded only in supplied info.\n- social_posts: object with facebook, instagram, tiktok, linkedin, pinterest, twitter, whatsapp, telegram keys, each a ready-to-post caption with hashtags where appropriate.\n- entity_description: a 2-3 sentence encyclopedic description of what this product IS (for AI answer engines).\n- geo_attributes: array of {label, value} factual attributes.`;
  const user = `Administrator-supplied product information:\n${adminInput || '(nothing supplied yet — generate template scaffolding with empty fact fields and only generic SEO structure)'}\n\nScope: ${scope}. Return ONLY the JSON object.`;
  const text = await longcatComplete([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  const parsed = extractJson(text);
  if (!parsed) throw new Error('LongCat returned content that could not be parsed as JSON — try again');
  return { provider: AI_PROVIDER_NAME, model: NVIDIA_MODEL, scope, fields: fields.length, content: parsed, generated_at: now() };
}

// ===== Product search across names, SKUs, keywords, tags, synonyms, specs =====
const SEARCHABLE_FIELDS = ['name', 'sku', 'short_description', 'description', 'keywords', 'tags', 'hashtags', 'search_tags', 'primary_keyword', 'secondary_keywords', 'longtail_keywords', 'synonyms', 'alternative_names', 'customer_questions', 'brand', 'manufacturer', 'supplier', 'category_id', 'subcategory', 'product_type', 'geo_summary', 'meta_title', 'meta_description'];

async function productSearch(body: any) {
  const q = String(body.q || body.query || '').trim().toLowerCase();
  if (!q) return { results: [], count: 0, query: q };
  const terms = q.split(/\s+/).filter(t => t.length > 1);
  const products = (await allRecords('products')).filter(p => p.is_active !== false);
  const scored = products.map(p => {
    let score = 0;
    for (const field of SEARCHABLE_FIELDS) {
      const value = p[field];
      if (value == null) continue;
      const hay = String(Array.isArray(value) ? value.join(' ') : value).toLowerCase();
      if (!hay) continue;
      if (hay === q) score += 50;
      if (hay.startsWith(q)) score += 20;
      for (const term of terms) {
        if (hay.includes(term)) score += field === 'name' || field === 'sku' ? 10 : 4;
      }
    }
    // spec values are structured
    const specs = Array.isArray(p.specifications) ? p.specifications : [];
    const specHay = specs.map((s: any) => `${s.label || ''} ${s.value || ''}`).join(' ').toLowerCase();
    for (const term of terms) if (term && specHay.includes(term)) score += 3;
    return { p, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return { query: q, count: scored.length, results: scored.slice(0, Number(body.limit || 50)).map(({ p, score }) => ({ id: p.id, name: p.name, slug: p.slug, sku: p.sku, short_description: p.short_description, price_zar: p.price_zar, primary_image_url: p.primary_image_url, category_id: p.category_id, is_active: p.is_active, score })) };
}

async function productDuplicateCheck(body: any) {
  const products = await allRecords('products');
  const excludeId = String(body.excludeId || '');
  const name = String(body.name || '').trim().toLowerCase();
  const desc = String(body.description || body.short_description || '').trim().toLowerCase().slice(0, 200);
  const dupes: any[] = [];
  for (const p of products) {
    if (String(p.id) === excludeId) continue;
    if (name && String(p.name || '').trim().toLowerCase() === name) { dupes.push({ id: p.id, name: p.name, sku: p.sku, reason: 'identical product name' }); continue; }
    if (desc && String(p.short_description || p.description || '').toLowerCase().slice(0, 200) === desc) dupes.push({ id: p.id, name: p.name, sku: p.sku, reason: 'identical description' });
  }
  return { duplicates: dupes, count: dupes.length };
}

// ===== Product Management Dashboard aggregates =====
async function productDashboard() {
  const products = await allRecords('products');
  const socialLog = await allRecords('social_publish_log');
  const missing = (p: any, f: string) => !p[f] || (Array.isArray(p[f]) && !p[f].length) || (typeof p[f] === 'object' && !Array.isArray(p[f]) && !Object.keys(p[f]).length);
  const stats = {
    total: products.length,
    published: products.filter(p => p.is_active === true && p.status !== 'draft').length,
    drafts: products.filter(p => p.status === 'draft' || p.is_active === false).length,
    out_of_stock: products.filter(p => Number(p.stock_quantity || 0) <= 0).length,
    low_stock: products.filter(p => Number(p.stock_quantity || 0) > 0 && Number(p.stock_quantity || 0) <= Number(p.low_stock_threshold || 5)).length,
    missing_seo: products.filter(p => missing(p, 'meta_title') || missing(p, 'meta_description') || missing(p, 'primary_keyword')).length,
    missing_geo: products.filter(p => missing(p, 'geo_title') || missing(p, 'geo_summary')),
    missing_images: products.filter(p => missing(p, 'primary_image_url') && missing(p, 'images')).length,
    missing_keywords: products.filter(p => missing(p, 'keywords') && missing(p, 'tags') && missing(p, 'primary_keyword')).length,
    missing_shipping: products.filter(p => !p.weight_kg || !p.length_cm || !p.width_cm || !p.height_cm).length,
    incomplete_specs: products.filter(p => missing(p, 'specifications')).length,
  };
  const socialAccounts = await allRecords('social_accounts');
  return {
    generated_at: now(),
    ...stats,
    missing_geo: (stats as any).missing_geo.length,
    duplicate_names: (() => { const seen = new Map<string, number>(); products.forEach(p => { const k = String(p.name || '').toLowerCase(); if (k) seen.set(k, (seen.get(k) || 0) + 1); }); return [...seen.values()].filter(n => n > 1).length; })(),
    social_publishing: { accounts: socialAccounts.length, active: socialAccounts.filter(a => a.is_active !== false).length, total_posts: socialLog.length, last_7_days: socialLog.filter(l => Date.now() - new Date(String(l.created_at || 0)).getTime() < 7 * 864e5).length },
    longcat_status: (process.env.NVIDIA_API_KEY) ? 'connected (NVIDIA)' : ((process.env.LONGCAT_AI_API_KEY || process.env.LONGCAT_API_KEY) ? 'fallback: LongCat' : 'missing key'),
  };
}

// ===== Social media accounts, AI post generation and publish log =====
const SOCIAL_PLATFORMS: Record<string, { label: string; share: (url: string, text: string) => string; manual: boolean }> = {
  facebook: { label: 'Facebook', manual: true, share: (u, t) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}&quote=${encodeURIComponent(t.slice(0, 300))}` },
  x: { label: 'X / Twitter', manual: true, share: (u, t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t.slice(0, 260))}&url=${encodeURIComponent(u)}` },
  linkedin: { label: 'LinkedIn', manual: true, share: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
  whatsapp: { label: 'WhatsApp', manual: true, share: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t}\n${u}`)}` },
  telegram: { label: 'Telegram', manual: true, share: (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t.slice(0, 400))}` },
  pinterest: { label: 'Pinterest', manual: true, share: (u, t) => `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(u)}&description=${encodeURIComponent(t.slice(0, 500))}` },
  reddit: { label: 'Reddit', manual: true, share: (u, t) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t.slice(0, 280))}` },
  blogger: { label: 'Blogger', manual: true, share: (u, t) => `https://www.blogger.com/blog-this.g?u=${encodeURIComponent(u)}&n=${encodeURIComponent(t.slice(0, 200))}&t=${encodeURIComponent(t)}` },
  threads: { label: 'Threads', manual: true, share: (u) => `https://www.threads.net/intent/post?text=${encodeURIComponent(u)}` },
  instagram: { label: 'Instagram', manual: true, share: () => `https://www.instagram.com/` },
  tiktok: { label: 'TikTok', manual: true, share: () => `https://www.tiktok.com/upload` },
  youtube: { label: 'YouTube', manual: true, share: () => `https://studio.youtube.com/channel/upload` },
  snapchat: { label: 'Snapchat', manual: true, share: () => `https://www.snapchat.com/` },
  messenger: { label: 'Facebook Messenger', manual: true, share: (u) => `https://www.facebook.com/dialog/send?link=${encodeURIComponent(u)}&app_id=0&redirect_uri=${encodeURIComponent(u)}` },
  google_chat: { label: 'Google Chat', manual: true, share: (u, t) => `https://chat.google.com/?text=${encodeURIComponent(`${t} ${u}`)}` },
  other: { label: 'Other platform', manual: true, share: (u) => u },
};

async function socialGeneratePost(body: any) {
  const platform = String(body.platform || 'facebook').toLowerCase();
  const product = body.product || {};
  const meta = SOCIAL_PLATFORMS[platform] || SOCIAL_PLATFORMS.other;
  const prompts: Record<string, string> = {
    facebook: 'Engaging product announcement post: hook line, short description, key benefits/features, call to action, hashtags, then the product page link.',
    instagram: 'Attractive caption (max 2200 chars): hook, benefits, emojis tasteful, 8-15 relevant hashtags at the end. Mention the link is in bio.',
    tiktok: 'Short punchy video caption (max 150 chars) + 5-8 hashtags.',
    threads: 'Short promotional message (max 480 chars) with hashtags.',
    linkedin: 'Professional business-oriented product announcement, B2B tone, no emoji spam.',
    pinterest: 'Pin title (max 100 chars), pin description with keywords (max 500 chars), hashtags.',
    youtube: 'Video title (max 100 chars), video description with hashtags and product link.',
    reddit: 'Community-friendly, non-spammy product information post: honest title, helpful description, no hard sell.',
    x: 'Short promotional message (max 270 chars) with hashtags and product link.',
    whatsapp: 'Product announcement message with line breaks, product link, light formatting (*bold*).',
    telegram: 'Product announcement message with product link and formatting.',
    blogger: 'A longer SEO-friendly product article (300-500 words) with headings and a link to the product page.',
  };
  const system = `You write social-media post content for ${SITE_BRAND} (purelyhealthnutra.company), a South African gut-health live-cultures and dragon fruit store.\n${NO_FABRICATION_RULES}`;
  const text = await longcatComplete([
    { role: 'system', content: system },
    { role: 'user', content: `Platform: ${meta.label}. Write: ${prompts[platform] || prompts.facebook}\n\nProduct details (use ONLY these facts; do not invent any):\n${JSON.stringify({ name: product.name, short_description: product.short_description, highlights: product.highlights, benefits: product.benefits, price: product.price_zar ? `R${product.price_zar}` : undefined, hashtags: product.hashtags, link: product.slug ? `https://purelyhealthnutra.company/product/${product.slug}` : undefined }).slice(0, 3000)}\n\nReturn ONLY the post text.` },
  ]);
  const productUrl = product.slug ? `https://purelyhealthnutra.company/product/${product.slug}` : (body.url || '');
  return { provider: AI_PROVIDER_NAME, model: NVIDIA_MODEL, platform, label: meta.label, content: text, share_url: meta.share(productUrl, text), image_url: product.primary_image_url || null, manual_publish: meta.manual };
}

async function socialLogPublish(body: any) {
  const entry = {
    product_id: String(body.productId || ''),
    product_name: String(body.productName || ''),
    platform: String(body.platform || ''),
    account_name: String(body.accountName || ''),
    account_url: String(body.accountUrl || ''),
    content: String(body.content || '').slice(0, 6000),
    status: String(body.status || 'manual-published'),
    error: String(body.error || ''),
    post_url: String(body.postUrl || ''),
    published_at: now(),
  };
  const saved = await dataApiInternal('social_publish_log', { operation: 'create', record: entry });
  return saved;
}

// Helper to write a record through the internal data layer without HTTP.
async function dataApiInternal(table: string, body: any) {
  const records = await allRecords(table);
  const id = body.record?.id || newId();
  const existing = records.find(r => r.id === id);
  const next = { ...(existing || {}), ...(body.record || {}), id, updated_at: now() };
  await saveRecord(table, next);
  return { data: next, error: null };
}

// ===== Email settings (SMTP/IMAP) — passwords stay server-side, masked in responses =====
function maskEmailSettings(settings: AppRecord | null) {
  if (!settings) return null;
  const { smtp_password, imap_password, ...safe } = settings;
  return { ...safe, smtp_password_set: Boolean(smtp_password), imap_password_set: Boolean(imap_password) };
}

async function emailSettingsHandler(body: any) {
  const action = String(body.action || 'get');
  const records = await allRecords('email_settings');
  const existing = records[0] || null;
  if (action === 'get') return { settings: maskEmailSettings(existing) };
  if (action === 'save') {
    const update = { ...(body.settings || {}), updated_at: now() };
    if (!update.smtp_password && existing?.smtp_password) update.smtp_password = existing.smtp_password;
    if (!update.imap_password && existing?.imap_password) update.imap_password = existing.imap_password;
    const saved = await dataApiInternal('email_settings', { record: existing ? { id: existing.id, ...update } : update });
    return { settings: maskEmailSettings(saved.data) };
  }
  if (action === 'test-smtp') {
    const s = { ...(existing || {}), ...(body.settings || {}) };
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: s.smtp_host, port: Number(s.smtp_port || 465), secure: String(s.smtp_encryption || 'ssl') === 'ssl', auth: { user: s.smtp_username, pass: s.smtp_password || process.env.SMTP_PASSWORD }, connectionTimeout: 15000 });
    try { await transport.verify(); return { ok: true, detail: 'SMTP connection and authentication verified' }; }
    catch (error: any) { return { ok: false, detail: String(error.message || error).slice(0, 300) }; }
  }
  if (action === 'send-test') {
    const s = { ...(existing || {}), ...(body.settings || {}) };
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: s.smtp_host, port: Number(s.smtp_port || 465), secure: String(s.smtp_encryption || 'ssl') === 'ssl', auth: { user: s.smtp_username, pass: s.smtp_password || process.env.SMTP_PASSWORD }, connectionTimeout: 15000 });
    try {
      await transport.sendMail({ from: `"${s.sender_name || SITE_BRAND}" <${s.sender_email || s.smtp_username}>`, to: String(body.recipient || s.test_recipient || s.default_admin_email || s.smtp_username), subject: `${SITE_BRAND} — SMTP test email`, text: 'This is a test email from your website email configuration. If you receive it, SMTP works.' });
      return { ok: true, detail: 'Test email sent successfully' };
    } catch (error: any) { return { ok: false, detail: String(error.message || error).slice(0, 300) }; }
  }
  if (action === 'test-imap') {
    const s = { ...(existing || {}), ...(body.settings || {}) };
    try {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow({ host: s.imap_host, port: Number(s.imap_port || 993), secure: String(s.imap_encryption || 'ssl') !== 'none', auth: { user: s.imap_username || s.smtp_username, pass: s.imap_password || s.smtp_password }, logger: false });
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try { const box = client.mailbox as any; await client.status('INBOX', { messages: true } as any); var count = box?.exists; } finally { lock.release(); }
      await client.logout();
      return { ok: true, detail: `IMAP connected successfully — INBOX has ${count ?? '?'} messages` };
    } catch (error: any) { return { ok: false, detail: String(error.message || error).slice(0, 300) }; }
  }
  if (action === 'send-order-notification') {
    const s = { ...(existing || {}) };
    if (!s?.smtp_host) return { ok: false, detail: 'SMTP is not configured yet' };
    const order = body.order || {};
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({ host: s.smtp_host, port: Number(s.smtp_port || 465), secure: String(s.smtp_encryption || 'ssl') === 'ssl', auth: { user: s.smtp_username, pass: s.smtp_password }, connectionTimeout: 15000 });
    const money = (v: any) => `R${Number(v || 0).toFixed(2)}`;
    const rows = (order.items || []).map((i: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${i.name}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${money(i.total_price_zar ?? (i.quantity * i.unit_price_zar))}</td></tr>`).join('');
    const from = `"${s.sender_name || SITE_BRAND}" <${s.sender_email || s.smtp_username}>`;
    try {
      // Admin notification
      await transport.sendMail({
        from, to: String(s.default_admin_email || s.smtp_username),
        replyTo: s.reply_to || s.smtp_username,
        subject: `New order ${order.order_number || ''} — ${money(order.total_zar)} (${order.payment_method || 'unpaid'})`,
        html: `<h2 style="color:#4a2c6f">New order received</h2>
<p><b>Order:</b> ${order.order_number} · <b>Customer:</b> ${order.customer_name || order.guest_email || 'guest'} · <b>Payment:</b> ${order.payment_method || '-'} (${order.payment_status || 'pending'})</p>
<table style="border-collapse:collapse">${rows || ''}</table>
<p><b>Total: ${money(order.total_zar)}</b> (shipping ${money(order.shipping_cost_zar)})</p>
<p>Manage it in the admin panel → Orders.</p>`,
      });
      // Customer confirmation (only when an email address is present)
      const customerEmail = String(order.customer_email || order.guest_email || '');
      if (customerEmail) {
        await transport.sendMail({
          from, to: customerEmail, replyTo: s.reply_to || s.smtp_username,
          subject: `Your ${SITE_BRAND} order ${order.order_number} is confirmed`,
          html: `<p>Hi ${order.customer_name || 'there'},</p><p>Thank you for your order <b>${order.order_number}</b>.</p><table style="border-collapse:collapse">${rows || ''}</table><p><b>Total: ${money(order.total_zar)}</b></p><p>We dispatch within 24–48 hours after payment is confirmed. Delivery is via The Courier Guy or PUDO locker pickup. Track it any time at https://purelyhealthnutra.company/order/${order.order_number}</p><p>Questions? Just reply to this email.</p><p>— ${SITE_BRAND}</p>`,
        });
      }
      return { ok: true, detail: `Order notification sent to ${s.default_admin_email || s.smtp_username}${customerEmail ? ` and confirmation to ${customerEmail}` : ''}` };
    } catch (error: any) { return { ok: false, detail: String(error.message || error).slice(0, 300) }; }
  }
  return { error: 'Unknown email settings action' };
}

// ===== Community partnership & sponsorship enquiries (Community page form) =====
async function partnershipEnquiry(body: any) {
  const required = ['full_name', 'email'];
  for (const key of required) {
    if (!String(body[key] || '').trim()) return { ok: false, error: `Missing field: ${key}` };
  }
  const record = {
    id: newId(),
    full_name: String(body.full_name).slice(0, 200),
    organisation: String(body.organisation || '').slice(0, 200),
    email: String(body.email).slice(0, 200),
    phone: String(body.phone || '').slice(0, 60),
    country: String(body.country || '').slice(0, 100),
    category: String(body.category || 'General Enquiry').slice(0, 100),
    project_name: String(body.project_name || '').slice(0, 200),
    project_description: String(body.project_description || '').slice(0, 4000),
    proposed_partnership: String(body.proposed_partnership || '').slice(0, 2000),
    available_resources: String(body.available_resources || '').slice(0, 2000),
    message: String(body.message || '').slice(0, 4000),
    status: 'new',
    created_at: now(),
  };
  await saveRecord('partnership_enquiries', record);
  // Email the admin enquiry mailbox when SMTP is configured.
  try {
    const settings = (await allRecords('email_settings')).find(row => row.id === 'default') || null;
    if (settings?.smtp_host) {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({ host: settings.smtp_host, port: Number(settings.smtp_port || 465), secure: String(settings.smtp_encryption || 'ssl') === 'ssl', auth: { user: settings.smtp_username, pass: settings.smtp_password }, connectionTimeout: 15000 });
      const rows = Object.entries(record).filter(([k]) => !['id', 'status', 'created_at'].includes(k)).map(([k, v]) => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee"><b>${k.replace(/_/g, ' ')}</b></td><td style="padding:4px 10px;border-bottom:1px solid #eee">${String(v).replace(/</g, '&lt;').slice(0, 500) || '-'}</td></tr>`).join('');
      await transport.sendMail({
        from: `"${settings.sender_name || SITE_BRAND}" <${settings.sender_email || settings.smtp_username}>`,
        to: String(settings.default_admin_email || settings.smtp_username),
        replyTo: record.email,
        subject: `Partnership enquiry — ${record.category} — ${record.full_name}`,
        html: `<h2 style="color:#0B3D2E">New partnership / sponsorship enquiry</h2><table style="border-collapse:collapse">${rows}</table>`,
      });
      record.status = 'emailed';
      await saveRecord('partnership_enquiries', record);
    }
  } catch { /* the record is stored even if the email fails */ }
  return { ok: true, message: 'Thank you — your enquiry has been received. We will get back to you.' };
}
// ===== IMAP inbox reader + LongCat AI draft replies (human approval default) =====
async function emailInboxHandler(body: any) {
  const action = String(body.action || 'list');
  const records = await allRecords('email_settings');
  const s = records[0];
  if (!s?.imap_host) return { error: 'IMAP is not configured yet — set up the inbox connection in Email Settings' };
  if (action === 'list') {
    try {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow({ host: s.imap_host, port: Number(s.imap_port || 993), secure: String(s.imap_encryption || 'ssl') !== 'none', auth: { user: s.imap_username || s.smtp_username, pass: s.imap_password }, logger: false });
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const messages: any[] = [];
      try {
        for await (const msg of client.fetch({ uid: `${Math.max(1, 99999999 - Math.min(Number(body.limit || 10), 25))}:*` } as any, { envelope: true, uid: true, internalDate: true })) {
          messages.push({ uid: msg.uid, from: msg.envelope?.from?.[0]?.address || '', from_name: msg.envelope?.from?.[0]?.name || '', subject: msg.envelope?.subject || '', date: msg.internalDate });
        }
      } finally { lock.release(); }
      await client.logout();
      return { messages: messages.reverse(), synced_at: now() };
    } catch (error: any) { return { error: String(error.message || error).slice(0, 300) }; }
  }
  if (action === 'draft-reply') {
    const products = await allRecords('products');
    const catalogue = products.filter(p => p.is_active !== false).slice(0, 40).map(p => ({ name: p.name, sku: p.sku, price: p.price_zar ? `R${p.price_zar}` : undefined, short: p.short_description, stock: p.stock_quantity, url: `https://purelyhealthnutra.company/product/${p.slug}` }));
    const text = await longcatComplete([
      { role: 'system', content: `You are the customer-enquiry assistant for ${SITE_BRAND} (orders@proagrisa.co.za), a South African gut-health live-cultures store. Draft a professional reply email to a customer enquiry. Rules:\n- Use ONLY the product catalogue data provided — never invent prices, stock, medical claims or policies.\n- Prices are ZAR. No refunds, no free shipping. Delivery via The Courier Guy or PUDO lockers, 24-48h dispatch after payment.\n- Keep it concise, friendly and professional. Sign as "${SITE_BRAND} Team".\n- If the question cannot be answered from the data, say what information is still needed.` },
      { role: 'user', content: `Customer email:\nFrom: ${body.from || ''}\nSubject: ${body.subject || ''}\n\n${String(body.body || '').slice(0, 3000)}\n\nProduct catalogue:\n${JSON.stringify(catalogue).slice(0, 6000)}\n\nReturn ONLY the reply email body text.` },
    ]);
    return { draft: text, requires_approval: true, provider: AI_PROVIDER_NAME, model: NVIDIA_MODEL };
  }
  return { error: 'Unknown inbox action' };
}

async function chatMessage(body: any) {
  const userMessage = String(body.message || body.prompt || '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!userMessage) return { reply: 'Please type a question and I will help.', provider: 'none', sources: [] };

  // Retrieval context: knowledgebase + live product catalogue, refreshed every 60s.
  if (!chatContextCache || Date.now() - chatContextCache.at > 60_000) {
    const [kb, products, keywords] = await Promise.all([allRecords('knowledge_base'), allRecords('products'), allRecords('seo_keywords')]);
    chatContextCache = { at: Date.now(), kb, products, keywords };
  }
  const tokens = tokenize(userMessage);
  const kbRows = chatContextCache!.kb
    .filter(r => r.is_active !== false)
    .map(r => ({ r, score: scoreRecord(r, ['title', 'content', 'tags', 'category'], tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const productRows = chatContextCache!.products
    .filter(r => r.is_active !== false)
    .map(r => ({ r, score: scoreRecord(r, ['name', 'short_description', 'keywords', 'tags', 'description'], tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const kbContext = kbRows.map(({ r }) => `[KB] ${r.title}: ${String(r.content || '').slice(0, 600)}`).join('\n');
  const productContext = productRows.map(({ r }) => `[Product] ${r.name} — R${Number(r.price_zar || 0).toFixed(2)} | stock: ${Number(r.stock_quantity || 0)} | https://purelyhealthnutra.company/product/${r.slug}`).join('\n');
  const keywordContext = (chatContextCache as any).keywords
    .map((r: AppRecord) => ({ r, score: scoreRecord(r, ['keyword'], tokens) }))
    .filter((x: any) => x.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5)
    .map(({ r }: any) => `[Keyword] ${r.keyword}${r.last_rank ? ` (measured Google ZA rank: #${r.last_rank})` : ''}`)
    .join('\n');

  const systemPrompt = `You are the Purely Health Nutra store assistant. You help customers with dragon fruit cultivars, gut-health live cultures (kefir, kombucha, spirulina, chlorella), growing guidance, products, ordering, shipping and store policies.
Rules:
- Answer ONLY from the provided context (knowledgebase and product data) plus general cultivation knowledge that does not involve prices, stock or store policy.
- Never invent prices, stock levels, specifications, cultivar facts, or policies. If the context does not contain the answer, say plainly that you are not sure and suggest contacting orders@proagrisa.co.za or WhatsApp +27 83 447 4639.
- All prices are South African Rand (ZAR). Shipping is via The Courier Guy (door-to-door) or PUDO lockers. Orders process within 24-48 hours after payment is confirmed. There are no refunds and no free shipping.
- Keep answers concise and helpful. When recommending products, include the product page link shown in the context.`;

  const contextBlock = [kbContext, productContext, keywordContext].filter(Boolean).join('\n');
  const llmMessages = [
    { role: 'system', content: contextBlock ? `${systemPrompt}\n\nContext:\n${contextBlock}` : systemPrompt },
    ...history.map((m: any) => ({ role: String(m.role || 'user'), content: String(m.content || '').slice(0, 2000) })),
    { role: 'user', content: userMessage },
  ];

  // Provider chain: NVIDIA NIM first (administrator preference), then LongCat,
  // then the platform fallback — always with server-side keys.
  let provider = 'manus';
  let reply = '';
  let nvidiaError: any = null;
  const nvidiaKey = (process.env.NVIDIA_API_KEY || '').trim();
  const longcatKey = (process.env.LONGCAT_AI_API_KEY || process.env.LONGCAT_API_KEY || '').trim();
  let longcatModel = 'LongCat-2.5';
  try {
    const configs = await allRecords('chat_provider_config');
    const cfg = configs.find(c => c.provider_name === 'longcat' && c.is_active !== false);
    if (cfg?.selected_model) longcatModel = String(cfg.selected_model);
  } catch { /* config table optional */ }

  if (nvidiaKey) {
    try {
      reply = await openaiCompatibleComplete(NVIDIA_BASE_URL, nvidiaKey, NVIDIA_MODEL, llmMessages, 'NVIDIA NIM');
      provider = 'nvidia';
    } catch (error: any) {
      nvidiaError = error;
      console.error('NVIDIA NIM chat request failed, trying LongCat fallback:', error?.message);
    }
  }

  if (!reply && longcatKey) {
    provider = 'longcat';
    const response = await fetch('https://api.longcat.chat/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${longcatKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: longcatModel, messages: llmMessages, temperature: 0.4 }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new ProviderError('LongCat', result.error?.message || `LongCat request failed (${response.status})`);
    reply = String(result.choices?.[0]?.message?.content || '').trim();
  }

  if (!reply) {
    if (nvidiaError && !process.env.MANUS_API_URL) throw nvidiaError;
    if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) throw new Error('No chat provider is available');
    if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) throw new Error('No chat provider is available');
    const response = await fetch(`${process.env.MANUS_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MANUS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'default', messages: llmMessages, temperature: 0.4 }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || 'Chat provider request failed');
    reply = String(result.choices?.[0]?.message?.content || '').trim();
  }

  const sources = [
    ...kbRows.map(({ r }) => ({ type: 'knowledge', title: String(r.title || '') })),
    ...productRows.map(({ r }) => ({ type: 'product', title: String(r.name || ''), url: `/product/${r.slug}` })),
  ];
  return { reply, provider, sources };
}


async function sendNotificationToOwner(title: string, content: string) {
  if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) return;
  try {
    await fetch(`${process.env.MANUS_API_URL}/webdevtoken.v1.WebDevService/SendNotification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MANUS_API_KEY}`,
      },
      body: JSON.stringify({
        title: title.slice(0, 1200),
        content: content.slice(0, 20000),
      }),
    });
  } catch (err) {
    console.warn('Failed to send owner notification:', err);
  }
}

function generateTrackingDetails(shippingMethod: string, orderNumber: string, trackingNumber?: string) {
  const method = String(shippingMethod || '').toLowerCase();
  const trackingRef = trackingNumber || `PHN-${orderNumber.replace(/[^A-Za-z0-9]/g, '')}`;
  if (method.includes('pudo')) {
    return {
      carrier: 'PUDO (The Courier Guy)',
      trackingNumber: trackingRef,
      trackingUrl: `https://www.pudo.co.za/track-it.php?tracking_number=${encodeURIComponent(trackingRef)}`,
    };
  }
  return {
    carrier: 'The Courier Guy',
    trackingNumber: trackingRef,
    trackingUrl: `https://portal.thecourierguy.co.za/tracking?tracking_number=${encodeURIComponent(trackingRef)}`,
  };
}

async function handleOrderPaymentSuccess(orderIdOrNumber: string, paymentProvider: string, paymentDetails: any = {}) {
  const orders = await allRecords('orders');
  const order = orders.find((o: any) => o.id === orderIdOrNumber || o.order_number === orderIdOrNumber);
  if (!order) {
    console.warn(`Order not found for payment fulfillment: ${orderIdOrNumber}`);
    return null;
  }
  // Idempotency: never process the same paid order twice.
  if (order.payment_status === 'paid') {
    return { success: true, orderNumber: order.order_number, alreadyProcessed: true };
  }

  // Update order status to paid
  order.payment_status = 'paid';
  order.status = 'processing';
  order.paid_at = now();
  order.payment_provider = paymentProvider;
  order.payment_reference = paymentDetails.reference || paymentDetails.id || null;

  // Reduce stock only when the order is actually paid.
  const orderItemsForStock = (await allRecords('order_items')).filter((item: any) => item.order_id === order.id);
  for (const item of orderItemsForStock) {
    const productRows = await allRecords('products');
    const product = productRows.find((p: any) => String(p.id) === String(item.product_id));
    if (product) {
      const newStock = Math.max(0, Number(product.stock_quantity || 0) - Math.max(1, Number(item.quantity || 1)));
      await saveRecord('products', { ...product, stock_quantity: newStock });
    }
  }

  // Generate carrier tracking
  const tracking = generateTrackingDetails(order.shipping_method, order.order_number, paymentDetails.trackingNumber);
  order.tracking_carrier = tracking.carrier;
  order.tracking_number = tracking.trackingNumber;
  order.tracking_url = tracking.trackingUrl;

  // Book the shipment with the chosen courier automatically and store the waybill.
  let shipmentRecord: any = null;
  try {
    const orderItems = (await allRecords('order_items')).filter((item: any) => item.order_id === order.id);
    const parcel = await cartParcel(orderItems.map((item: any) => ({ productId: item.product_id, quantity: item.quantity })));
    const option = order.shipping_option || {};
    const isPudo = String(option.provider || '').toLowerCase().includes('pudo');
    // A locker-to-locker service requires a destination locker; if the customer
    // never picked one (or it was not stored), switch the booking to PUDO's
    // door-delivery (L2D) equivalent so the address types match the service.
    const optionService = String(option.service || '');
    const bookingService = isPudo && !order.pudo_locker_id && /^L2L/i.test(optionService)
      ? optionService.replace(/^L2L/i, 'L2D')
      : optionService;
    const deliveryContact = {
      name: order.shipping_address?.name || '',
      email: order.guest_email || order.shipping_address?.email || '',
      mobile_number: order.shipping_address?.phone || '',
      phone: order.shipping_address?.phone || '',
    };
    const bookingBody = {
      provider: isPudo ? 'pudo' : 'courier',
      weight: parcel.billableWeight,
      dimensions: parcel.dimensions,
      parcels: (parcel as any).parcels,
      destinationAddress: { ...(order.shipping_address || {}), country: order.shipping_address?.country || 'South Africa', province: order.shipping_address?.province || '' },
      destinationPostalCode: order.shipping_address?.postalCode || '',
      pudoLockerId: order.pudo_locker_id || '',
      deliveryContact,
      serviceLevelCode: isPudo ? bookingService : (courierGuyServiceCode(bookingService) || bookingService || undefined),
      orderId: order.order_number,
    };
    const result = isPudo ? await createPudoShipment(bookingBody) : await createCourierShipment(bookingBody);
    const bookingTracking = String(result.tracking_number || result.reference || result.id || result.trackingNo || '');
    const waybillUrl = String(result.waybill_url || result.waybillUrl || result.label_url || result.sticker_url || result.links?.waybill || '');
    shipmentRecord = {
      id: newId(),
      order_id: order.id,
      order_number: order.order_number,
      provider: isPudo ? 'pudo' : 'courier-guy',
      service: String(option.service || order.shipping_method || 'Standard'),
      shipment_ref: String(result.id || result.shipment_id || ''),
      tracking_number: bookingTracking,
      waybill_url: waybillUrl,
      parcel_weight_kg: parcel.billableWeight,
      parcel_dimensions: parcel.dimensions,
      parcel_count: parcel.parcelCount || 1,
      status: 'booked',
      created_at: now(),
      updated_at: now(),
    };
    await saveRecord('shipments', shipmentRecord);
    if (bookingTracking) {
      order.tracking_number = bookingTracking;
      order.tracking_carrier = isPudo ? 'PUDO' : 'Courier Guy';
      order.tracking_url = waybillUrl || order.tracking_url;
    }
  } catch (error: any) {
    // Booking is non-fatal: the order stays paid and the admin can book or print later.
    order.shipment_booking_error = String(error?.message || 'Shipment booking failed').slice(0, 500);
  }
  await saveRecord('orders', order);

  // Send customer order confirmation email record into outbox/queue
  const customerEmail = order.guest_email || order.shipping_address?.email;
  const customerEmailBody = `Dear ${order.shipping_address?.name || 'Valued Customer'},

Thank you for your order with Purely Health Nutra!
Your payment of R${Number(order.total_zar || 0).toFixed(2)} via ${paymentProvider.toUpperCase()} has been successfully confirmed.

Order Summary:
Order Number: ${order.order_number}
Shipping Method: ${order.shipping_method}
Delivery Address: ${order.shipping_address?.address || ''}, ${order.shipping_address?.city || ''}, ${order.shipping_address?.postalCode || ''}

Shipment & Tracking Information:
Carrier: ${tracking.carrier}
Tracking Reference: ${tracking.trackingNumber}
Live Tracking Link: ${tracking.trackingUrl}
${shipmentRecord?.tracking_number ? `Courier Tracking Number: ${shipmentRecord.tracking_number}${shipmentRecord.waybill_url ? `\nWaybill / Label: ${shipmentRecord.waybill_url}` : ''}` : 'Your courier booking will be confirmed shortly and the waybill will be emailed to you.'}
We are preparing your package for dispatch. You can track your parcel live anytime using the link above.

Warm regards,
Purely Health Nutra Team
www.purelyhealthnutra.company
Healthy Fields Group of Companies`;

  await saveRecord('email_notifications', {
    id: newId(),
    order_id: order.id,
    order_number: order.order_number,
    recipient_type: 'customer',
    recipient_email: customerEmail,
    subject: `Order Confirmed: ${order.order_number} - Tracking Info Attached`,
    body: customerEmailBody,
    tracking_url: tracking.trackingUrl,
    tracking_carrier: tracking.carrier,
    status: 'sent',
    sent_at: now(),
    created_at: now(),
  });

  // Admin Notification Email
  const adminEmailBody = `New Paid Order Received!

Order Number: ${order.order_number}
Total: R${Number(order.total_zar || 0).toFixed(2)}
Payment Gateway: ${paymentProvider.toUpperCase()}
Customer: ${order.shipping_address?.name || 'Customer'} (${customerEmail})
Shipping Method: ${order.shipping_method}
Carrier Tracking: ${tracking.trackingUrl}

Action: Dispatch and fulfillment can proceed in the Admin Panel.`;

  await saveRecord('email_notifications', {
    id: newId(),
    order_id: order.id,
    order_number: order.order_number,
    recipient_type: 'admin',
    recipient_email: process.env.ADMIN_EMAIL || 'admin@proagrisa.co.za',
    subject: `[NEW ORDER] ${order.order_number} - R${Number(order.total_zar || 0).toFixed(2)} (${paymentProvider.toUpperCase()})`,
    body: adminEmailBody,
    tracking_url: tracking.trackingUrl,
    tracking_carrier: tracking.carrier,
    status: 'sent',
    sent_at: now(),
    created_at: now(),
  });

  // Also push instant notification to the Manus project owner
  await sendNotificationToOwner(
    `Purely Health Nutra: Order Paid (${order.order_number})`,
    `Payment of R${Number(order.total_zar || 0).toFixed(2)} confirmed via ${paymentProvider}. Customer: ${customerEmail}. Tracking attached: ${tracking.trackingUrl}`
  );

  // Deliver both emails for real through the configured SMTP account
  // (fire-and-forget so payment processing never waits on mail).
  (async () => {
    try {
      const es = (await allRecords('email_settings'))[0];
      if (!es?.smtp_host) return;
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({ host: es.smtp_host, port: Number(es.smtp_port || 465), secure: String(es.smtp_encryption || 'ssl') === 'ssl', auth: { user: es.smtp_username, pass: es.smtp_password }, connectionTimeout: 15000 });
      const from = `"${es.sender_name || SITE_BRAND}" <${es.sender_email || es.smtp_username}>`;
      const htmlize = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
      if (customerEmail) await transport.sendMail({ from, to: customerEmail, replyTo: es.reply_to || es.smtp_username, subject: `Order Confirmed: ${order.order_number} - Tracking Info Attached`, text: customerEmailBody, html: htmlize(customerEmailBody) });
      await transport.sendMail({ from, to: String(es.default_admin_email || es.smtp_username), replyTo: es.reply_to || es.smtp_username, subject: `[NEW ORDER] ${order.order_number} - R${Number(order.total_zar || 0).toFixed(2)} (${paymentProvider.toUpperCase()})`, text: adminEmailBody, html: htmlize(adminEmailBody) });
    } catch (error: any) {
      console.error('Order email delivery failed (logged for admin):', error?.message);
    }
  })();

  return { success: true, orderNumber: order.order_number, tracking };
}

const WHATSAPP_PHONE_NUMBER_ID = '1433778029810522';
const WHATSAPP_BUSINESS_NUMBER = '+27 73 600 3365';

// Meta WhatsApp Cloud API webhook, fed by the central meta-social-hub
// Cloudflare Worker. Authenticates on the shared site key, dedupes on message
// id, stores every inbound message/status, and queues an AI auto-reply that is
// always delivered through the Worker (the website never holds the token).
function whatsappBridgeKey(): string {
  return String(process.env.WHATSAPP_SITE_KEY || '').trim();
}

async function whatsappSend(payloadBody: unknown): Promise<{ ok: boolean; detail: string }> {
  const siteKey = whatsappBridgeKey();
  if (!siteKey) return { ok: false, detail: 'WHATSAPP_SITE_KEY not configured' };
  try {
    const response = await fetch('https://meta-social-hub.healthyfieldssa.workers.dev/api/whatsapp/send', {
      method: 'POST',
      headers: { 'x-whatsapp-site-key': siteKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: WHATSAPP_BUSINESS_NUMBER, payload: payloadBody }),
      signal: AbortSignal.timeout(20000),
    });
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    return { ok: response.ok, detail: detail || `HTTP ${response.status}` };
  } catch (error: any) {
    return { ok: false, detail: String(error?.message || 'worker request failed') };
  }
}

// Business-hours rule: only 07:00–17:00 SAST (UTC+2) may receive proactive sends.
function whatsappInSendWindow(): boolean {
  const hour = (new Date(Date.now() + 2 * 3600 * 1000)).getUTCHours();
  return hour >= 7 && hour < 17;
}

const WHATSAPP_AI_CONTEXT = `You are the WhatsApp assistant for Purely Health Nutra (purelyhealthnutra.company), part of the Healthy Fields Group.
We sell gut-health products: dragon fruit (pitaya) cuttings of many cultivars, live cultures (milk & water kefir grains, kombucha SCOBYs, yogurt cultures), spirulina and chlorella live algae, fermentation equipment, BioSoil/EM1, consultations and rooting services.
Shipping: PUDO locker network (pick your locker at checkout) and The Courier Guy door-to-door across South Africa; international/export orders are quoted via WhatsApp to head office +27 83 447 4639.
Payments: Yoco, PayFast and PayPal. Currency ZAR.
Policies (strict): NO refunds. NO free shipping — ever. Never promise delivery dates, stock, results or anything you cannot verify.
If unsure, reply exactly: "Can I get back to you?" and nothing else.
For anything a human must handle (complaints, custom orders, after-hours), give head office +27 83 447 4639.
Reply in the customer's language, short, professional, friendly. Sign as "Purely Health Nutra".`;

async function whatsappAiReply(customerText: string, profileName: string): Promise<string> {
  try {
    const message = `${WHATSAPP_AI_CONTEXT}\n\nCustomer name: ${profileName || 'Unknown'}\nCustomer message: ${customerText}\n\nWrite the WhatsApp reply now. Plain text only, no markdown, max 600 characters.`;
    const result = await chatMessage({ message });
    const reply = typeof result === 'string' ? result : String(result?.reply || '');
    return reply.trim().slice(0, 600) || 'Can I get back to you?';
  } catch {
    return 'Can I get back to you?';
  }
}

async function whatsappWebhook(payload: any, req: http.IncomingMessage, rawBodyText: string) {
  // Shared-key authentication from the central bridge worker.
  const siteKey = whatsappBridgeKey();
  const presentedKey = String(req.headers['x-whatsapp-site-key'] || '').trim();
  if (siteKey && presentedKey && presentedKey !== siteKey) {
    await saveRecord('whatsapp_messages', { id: newId(), direction: 'inbound', event_type: 'auth_check', status: 'failed', payload_summary: 'site key mismatch', received_at: now() });
    return { received: false, error: 'WhatsApp site key rejected' };
  }
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
  if (appSecret) {
    const signature = String(req.headers['x-hub-signature-256'] || '');
    const rawBody = rawBodyText;
    if (rawBody) {
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected), b = Buffer.from(signature);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        await saveRecord('whatsapp_messages', { id: newId(), direction: 'inbound', event_type: 'signature_check', status: 'failed', payload_summary: 'signature mismatch', received_at: now() });
        return { received: false, error: 'WhatsApp signature verification failed' };
      }
    }
  }
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const stored: any[] = [];
  const existingIds = new Set((await allRecords('whatsapp_messages')).map((m: any) => String(m.message_id || '')).filter(Boolean));
  for (const entry of entries) {
    for (const change of (entry?.changes || [])) {
      const value = change?.value || {};
      const metadata = value.metadata || {};
      const phoneNumberId = String(metadata.phone_number_id || '');
      for (const msg of (value.messages || [])) {
        const contact = (value.contacts || [])[0] || {};
        const profileName = contact?.profile?.name || '';
        const from = String(msg?.from || contact?.wa_id || '');
        const text = String(msg?.text?.body || msg?.button?.text || msg?.interactive?.button_reply?.title || '');
        const messageId = String(msg?.id || '');
        if (messageId && existingIds.has(messageId)) continue; // dedupe on message id
        const record = {
          id: newId(),
          direction: 'inbound',
          phone_number_id: phoneNumberId,
          from_number: from,
          profile_name: profileName,
          message_id: messageId,
          message_type: String(msg?.type || 'unknown'),
          body: text.slice(0, 2000),
          status: 'received',
          payload_summary: JSON.stringify({ from, type: msg?.type, ts: msg?.timestamp }).slice(0, 500),
          received_at: now(),
        };
        await saveRecord('whatsapp_messages', record);
        stored.push(record);
      }
      for (const st of (value.statuses || [])) {
        await saveRecord('whatsapp_messages', {
          id: newId(), direction: 'status', phone_number_id: String(metadata.phone_number_id || ''),
          message_id: String(st?.id || ''), message_type: 'status',
          status: String(st?.status || ''), payload_summary: JSON.stringify({ id: st?.id, status: st?.status }).slice(0, 500), received_at: now(),
        });
      }
    }
  }
  // Fire-and-forget AI auto-reply, always routed through the central Worker and
  // only sent inside the 07:00–17:00 SAST window; otherwise queued.
  if (stored.length) {
    (async () => {
      try {
        const first = stored[0];
        if (!whatsappInSendWindow()) {
          for (const record of stored) await saveRecord('whatsapp_messages', { id: newId(), direction: 'outbound', message_id: `queued_${record.id}`, from_number: record.from_number, body: record.body.slice(0, 200), status: 'queued', received_at: now() });
          return;
        }
        const replyText = await whatsappAiReply(first.body, first.profile_name);
        const payload = {
          messaging_product: 'whatsapp',
          to: first.from_number,
          type: 'text',
          text: { preview_url: false, body: replyText },
        };
        const result = await whatsappSend(payload);
        for (const record of stored) {
          await saveRecord('whatsapp_messages', {
            id: newId(), direction: 'outbound', message_id: `reply_${record.message_id}`, from_number: record.from_number,
            body: replyText, status: result.ok ? 'sent' : 'failed', payload_summary: result.detail, received_at: now(),
          });
        }
      } catch (error: any) {
        console.warn('WhatsApp auto-reply failed:', error?.message || 'unknown error');
      }
    })();
  }
  return { received: true, messages: stored.length };
}

async function webhookRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!pathname.startsWith('/api/webhooks/')) return false;
  const provider = String(pathname.split('/').pop() || '').toLowerCase();
  // Meta WhatsApp Cloud API webhook verification (GET with hub.challenge).
  if (provider === 'whatsapp' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const mode = String(url.searchParams.get('hub.mode') || '');
    const token = String(url.searchParams.get('hub.verify_token') || '');
    const challenge = String(url.searchParams.get('hub.challenge') || '');
    const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
    if (mode === 'subscribe' && (!expected || token === expected)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
      return true;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return true;
  }
  const body = await readBody(req, 2 * 1024 * 1024);
  const rawBodyText = body.toString('utf8');
  let payload: any = {};
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    // If urlencoded or query-style (e.g. PayFast ITN form data)
    try {
      payload = Object.fromEntries(new URLSearchParams(body.toString('utf8')).entries());
    } catch {
      payload = { raw: body.toString('utf8') };
    }
  }

  if (provider === 'pudo') {
    return json(res, 200, await pudoWebhook(payload));
  }

  if (provider === 'courier-guy') {
    return json(res, 200, await courierGuyWebhook(payload));
  }

  if (provider === 'whatsapp') {
    return json(res, 200, await whatsappWebhook(payload, req, rawBodyText));
  }
  if (provider === 'paypal') {
    const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || '').trim();
    const requiredHeaders = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
    const signatureHeaders = Object.fromEntries(requiredHeaders.map(name => [name, String(req.headers[name] || '')]));
    if (!webhookId || requiredHeaders.some(name => !signatureHeaders[name])) {
      return json(res, 400, { received: false, provider, error: 'PayPal webhook signature headers or webhook ID are missing' });
    }
    try {
      const { base, token } = await paypalToken();
      const verification = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(providerRequestTimeoutMs),
        body: JSON.stringify({
          auth_algo: signatureHeaders['paypal-auth-algo'],
          cert_url: signatureHeaders['paypal-cert-url'],
          transmission_id: signatureHeaders['paypal-transmission-id'],
          transmission_sig: signatureHeaders['paypal-transmission-sig'],
          transmission_time: signatureHeaders['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: payload,
        }),
      });
      const result = await verification.json().catch(() => ({}));
      if (!verification.ok || result.verification_status !== 'SUCCESS') {
        return json(res, 401, { received: false, provider, error: 'PayPal webhook signature verification failed' });
      }
    } catch (error: any) {
      console.warn('PayPal webhook verification error:', error?.message || 'verification request failed');
      return json(res, 503, { received: false, provider, error: 'PayPal webhook verification unavailable' });
    }
  }

  const eventId = String(req.headers['x-event-id'] || req.headers['paypal-transmission-id'] || req.headers['webhook-id'] || crypto.createHash('sha256').update(body).digest('hex'));

  if (provider === 'payfast') {
    // Official ITN security checks per PayFast documentation.
    const pfHost = String(process.env.PAYFAST_MODE || 'sandbox').trim().toLowerCase() === 'live' ? 'www.payfast.co.za' : 'sandbox.payfast.co.za';
    const sigFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'signature') break;
      sigFields[key] = String(value);
    }
    const expectedSig = payfastSignature(sigFields, process.env.PAYFAST_PASSPHRASE);
    if (payload.signature !== expectedSig) {
      await saveRecord('payment_webhook_events', { id: newId(), provider, event_id: eventId, event_type: 'signature_check', order_ref: payload.m_payment_id || '', payment_ref: payload.pf_payment_id || '', status: 'failed', received_at: now() });
      return json(res, 401, { received: false, provider, error: 'PayFast ITN signature verification failed' });
    }
    // Server confirmation request to PayFast validate endpoint.
    const validateStr = Object.entries(sigFields).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, '+')}`).join('&');
    const validateResponse = await fetch(`https://${pfHost}/eng/query/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: validateStr,
      signal: AbortSignal.timeout(providerRequestTimeoutMs),
    });
    const validateText = (await validateResponse.text()).trim();
    if (!(validateResponse.ok && validateText === 'VALID')) {
      await saveRecord('payment_webhook_events', { id: newId(), provider, event_id: eventId, event_type: 'server_confirmation', order_ref: payload.m_payment_id || '', payment_ref: payload.pf_payment_id || '', status: 'failed', received_at: now() });
      return json(res, 401, { received: false, provider, error: 'PayFast server validation failed' });
    }
    // Amount check: ITN amount_gross must match the server-recalculated order total.
    const orderRefForAmount = payload.m_payment_id || payload.custom_str1 || '';
    if (orderRefForAmount && payload.amount_gross !== undefined) {
      try {
        const expectedTotal = await recalcOrderTotal(orderRefForAmount);
        if (Math.abs(expectedTotal - Number(payload.amount_gross)) > 0.01) {
          await saveRecord('payment_webhook_events', { id: newId(), provider, event_id: eventId, event_type: 'amount_check', order_ref: orderRefForAmount, payment_ref: payload.pf_payment_id || '', status: 'failed', received_at: now() });
          return json(res, 401, { received: false, provider, error: 'PayFast ITN amount does not match the order total' });
        }
      } catch {
        // Order not found; normal processing below will also fail to find it.
      }
    }
  }

  if (provider === 'yoco') {
    // Official verification per Yoco docs: Standard Webhooks HMAC-SHA256 signature.
    const webhookSecret = String(process.env.YOCO_WEBHOOK_SECRET || '').trim();
    if (webhookSecret) {
      const webhookId = req.headers['webhook-id'] || '';
      const timestamp = req.headers['webhook-timestamp'] || '';
      const signedContent = `${webhookId}.${timestamp}.${body}`;
      const secretBytes = Buffer.from(webhookSecret.replace(/^whsec_/, ''), 'base64');
      const expectedSignature = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
      const signatures = String(req.headers['webhook-signature'] || '').split(' ');
      const matched = signatures.some(sig => {
        const sigValue = sig.split(',')[1] || '';
        try { return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(sigValue)); } catch { return false; }
      });
      if (!matched) {
        await saveRecord('payment_webhook_events', { id: newId(), provider, event_id: eventId, event_type: 'signature_check', order_ref: payload.payload?.metadata?.orderId || '', payment_ref: payload.payload?.id || '', status: 'failed', received_at: now() });
        return json(res, 401, { received: false, provider, error: 'Yoco webhook signature verification failed' });
      }
    }
  }

  const existingEvents = await allRecords('payment_webhook_events');
  if (existingEvents.some(event => String(event.event_id || '') === eventId)) {
    return json(res, 200, { received: true, provider, processed: false, duplicate: true, eventId });
  }

  // Process order completion based on provider payload
  let orderRef = '';
  let paymentRef = '';
  let eventStatus = 'ignored';
  let eventType = '';
  let resourceId = '';

  if (provider === 'payfast') {
    // PayFast sends m_payment_id and pf_payment_id
    orderRef = payload.m_payment_id || payload.custom_str1 || '';
    paymentRef = payload.pf_payment_id || '';
    eventType = String(payload.payment_status || '');
    eventStatus = eventType === 'COMPLETE' ? 'success' : eventType === 'REFUNDED' ? 'refunded' : ['FAILED', 'CANCELLED'].includes(eventType) ? 'failed' : 'ignored';
  } else if (provider === 'yoco') {
    // Yoco sends event: payment.succeeded or metadata.orderId
    orderRef = payload.payload?.metadata?.orderId || payload.metadata?.orderId || payload.payload?.id || payload.id || '';
    paymentRef = payload.payload?.id || payload.id || '';
    eventType = String(payload.event || '');
    eventStatus = eventType === 'payment.succeeded' ? 'success' : eventType === 'payment.refunded' ? 'refunded' : eventType === 'payment.failed' ? 'failed' : 'ignored';
  } else if (provider === 'paypal') {
    // PayPal sends order, authorization, capture, refund and reversal events.
    const resource = payload.resource || {};
    eventType = String(payload.event_type || '');
    resourceId = String(resource.id || '');
    orderRef = resource.purchase_units?.[0]?.reference_id
      || resource.purchase_units?.[0]?.custom_id
      || resource.custom_id
      || payload.resource?.supplementary_data?.related_ids?.order_id
      || '';
    paymentRef = resource.id || payload.resource?.supplementary_data?.related_ids?.capture_id || '';
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') eventStatus = 'success';
    else if (['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'].includes(eventType)) eventStatus = 'refunded';
    else if (['PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'PAYMENT.AUTHORIZATION.VOIDED', 'CHECKOUT.PAYMENT-APPROVAL.REVERSED'].includes(eventType)) eventStatus = 'failed';
    else if (['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.AUTHORIZATION.CREATED'].includes(eventType)) eventStatus = 'pending';
  }

  // Persist only the event metadata required for audit and deduplication, never the raw PayPal payload.
  await saveRecord('payment_webhook_events', {
    id: newId(), provider, event_id: eventId, event_type: eventType, resource_id: resourceId,
    order_ref: orderRef, payment_ref: paymentRef, status: eventStatus, received_at: now()
  });

  if (orderRef) {
    try {
      if (eventStatus === 'success') {
        await handleOrderPaymentSuccess(orderRef, provider, { reference: paymentRef });
      } else if (eventStatus === 'failed' || eventStatus === 'refunded') {
        const orders = await allRecords('orders');
        const order = orders.find((o: any) => o.id === orderRef || o.order_number === orderRef);
        if (order) {
          order.payment_status = eventStatus;
          if (eventStatus === 'failed') order.status = 'failed';
          if (eventStatus === 'refunded') order.status = 'refunded';
          await saveRecord('orders', order);
        }
      }
    } catch (err) {
      console.warn('Webhook post-processing error:', err);
    }
  }

  return json(res, 200, { received: true, provider, processed: Boolean(orderRef), eventType, eventStatus });
}

async function pudoWebhook(payload: any) {
  const tracking = String(payload.tracking_number || payload.trackingNumber || payload.reference || payload.tracking_no || payload.barcode || '').trim();
  const eventId = String(payload.event_id || payload.id || payload.eventId || `${tracking}:${payload.status || ''}:${payload.timestamp || Date.now()}`);
  const eventType = String(payload.event || payload.event_type || payload.status || payload.status_description || 'update');
  const existing = await allRecords('pudo_webhook_events');
  if (existing.some(event => String(event.event_id || '') === eventId && String(event.tracking_number || '') === tracking)) {
    return { received: true, provider: 'pudo', processed: false, duplicate: true, eventId };
  }
  let shipmentUpdated = false;
  let orderStatus = '';
  if (tracking) {
    const shipments = await allRecords('shipments');
    const shipment = shipments.find(s => String(s.tracking_number || '') === tracking);
    if (shipment) {
      shipment.tracking_status = String(payload.status || payload.status_description || eventType);
      shipment.last_webhook_at = now();
      shipment.last_webhook_event = eventId;
      await saveRecord('shipments', shipment);
      shipmentUpdated = true;
      const statusText = String(payload.status || eventType).toLowerCase();
      const orders = await allRecords('orders');
      const order = orders.find(o => String(o.tracking_number || '') === tracking);
      if (order) {
        if (statusText.includes('deliver')) { order.status = 'delivered'; orderStatus = 'delivered'; }
        else if (statusText.includes('transit') || statusText.includes('collect') || statusText.includes('depart')) { order.status = 'shipped'; orderStatus = 'shipped'; }
        if (orderStatus) await saveRecord('orders', order);
      }
    }
  }
  await saveRecord('pudo_webhook_events', { id: newId(), event_id: eventId, tracking_number: tracking, event_type: eventType, status: String(payload.status || ''), processed: shipmentUpdated, received_at: now() });
  return { received: true, provider: 'pudo', processed: shipmentUpdated, eventId, eventType, orderStatus };
}

// ---- SerpAPI (Google) SEO tools: keyword research, measured rank checking, address autocomplete ----
async function courierGuyWebhook(payload: any) {
  // The Courier Guy webhook subscription pushes shipment events to this endpoint.
  // Payloads vary by topic; accept every common field name defensively.
  const tracking = String(payload.tracking_number || payload.trackingNumber || payload.tracking || payload.waybill || payload.waybill_number || payload.barcode || payload.reference || '').trim();
  const eventId = String(payload.event_id || payload.id || payload.eventId || payload.webhook_id || `${tracking}:${payload.status || ''}:${payload.timestamp || Date.now()}`);
  const eventType = String(payload.topic || payload.event || payload.event_type || payload.status || payload.status_description || payload.note || 'update');
  // Webhook payloads abbreviate provinces (e.g. GP for Gauteng) — normalise before comparing or storing.
  const normaliseRegion = (value: unknown) => {
    const map: Record<string, string> = { GP: 'gauteng', WC: 'western cape', KZN: 'kwazulu-natal', EC: 'eastern cape', FS: 'free state', MP: 'mpumalanga', LP: 'limpopo', NW: 'north west', NC: 'northern cape' };
    const raw = String(value || '').trim().toLowerCase();
    return map[raw.toUpperCase()] || raw;
  };
  const existing = await allRecords('courier_guy_webhook_events').catch(() => [] as AppRecord[]);
  if (existing.some(event => String(event.event_id || '') === eventId && String(event.tracking_number || '') === tracking)) {
    return { received: true, provider: 'courier-guy', processed: false, duplicate: true, eventId };
  }
  let shipmentUpdated = false;
  let orderStatus = '';
  if (tracking) {
      const shipments = await allRecords('shipments');
    // Match by tracking number or the courier's own reference.
    const shipment = shipments.find(s => String(s.tracking_number || '') === tracking || String(s.courier_reference || '') === tracking || String(s.waybill_url || '').includes(tracking));
    if (shipment) {
      // Treat the webhook as a hint only: re-fetch the authoritative state from the
      // documented tracking endpoint (authenticated, by shipment id) before acting.
      let verifiedStatus = '';
      const shipmentRef = String(shipment.shipment_ref || '').trim();
      if (shipmentRef) {
        try {
          const result = await providerJson(`${courierGuyBaseUrl()}/tracking/shipments?include_parcels=false&id=${encodeURIComponent(shipmentRef)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${courierGuyApiKey()}`, Accept: 'application/json' },
          }, 'Courier Guy webhook verification');
          verifiedStatus = String(result.status || result.state || '').trim();
        } catch (error: any) {
          console.warn('Courier Guy webhook verification skipped:', error?.message || 'request failed');
        }
      }
      // Prefer the API-verified status; fall back to the webhook payload only if the API is unreachable.
      shipment.tracking_status = verifiedStatus || String(payload.status || payload.status_description || eventType);
      shipment.last_webhook_at = now();
      shipment.last_webhook_event = eventId;
      if (payload.tracking_url) shipment.tracking_url = String(payload.tracking_url);
      await saveRecord('shipments', shipment);
      shipmentUpdated = true;
      const statusText = String(payload.status || eventType).toLowerCase();
      const orders = await allRecords('orders');
      const order = orders.find(o => String(o.tracking_number || '') === tracking || String(o.id || '') === String(shipment.order_id || ''));
      if (order) {
        if (statusText.includes('deliver')) { order.status = 'delivered'; orderStatus = 'delivered'; }
        else if (statusText.includes('transit') || statusText.includes('collect') || statusText.includes('depart') || statusText.includes('picked up')) { order.status = 'shipped'; orderStatus = 'shipped'; }
        if (orderStatus) await saveRecord('orders', order);
      }
    }
  }
  await saveRecord('courier_guy_webhook_events', { id: newId(), event_id: eventId, tracking_number: tracking, event_type: eventType, status: String(payload.status || ''), region: normaliseRegion(payload.zone || payload.province), processed: shipmentUpdated, received_at: now() }).catch(() => null);
  return { received: true, provider: 'courier-guy', processed: shipmentUpdated, eventId, eventType, orderStatus };
}
async function serpApi(engine: string, params: Record<string, string>) {
  const key = (process.env.GOOGLE_SERP_API || process.env.GOOGLE_SERPAPI || '').trim();
  if (!key) throw new Error('GOOGLE_SERP_API is not configured in Manus secrets');
  const query = new URLSearchParams({ engine, hl: 'en', gl: 'za', api_key: key, ...params });
  const response = await fetch(`https://serpapi.com/search.json?${query}`, { signal: AbortSignal.timeout(providerRequestTimeoutMs) });
  const result = await response.json().catch(() => ({}));
  if (result.error) throw new Error(`SerpAPI: ${result.error}`);
  return result;
}

async function serpKeywordResearch(body: any) {
  const seed = String(body.seed || body.keyword || '').trim();
  if (!seed) throw new Error('Provide a seed keyword');
  const seen = new Set<string>();
  const suggestions: string[] = [];
  const terms = [seed, `${seed} `];
  for (const term of terms) {
    try {
      const result = await serpApi('google_autocomplete', { q: term });
      for (const item of result.suggestions || []) {
        const value = String(item.value || '').trim();
        if (value && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); suggestions.push(value); }
      }
    } catch (error: any) {
      if (suggestions.length === 0 && term === terms[0]) throw error;
    }
  }
  let related: string[] = [];
  try {
    const result = await serpApi('google', { q: seed, num: '10' });
    for (const item of result.related_searches || []) {
      const value = String(item.query || '').trim();
      if (value && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); related.push(value); }
    }
  } catch { /* related searches are optional */ }
  return { seed, suggestions, related, source: 'SerpAPI Google autocomplete + related searches (real data, gl=za)', retrieved_at: new Date().toISOString() };
}

async function serpRankCheck(body: any) {
  const keyword = String(body.keyword || '').trim();
  if (!keyword) throw new Error('Provide a keyword to check');
  const domain = String(body.domain || 'purelyhealthnutra.company').trim();
  const result = await serpApi('google', { q: keyword, num: '100' });
  const organic = result.organic_results || [];
  let position = 0;
  let matchedUrl = '';
  organic.forEach((item: any, index: number) => {
    if (!position && String(item.link || '').includes(domain)) {
      position = index + 1;
      matchedUrl = String(item.link || '');
    }
  });
  const row = {
    id: `kw-${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
    keyword,
    domain,
    source: 'serpapi-measured',
    last_rank: position || null,
    last_checked_url: matchedUrl || null,
    last_checked_at: new Date().toISOString(),
    total_results: Number(result.search_information?.total_results || 0),
  };
  await saveRecord('seo_keywords', row);
  return { ...row, measured: position > 0, note: position ? `Measured: ranks #${position} on Google (South Africa) for "${keyword}"` : `Measured: not in the Google top 100 (South Africa) for "${keyword}". Real SerpAPI data, not an estimate.` };
}

async function addressSuggest(body: any) {
  const q = String(body.q || body.query || '').trim();
  if (q.length < 3) return { suggestions: [] };
  const googleKey = process.env.GOOGLE_API_KEY_2;
  if (googleKey) {
    try {
      // Geocoding API doubles as a suggestion engine: it matches partial
      // addresses and returns clean formatted results (Places New is not
      // enabled for this key's API restrictions).
      const geo = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=za&key=${googleKey}`, { signal: AbortSignal.timeout(8000) });
      if (geo.ok) {
        const geoResult: any = await geo.json();
        const suggestions = (geoResult.results || []).slice(0, 6).map((item: any) => {
          const component = (type: string) => (item.address_components || []).find((c: any) => c.types.includes(type))?.long_name || '';
          return { address: item.formatted_address, postalCode: component('postal_code'), placeId: item.place_id };
        }).filter((s: any) => s.address);
        if (suggestions.length) return { suggestions, source: 'Google Geocoding (ZA)' };
      }
    } catch { /* fall through to SerpAPI */ }
  }
  const result = await serpApi('google_autocomplete', { q });
  const suggestions = (result.suggestions || []).map((item: any) => {
    const value = String(item.value || '');
    const postalMatch = value.match(/\b(\d{4})\b/);
    return { address: value, postalCode: postalMatch ? postalMatch[1] : '' };
  }).filter((s: any) => /\d/.test(s.address));
  return { suggestions, source: 'SerpAPI Google address autocomplete (real Google data, gl=za)' };
}

// Resolves a picked Places suggestion into a clean formatted address + postal code.
async function addressDetails(body: any) {
  const placeId = String(body.placeId || '');
  const addressInput = String(body.address || '');
  const googleKey = process.env.GOOGLE_API_KEY_2;
  if ((!placeId && !addressInput) || !googleKey) return { address: addressInput, city: '', province: '', postalCode: '' };
  try {
    // The Geocoding API resolves both free-text addresses and place IDs into
    // clean components: street address, city, province and postal code.
    const params = new URLSearchParams({ region: 'za', key: googleKey });
    if (placeId) params.set('place_id', placeId); else params.set('address', addressInput);
    const geo = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal: AbortSignal.timeout(8000) });
    if (geo.ok) {
      const geoResult: any = await geo.json();
      const first = (geoResult.results || [])[0];
      if (first) {
        const component = (type: string) => (first.address_components || []).find((c: any) => c.types.includes(type))?.long_name || '';
        return {
          address: first.formatted_address || addressInput,
          city: component('locality') || component('administrative_area_level_2') || '',
          province: component('administrative_area_level_1') || '',
          postalCode: component('postal_code') || '',
        };
      }
    }
    return { address: addressInput, city: '', province: '', postalCode: '' };
  } catch {
    return { address: String(body.address || ''), city: '', province: '', postalCode: '' };
  }
}


async function parseUpload(req: http.IncomingMessage): Promise<{ bucket: string; objectPath: string; file: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    let bucket = 'uploads'; let objectPath = `${newId()}.bin`; let file = Buffer.alloc(0); let mime = contentType;
    busboy.on('field', (name, value) => { if (name === 'bucket') bucket = value; if (name === 'path') objectPath = value; });
    busboy.on('file', (_name, stream, info) => { mime = info.mimeType; const chunks: Buffer[] = []; stream.on('data', chunk => chunks.push(Buffer.from(chunk))); stream.on('limit', () => reject(new Error('Upload is too large'))); stream.on('end', () => { file = Buffer.concat(chunks); }); });
    busboy.on('finish', () => resolve({ bucket, objectPath, file, contentType: mime }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

async function processImageUpload(file: Buffer, objectPath: string, contentType: string) {
  if (!contentType.startsWith('image/')) return { file, objectPath, contentType, fingerprint: crypto.createHash('sha256').update(file).digest('hex') };
  const sourceFingerprint = crypto.createHash('sha256').update(file).digest('hex');
  const watermark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="232" fill="#0B3D2E" fill-opacity="0.82"/><circle cx="256" cy="256" r="190" fill="none" stroke="#F4B942" stroke-width="12"/><path d="M126 294c24-92 89-145 181-162 5 73-22 134-74 171-36 26-73 31-107 25Z" fill="#8FCB9B"/><path d="M139 327c51-48 105-88 165-120" fill="none" stroke="#FFF7EC" stroke-linecap="round" stroke-width="14"/><text x="256" y="392" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="66" font-weight="800" letter-spacing="-4" fill="#FFF7EC">PHN</text></svg>`);
  const image = sharp(file, { failOn: 'none' });
  const metadata = await image.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const maxDimension = 2400;
  const resized = width > maxDimension || height > maxDimension
    ? image.resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    : image;
  const stampSize = Math.max(96, Math.min(240, Math.round(Math.min(width, height) * 0.18)));
  const processed = await resized
    .composite([{ input: await sharp(watermark).resize(stampSize, stampSize).png().toBuffer(), gravity: 'southwest', blend: 'over' }])
    .webp({ quality: 88, effort: 5, smartSubsample: true })
    .withMetadata({ orientation: undefined })
    .toBuffer();
  const fingerprint = crypto.createHash('sha256').update(processed).digest('hex');
  const base = objectPath.replace(/\.[^.\/]+$/, '').replace(/[^A-Za-z0-9/_=.~-]/g, '_');
  return { file: processed, objectPath: `${base}.${fingerprint.slice(0, 16)}.webp`, contentType: 'image/webp', fingerprint, sourceFingerprint };
}

async function storageRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'DELETE') return json(res, 200, { ok: true, softDeleted: true });
  const upload = await parseUpload(req);
  const processed = await processImageUpload(upload.file, upload.objectPath, upload.contentType);
  const key = `${upload.bucket}/${processed.objectPath}`.replace(/[^A-Za-z0-9/_=.~-]/g, '_');
  if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) return json(res, 503, { error: 'Manus storage is not available' });
  const presign = await fetch(`${process.env.MANUS_API_URL}/v1/storage/presign/put?path=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${process.env.MANUS_API_KEY}` } });
  const signed = await presign.json().catch(() => ({}));
  if (!presign.ok || !signed.url) return json(res, 502, { error: signed.error || 'Unable to prepare managed storage upload' });
  const put = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': processed.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }, body: processed.file });
  if (!put.ok) return json(res, 502, { error: 'Managed storage upload failed' });
  return json(res, 200, { data: { path: key, publicUrl: `/manus-storage/${key}`, fingerprint: processed.fingerprint, sourceFingerprint: processed.sourceFingerprint || processed.fingerprint, processed: processed.contentType === 'image/webp' } });
}

let routeManifest: { path: string; title?: string }[] = [];
async function loadRouteManifest() {
  try {
    const raw = await fs.readFile(path.join(distDir, 'manus-routes.json'), 'utf8');
    const parsed = JSON.parse(raw);
    routeManifest = Array.isArray(parsed?.routes) ? parsed.routes : [];
  } catch { routeManifest = []; }
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
  let injectedProduct: any = null;
  let injectedSlug = '';
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
  const target = path.resolve(distDir, relative);
  if (!target.startsWith(distDir)) return json(res, 400, { error: 'Invalid path' });
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('not file');
    const content = await fs.readFile(target);
    const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : target.endsWith('.css') ? 'text/css; charset=utf-8' : target.endsWith('.json') ? 'application/json; charset=utf-8' : target.endsWith('.webmanifest') ? 'application/manifest+json; charset=utf-8' : target.endsWith('.svg') ? 'image/svg+xml' : target.endsWith('.ico') ? 'image/x-icon' : target.endsWith('.png') ? 'image/png' : target.endsWith('.jpg') || target.endsWith('.jpeg') ? 'image/jpeg' : target.endsWith('.webp') ? 'image/webp' : undefined;
    res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': target.endsWith('.html') || target.endsWith('manus-routes.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(content);
  } catch {
    const index = await fs.readFile(path.join(distDir, 'index.html')).catch(() => null);
    if (!index) return json(res, 404, { error: 'Not found' });
    // Soft-404 guard: unknown paths must return HTTP 404 so search engines never
    // index placeholder shells. Known SPA routes and valid product slugs still return 200.
    if (requestPath !== '/' && !requestPath.startsWith('/assets/') && !requestPath.startsWith('/manus-storage/')) {
      const known = new Set(routeManifest.map(r => String(r.path)));
      const segments = requestPath.split('/').filter(Boolean);
      const matches = (routePath: string) => {
        const parts = routePath.split('/').filter(Boolean);
        if (parts.length !== segments.length) return false;
        return parts.every((part, i) => part.startsWith(':') || part === segments[i]);
      };
      const productSlugMatch = requestPath.match(/^\/product\/([a-z0-9-]+)\/?$/i);
      if (productSlugMatch) {
        const slug = productSlugMatch[1].toLowerCase();
        const products = await allRecords('products').catch(() => [] as AppRecord[]);
        const product: any = products.find(p => String(p.slug || '').toLowerCase() === slug && p.is_active !== false);
        injectedProduct = product || null;
        injectedSlug = slug;
        if (!product) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end('<!doctype html><html><head><meta name="robots" content="noindex"><title>404 — Page not found | Purely Health Nutra</title></head><body style="font-family:sans-serif;text-align:center;padding:80px 20px"><h1>404</h1><p>This product or page could not be found.</p><p><a href="/">Return to Purely Health Nutra</a></p></body></html>');
          return;
        }
      } else if (!Array.from(known).some(matches)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end('<!doctype html><html><head><meta name="robots" content="noindex"><title>404 — Page not found | Purely Health Nutra</title></head><body style="font-family:sans-serif;text-align:center;padding:80px 20px"><h1>404</h1><p>This page could not be found.</p><p><a href="/">Return to Purely Health Nutra</a></p></body></html>');
        return;
      }
    }
    let html = String(index);
    // Server-side SEO injection: per-product title, description, canonical, OG tags and
    // Product JSON-LD so crawlers that do not execute JavaScript get complete metadata.
    if (injectedProduct) {
      const origin = 'https://purelyhealthnutra.company';
      const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const pTitle = String(injectedProduct.meta_title || injectedProduct.name || 'Product');
      const pDesc = String(injectedProduct.meta_description || injectedProduct.short_description || '').slice(0, 300);
      const pUrl = `${origin}/product/${injectedSlug}`;
      const pImage = String(injectedProduct.primary_image_url || injectedProduct.image_url || '');
      const pPrice = Number(injectedProduct.sale_price || injectedProduct.price_zar || injectedProduct.price || 0);
      const ld: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: injectedProduct.name,
        sku: String(injectedProduct.sku || injectedProduct.id),
        description: String(injectedProduct.short_description || injectedProduct.description || '').slice(0, 300),
        brand: { '@type': 'Brand', name: String(injectedProduct.brand || 'Purely Health Nutra') },
        ...(pImage ? { image: [pImage.startsWith('http') ? pImage : origin + pImage] } : {}),
        ...(pPrice > 0 ? { offers: { '@type': 'Offer', url: pUrl, priceCurrency: 'ZAR', price: pPrice.toFixed(2), availability: `https://schema.org/${Number(injectedProduct.stock_quantity ?? 0) > 0 ? 'InStock' : 'OutOfStock'}`, itemCondition: 'https://schema.org/NewCondition' } } : {}),
      };
      const pKeywords = [injectedProduct.primary_keyword, injectedProduct.keywords, injectedProduct.secondary_keywords, injectedProduct.search_tags, injectedProduct.related_phrases, injectedProduct.long_tail_keywords]
        .flatMap((v: unknown) => String(v ?? '').split(','))
        .map((k: string) => k.trim())
        .filter(Boolean);
      const pHashtags = String(injectedProduct.hashtags || '').split(/[\s,]+/).map((h: string) => h.trim()).filter((h: string) => h.startsWith('#'));
      if (pKeywords.length) ld.keywords = [...new Set(pKeywords)].slice(0, 20).join(', ');
      if (pHashtags.length) ld.additionalProperty = pHashtags.slice(0, 15).map((h: string) => ({ '@type': 'PropertyValue', name: 'hashtag', value: h }));
      const pAiTitle = String(injectedProduct.ai_search_title || '');
      const pAiSummary = String(injectedProduct.ai_search_summary || '');
      html = html.replace(/<title>.*?<\/title>/, `<title>${esc(pTitle)}</title>`);
      html = html.replace(/<head([^>]*)>/i, `<head$1>
<meta name="description" content="${esc(pDesc)}">
<meta name="keywords" content="${esc([...new Set(pKeywords)].slice(0, 20).join(', '))}">
<link rel="canonical" href="${pUrl}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(pTitle)}">
<meta property="og:description" content="${esc(pDesc)}">
<meta property="og:url" content="${pUrl}">
<meta property="product:brand" content="${esc(injectedProduct.brand || 'Purely Health Nutra')}">
<meta property="product:availability" content="${Number(injectedProduct.stock_quantity ?? 0) > 0 ? 'in stock' : 'out of stock'}">
<meta property="product:condition" content="new">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(pTitle)}">
<meta name="twitter:description" content="${esc(pDesc)}">${pAiTitle ? `
<meta name="ai:title" content="${esc(pAiTitle)}">` : ''}${pAiSummary ? `
<meta name="ai:summary" content="${esc(pAiSummary)}">` : ''}${pHashtags.length ? `
<meta property="article:tag" content="${esc(pHashtags.join(' '))}">` : ''}${pImage ? `
<meta property="og:image" content="${esc(pImage.startsWith('http') ? pImage : origin + pImage)}">
<meta name="twitter:image" content="${esc(pImage.startsWith('http') ? pImage : origin + pImage)}">` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  }
}

async function createApp() {
  await fs.mkdir(storageDir, { recursive: true });
  await bootstrapAdminUser();
  await loadRouteManifest();
  const production = process.env.NODE_ENV === 'production' || fsSync.existsSync(path.join(distDir, 'index.html'));
  let vite: ViteDevServer | null = null;
  if (!production) vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      const pathname = requestUrl.pathname;
      if (pathname === '/health' || pathname === '/api/health') return json(res, 200, { ok: true, platform: 'manus', database: Boolean(pool) });
      if (pathname === '/api/health/paypal-webhook') return json(res, 200, { ok: true, listener: 'paypal-webhook', method: req.method, timestamp: now() });
      if (pathname === '/api/data' && req.method === 'POST') return json(res, 200, await dataRequest(await readJson(req)));
      if (pathname.startsWith('/') && pathname.endsWith('.txt') && pathname.length < 80) {
        const key = await indexNowKey();
        if (pathname === `/${key}.txt`) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
          return res.end(key);
        }
      }
      const authHandled = await authRequest(req, res, pathname); if (authHandled !== false) return;
      const functionHandled = await functionRequest(req, res, pathname); if (functionHandled !== false) return;
      const webhookHandled = await webhookRequest(req, res, pathname); if (webhookHandled !== false) return;
      if (pathname === '/api/storage' && (req.method === 'POST' || req.method === 'DELETE')) return storageRequest(req, res);
      if (pathname === '/manus-routes.json') {
        const routes = await fs.readFile(path.join(root, 'public/manus-routes.json'));
        return json(res, 200, JSON.parse(routes.toString('utf8')));
      }
      if (pathname === '/sitemap.xml') {
        const origin = 'https://purelyhealthnutra.company';
        const escapeXml = (value: string) => value.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
        const urls = [
          { loc: `${origin}/`, lastmod: now(), changefreq: 'daily', priority: '1.0' },
          { loc: `${origin}/products`, lastmod: now(), changefreq: 'daily', priority: '0.9' },
        ];
        if (pool) {
          try {
            const categories = await allRecords('categories');
            for (const category of categories) {
              if (!category.slug) continue;
              urls.push({ loc: `${origin}/products?category=${category.slug}`, lastmod: now(), changefreq: 'daily', priority: '0.9' });
            }
          } catch (error) {
            console.warn('Sitemap category query failed:', (error as Error).message);
          }
          try {
            const products = await allRecords('products');
            for (const product of products) {
              if (!product.slug || product.is_active === false) continue;
              urls.push({ loc: `${origin}/product/${product.slug}`, lastmod: product.updated_at || product.created_at || now(), changefreq: 'weekly', priority: '0.8' });
            }
          } catch (error) {
            console.warn('Sitemap product query failed:', (error as Error).message);
          }
          try {
            const posts = await allRecords('blog_posts');
            for (const post of posts) {
              if (!post.slug || post.is_published === false) continue;
              urls.push({ loc: `${origin}/blog/${post.slug}`, lastmod: post.updated_at || post.published_at || post.created_at || now(), changefreq: 'weekly', priority: '0.7' });
            }
          } catch (error) {
            console.warn('Sitemap blog query failed:', (error as Error).message);
          }
        }
        // Static pages: blog index, learn guides, hub pages, legal pages.
        const staticPaths = [
          { path: '/blog', changefreq: 'daily', priority: '0.8' },
          { path: '/learn/gut-health-guide', changefreq: 'monthly', priority: '0.7' },
          { path: '/learn/fermentation-guide', changefreq: 'monthly', priority: '0.7' },
          { path: '/learn/algae-guide', changefreq: 'monthly', priority: '0.7' },
          { path: '/learn/farming-em1-guide', changefreq: 'monthly', priority: '0.6' },
          { path: '/learn/for-practitioners', changefreq: 'monthly', priority: '0.6' },
          { path: '/kefir-grains', changefreq: 'monthly', priority: '0.6' },
          { path: '/kombucha', changefreq: 'monthly', priority: '0.6' },
          { path: '/sauerkraut', changefreq: 'monthly', priority: '0.6' },
          { path: '/spirulina-farming', changefreq: 'monthly', priority: '0.6' },
          { path: '/natural-probiotics', changefreq: 'monthly', priority: '0.6' },
          { path: '/diatomaceous-earth', changefreq: 'monthly', priority: '0.6' },
          { path: '/natural-sugar', changefreq: 'monthly', priority: '0.6' },
          { path: '/sourdough-starter', changefreq: 'monthly', priority: '0.6' },
          { path: '/vinegar-starter-culture', changefreq: 'monthly', priority: '0.6' },
          { path: '/about', changefreq: 'monthly', priority: '0.5' },
          { path: '/contact', changefreq: 'monthly', priority: '0.5' },
          { path: '/community', changefreq: 'monthly', priority: '0.7' },
          { path: '/consultations', changefreq: 'monthly', priority: '0.6' },
          { path: '/rooting-services', changefreq: 'monthly', priority: '0.6' },
          { path: '/business-resources', changefreq: 'monthly', priority: '0.6' },
          { path: '/directory', changefreq: 'weekly', priority: '0.6' },
          { path: '/legal/terms-of-service', changefreq: 'yearly', priority: '0.3' },
          { path: '/legal/privacy-policy', changefreq: 'yearly', priority: '0.3' },
          { path: '/legal/cookie-policy', changefreq: 'yearly', priority: '0.3' },
          { path: '/legal/community-guidelines', changefreq: 'yearly', priority: '0.3' },
          { path: '/legal/copyright-policy', changefreq: 'yearly', priority: '0.3' },
          { path: '/legal/facebook-data-deletion', changefreq: 'yearly', priority: '0.3' },
        ];
        for (const item of staticPaths) {
          urls.push({ loc: `${origin}${item.path}`, lastmod: now(), changefreq: item.changefreq, priority: item.priority });
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(item => `  <url><loc>${escapeXml(item.loc)}</loc><lastmod>${new Date(item.lastmod).toISOString()}</lastmod><changefreq>${item.changefreq}</changefreq><priority>${item.priority}</priority></url>`).join('\n')}\n</urlset>`;
        return res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' }), res.end(xml);
      }
      if (pathname === '/feeds/google-shopping.xml') {
        // Google Merchant Center product feed (RSS 2.0 with g: namespace), built live from published products.
        const origin = 'https://purelyhealthnutra.company';
        const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, c => { if (c === String.fromCharCode(60)) return String.fromCharCode(38, 108, 116, 59); if (c === String.fromCharCode(62)) return String.fromCharCode(38, 103, 116, 59); if (c === String.fromCharCode(38)) return String.fromCharCode(38, 97, 109, 112, 59); if (c === String.fromCharCode(39)) return String.fromCharCode(38, 35, 51, 57, 59); return String.fromCharCode(38, 35, 51, 52, 59); });
        const stripHtml = (value: string) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const items: string[] = [];
        if (pool) {
          try {
            const products = await allRecords('products');
            for (const product of products) {
              if (!product.slug || product.is_active === false) continue;
              const image = product.primary_image_url || product.image_url || '';
              // Google requires an image link: fall back to the brand social image
              // until the owner uploads the product's own photos.
              const resolvedImage = image ? (image.startsWith('http') ? image : origin + image) : `${origin}/og-image.jpg`;
              const price = Number(product.sale_price || product.price_zar || product.price || 0);
              if (!(price > 0)) continue;
              const description = stripHtml(product.short_description || product.meta_description || product.description).slice(0, 5000);
              if (!description) continue;
              const stock = Number(product.stock_quantity ?? 0);
              items.push([
                '    <item>',
                `      <title>${escapeXml(stripHtml(product.name).slice(0, 150))}</title>`,
                `      <link>${origin}/product/${product.slug}</link>`,
                `      <description>${escapeXml(description)}</description>`,
                `      <g:id>${escapeXml(String(product.sku || product.id))}</g:id>`,
                `      <g:condition>new</g:condition>`,
                `      <g:availability>${stock > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>`,
                `      <g:price>${price.toFixed(2)} ZAR</g:price>`,
                `      <g:brand>Purely Health Nutra</g:brand>`,
                `      <g:image_link>${escapeXml(resolvedImage)}</g:image_link>`,
                `      <g:identifier_exists>no</g:identifier_exists>`,
                '    </item>',
              ].join('\n'));
            }
          } catch (error) {
            console.warn('Google Shopping feed query failed:', (error as Error).message);
          }
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>Purely Health Nutra — Product Feed</title>\n    <link>${origin}</link>\n    <description>Live product feed for Google Merchant Center</description>\n${items.join('\n')}\n  </channel>\n</rss>`;
        return res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }), res.end(xml);
      }
      if (vite) return vite.middlewares(req, res, () => json(res, 404, { error: 'Not found' }));
      return serveStatic(req, res);
    } catch (error: any) {
      return json(res, 500, { error: error?.message || 'Internal server error' });
    }
  });
  server.listen(port, '0.0.0.0', () => console.log(`Manus server listening on ${port}`));
}

createApp().catch(error => { console.error('Unable to start Manus server', error); process.exit(1); });
