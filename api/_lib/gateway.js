/** Optional VPS media gateway. Disabled unless both URL and secret are set. */
import crypto from 'node:crypto';
import { signPayload } from './util.js';
export function gatewayConfig() {
  const url = process.env.MZ_GATEWAY_URL, secret = process.env.MZ_GATEWAY_SECRET;
  if (!url && !secret) return null;
  if (!url || !secret || secret.length < 32) throw Object.assign(new Error('Gateway requires a URL and a secret of at least 32 characters'), { status: 503 });
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'test') throw Object.assign(new Error('Gateway URL must use HTTPS'), { status: 503 });
  return { url: parsed.origin, secret };
}
export function gatewayAuthorized(req, config) {
  const value = String(req.headers['x-mizanora-gateway'] || '');
  const a = Buffer.from(value), b = Buffer.from(config.secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function gatewayLink(config, callback) {
  return `${config.url}/start?ticket=${encodeURIComponent(signPayload({ callback }, config.secret, 60))}`;
}
