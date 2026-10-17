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
const providerRequestTimeoutMs = 3000;
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

function projectRows(rows: AppRecord[], columns: string) {
  if (!columns || columns === '*' || columns.includes('(*)')) return rows;
  const requested = columns.split(',').map(column => column.trim()).filter(Boolean).filter(column => !column.includes('('));
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
    const projected = projectRows(rows, columns);
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
    return { data: returnsRows || columns !== '*' ? projectRows(saved, columns) : saved, error: null };
  }
  if (operation === 'update') {
    const matches = filterRows(rows, filters);
    const saved: AppRecord[] = [];
    for (const row of matches) saved.push(await saveRecord(table, { ...row, ...(payload || {}), updated_at: now() }));
    return { data: returnsRows ? projectRows(saved, columns) : null, error: null };
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
  return { id: row.id, email: row.email, user_metadata: { full_name: row.full_name || null } };
}
type UserLike = { id: string; email?: string; user_metadata?: Record<string, unknown> };

async function findUserById(id: string) { return (await allRecords('auth_users')).find(row => row.id === id); }
async function bootstrapAdminUser() {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!pool || !password) return;

  const email = String(process.env.ADMIN_EMAIL || 'admin@proagrisa.co.za').trim().toLowerCase();
  const users = await allRecords('auth_users');
  let user = users.find(row => row.email === email);
  if (!user) {
    user = { id: newId(), email, password_hash: hashPassword(password), full_name: 'Purely Health Nutra Admin', created_at: now() };
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
      user = { id: newId(), email, password_hash: hashPassword(password), full_name: body.fullName || null, created_at: now() };
      await saveRecord('auth_users', user);
    } else if (!user || !verifyPassword(password, user.password_hash)) {
      return json(res, 401, { error: 'Invalid email or password' });
    }
    const session = await createSession(user);
    return json(res, 200, { user: session.user, session }, { 'Set-Cookie': sessionCookie(session.id) });
  }
  return false;
}

async function paymentConfig() {
  const configured = (keys: string[]) => keys.every(key => Boolean(process.env[key]));
  return {
    payfast: { configured: configured(['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY']), mode: process.env.PAYFAST_MODE || 'sandbox', required: ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_SECURITY_PASSPHRASE'] },
    yoco: { configured: configured(['YOCO_API_KEY']), mode: process.env.YOCO_MODE || 'test', required: ['YOCO_API_KEY'] },
    paypal: { configured: configured(['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET_KEY_1']), mode: process.env.PAYPAL_MODE || 'sandbox', required: ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET_KEY_1'] },
    courierGuy: { configured: Boolean(process.env.COURIER_GUY_API_KEY || process.env.THE_COURIER_GUY_API), mode: process.env.COURIER_GUY_MODE || 'live', required: ['THE_COURIER_GUY_API', 'COURIER_GUY_COLLECTION_ADDRESS_JSON'] },
    pudo: { configured: Boolean(process.env.PUDO_API_KEY || process.env.PUDO_SHIPPING_API), mode: process.env.PUDO_MODE || 'live', required: ['PUDO_SHIPPING_API', 'PUDO_COLLECTION_ADDRESS_JSON'] },
  };
}

function payfastSignature(fields: Record<string, string>, passphrase?: string) {
  const encoded = Object.entries(fields).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`).join('&');
  return crypto.createHash('md5').update(passphrase ? `${encoded}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}` : encoded).digest('hex');
}

async function initiatePayFast(body: any) {
  if (!process.env.PAYFAST_MERCHANT_ID || !process.env.PAYFAST_MERCHANT_KEY) throw new Error('PayFast is not configured in Manus secrets');
  const fields: Record<string, string> = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY,
    return_url: String(body.returnUrl || ''),
    cancel_url: String(body.cancelUrl || ''),
    notify_url: `${body.origin || ''}/api/webhooks/payfast`,
    name_first: String(body.customerName || '').split(' ')[0] || 'Customer',
    email_address: String(body.customerEmail || ''),
    m_payment_id: String(body.orderId || ''),
    amount: Number(body.amount || 0).toFixed(2),
    item_name: String(body.itemName || 'Purely Health Nutra order'),
  };
  fields.signature = payfastSignature(fields, process.env.PAYFAST_SECURITY_PASSPHRASE);
  return { success: true, actionUrl: process.env.PAYFAST_MODE === 'live' ? 'https://www.payfast.co.za/eng/process' : 'https://sandbox.payfast.co.za/eng/process', formFields: fields };
}

async function initiateYoco(body: any) {
  if (!process.env.YOCO_API_KEY) throw new Error('Yoco is not configured in Manus secrets');
  const endpoint = 'https://payments.yoco.com/api/checkouts';
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${process.env.YOCO_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.round(Number(body.amount || 0) * 100), currency: body.currency || 'ZAR', successUrl: body.successUrl, cancelUrl: body.cancelUrl, metadata: { orderId: body.orderId } }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || 'Yoco checkout creation failed');
  return { success: true, redirectUrl: result.redirectUrl || result.redirect_url, checkoutId: result.id };
}

async function paypalToken() {
  const base = (process.env.PAYPAL_MODE || 'sandbox') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET_KEY_1}`).toString('base64');
  const response = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error_description || 'PayPal authentication failed');
  return { base, token: result.access_token };
}

async function initiatePayPal(body: any) {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET_KEY_1) throw new Error('PayPal is not configured in Manus secrets');
  const { base, token } = await paypalToken();
  const response = await fetch(`${base}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': String(body.orderId || newId()) }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: String(body.orderId || ''), amount: { currency_code: body.currency || 'USD', value: Number(body.amount || 0).toFixed(2) } }], application_context: { return_url: body.successUrl, cancel_url: body.cancelUrl } }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || 'PayPal order creation failed');
  return { success: true, orderId: result.id, approvalUrl: result.links?.find((link: any) => link.rel === 'approve')?.href, status: result.status };
}

function configured(keys: string[]) { return keys.every(key => Boolean(process.env[key])); }
function courierGuyApiKey() { return String(process.env.COURIER_GUY_API_KEY || process.env.THE_COURIER_GUY_API || '').trim(); }
function pudoApiKey() { return String(process.env.PUDO_API_KEY || process.env.PUDO_SHIPPING_API || '').trim(); }
function pudoBaseUrl() {
  const configured = String(process.env.PUDO_BASE_URL || '').replace(/\/+$/, '');
  if (!configured || configured === 'https://api-tcg.co.za' || configured === 'https://api-pudo.co.za') return 'https://api.shiplogic.com';
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
  const configuredAddress = configuredJson(provider === 'courier' ? 'COURIER_GUY_COLLECTION_ADDRESS_JSON' : 'PUDO_COLLECTION_ADDRESS_JSON');
  const address = configuredAddress || body.collectionAddress;
  if (!address) throw new Error(`${provider === 'courier' ? 'Courier Guy' : 'PUDO'} collection address is not configured in Manus secrets`);
  return checkoutAddress(address);
}
function collectionContact(body: any) {
  return configuredJson('TCG_COLLECTION_CONTACT_JSON') || body.collectionContact || undefined;
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
  return { provider, service: String(service), price: Number.isFinite(price) ? price : 0, estimatedDays: deliveryDate ? `By ${deliveryDate}` : 'Live quote', description: item.service_level_name || serviceLevel.name || item.name || 'Live API shipping quote' };
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
    collection_address: collectionAddress('courier', body),
    delivery_address: checkoutAddress(body.destinationAddress, body.destinationPostalCode),
    parcels: [parcelFromBody(body)],
    ...(process.env.COURIER_GUY_ACCOUNT_CODE ? { provider_id: process.env.COURIER_GUY_ACCOUNT_CODE } : {}),
  };
  const result = await providerJson(`${process.env.COURIER_GUY_BASE_URL || 'https://api.shiplogic.com'}/rates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(process.env.COURIER_GUY_ACCOUNT_CODE ? { 'X-Account-Code': process.env.COURIER_GUY_ACCOUNT_CODE } : {}) },
    body: JSON.stringify(payload),
  }, 'Courier Guy rates');
  const entries = Array.isArray(result) ? result : (result.rates || result.data || result.service_levels || []);
  return entries.map((item: any) => normaliseRate(item, 'courier-guy', 'Courier Guy')).filter((rate: any) => rate.price >= 0);
}
async function pudoLockers(body: any) {
  const apiKey = pudoApiKey();
  if (!apiKey) throw new Error('PUDO is not configured in Manus secrets');
  const result = await providerJson(`${pudoBaseUrl()}/pickup-points?type=locker`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  }, 'PUDO lockers');
  const entries = Array.isArray(result) ? result : (result.lockers || result.data || []);
  const destinationCode = String(body.destinationPostalCode || '');
  return entries.filter((locker: any) => !destinationCode || String(locker.place?.postalCode || locker.postalCode || '').includes(destinationCode.slice(0, 2))).slice(0, 40).map((locker: any) => ({
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
  const payload = {
    collection_address: collectionAddress('pudo', body),
    delivery_pickup_point_id: lockerId,
    delivery_pickup_point_provider: 'tcg-locker',
    parcels: [parcelFromBody(body)],
  };
  const result = await providerJson(`${pudoBaseUrl()}/rates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 'PUDO rates');
  const entries = Array.isArray(result) ? result : (result.rates || result.data || [result]);
  return entries.map((item: any) => normaliseRate(item, 'pudo', 'PUDO Locker')).filter((rate: any) => rate.price >= 0);
}
async function shippingRates(body: any) {
  const rates: any[] = [];
  const errors: any[] = [];
  const provider = body.provider || 'all';
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
  }
  if (!rates.length) {
    const configuredFallback = Number(process.env.FALLBACK_SHIPPING_FLAT_RATE_ZAR || 99);
    const fallbackPrice = Number.isFinite(configuredFallback) && configuredFallback >= 0 ? configuredFallback : 99;
    rates.push({ provider: 'fallback', service: 'Standard delivery', price: fallbackPrice, estimatedDays: '2–5 business days', description: 'Flat-rate fallback; live carrier quote unavailable.' });
  }
  return { rates, errors };
}
async function createCourierShipment(body: any) {
  const apiKey = courierGuyApiKey();
  if (!apiKey) throw new Error('Courier Guy is not configured in Manus secrets');
  const payload = { collection_address: collectionAddress('courier', body), collection_contact: collectionContact(body), delivery_address: checkoutAddress(body.destinationAddress, body.destinationPostalCode), delivery_contact: body.deliveryContact, parcels: [parcelFromBody(body)], service_level_code: body.serviceLevelCode, ...(process.env.COURIER_GUY_ACCOUNT_CODE ? { provider_id: process.env.COURIER_GUY_ACCOUNT_CODE } : {}) };
  return providerJson(`${process.env.COURIER_GUY_BASE_URL || 'https://api.shiplogic.com'}/shipments`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Courier Guy shipment');
}
async function createPudoShipment(body: any) {
  const apiKey = pudoApiKey();
  if (!apiKey) throw new Error('PUDO is not configured in Manus secrets');
  const payload = {
    collection_address: collectionAddress('pudo', body),
    collection_contact: collectionContact(body),
    delivery_pickup_point_id: body.pudoLockerId,
    delivery_pickup_point_provider: 'tcg-locker',
    delivery_contact: body.deliveryContact,
    service_level_code: body.serviceLevelCode,
    parcels: [parcelFromBody(body)],
  };
  return providerJson(`${pudoBaseUrl()}/shipments`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'PUDO shipment');
}

async function functionRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!pathname.startsWith('/api/functions/')) return false;
  const name = decodeURIComponent(pathname.slice('/api/functions/'.length));
  const body = req.method === 'GET'
    ? Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries())
    : await readJson(req);
  try {
    if (name === 'payment-config') return json(res, 200, { data: await paymentConfig() });
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
    if (name === 'payment-health') return json(res, 200, { data: await paymentConfig() });
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
    if (error instanceof ProviderError) return json(res, error.httpStatus, { error: error.message, provider: error.provider, upstreamStatus: error.upstreamStatus });
    if (name === 'social-feed') return json(res, 200, { data: { platform: body.platform, accountName: String(body.platform).toLowerCase() === 'instagram' ? '@instagram' : process.env.FACEBOOK_PAGE_NAME || 'Facebook Page', items: [], hasMore: false, error: { provider: 'Meta', error: error?.message || 'Social feed request failed' } } });
    return json(res, 502, { error: error?.message || 'Server function failed' });
  }
}

async function webhookRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (!pathname.startsWith('/api/webhooks/')) return false;
  const provider = pathname.split('/').pop();
  const body = await readBody(req, 2 * 1024 * 1024);
  let payload: any = {};
  try { payload = JSON.parse(body.toString('utf8')); } catch { payload = { raw: body.toString('utf8') }; }
  await dataRequest({ table: 'payment_webhook_events', operation: 'insert', payload: { provider, event_id: req.headers['x-event-id'] || crypto.createHash('sha256').update(body).digest('hex'), payload, received_at: now(), status: 'received' }, returnsRows: true });
  return json(res, 200, { received: true });
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

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
  const target = path.resolve(distDir, relative);
  if (!target.startsWith(distDir)) return json(res, 400, { error: 'Invalid path' });
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('not file');
    const content = await fs.readFile(target);
    const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.json') ? 'application/json; charset=utf-8' : target.endsWith('.webmanifest') ? 'application/manifest+json; charset=utf-8' : target.endsWith('.svg') ? 'image/svg+xml' : target.endsWith('.ico') ? 'image/x-icon' : target.endsWith('.png') ? 'image/png' : undefined;
    res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': target.endsWith('.html') || target.endsWith('manus-routes.json') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(content);
  } catch {
    const index = await fs.readFile(path.join(distDir, 'index.html')).catch(() => null);
    if (!index) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(index);
  }
}

async function createApp() {
  await fs.mkdir(storageDir, { recursive: true });
  await bootstrapAdminUser();
  const production = process.env.NODE_ENV === 'production' || fsSync.existsSync(path.join(distDir, 'index.html'));
  let vite: ViteDevServer | null = null;
  if (!production) vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      const pathname = requestUrl.pathname;
      if (pathname === '/health' || pathname === '/api/health') return json(res, 200, { ok: true, platform: 'manus', database: Boolean(pool) });
      if (pathname === '/api/data' && req.method === 'POST') return json(res, 200, await dataRequest(await readJson(req)));
      const authHandled = await authRequest(req, res, pathname); if (authHandled !== false) return;
      const functionHandled = await functionRequest(req, res, pathname); if (functionHandled !== false) return;
      const webhookHandled = await webhookRequest(req, res, pathname); if (webhookHandled !== false) return;
      if (pathname === '/api/storage' && (req.method === 'POST' || req.method === 'DELETE')) return storageRequest(req, res);
      if (pathname === '/manus-routes.json') {
        const routes = await fs.readFile(path.join(root, 'public/manus-routes.json'));
        return json(res, 200, JSON.parse(routes.toString('utf8')));
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
