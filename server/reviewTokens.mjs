/**
 * server/reviewTokens.mjs
 *
 * The review link token, signed with a key only this server holds (R24). reviewEngine.mjs signs with
 * REVIEW_SECRET or, when it is unset, a key written in its own source, so anyone who could read the
 * code could mint a "verified buyer" token for any order. This keys the same HMAC with REVIEW_SECRET,
 * or with a key derived from MAIL_LINK_SECRET or HUB_API_KEY, and with none of them set it issues no
 * token and accepts none, rather than falling back to a key everyone knows.
 */
import crypto from 'crypto';
import { generateReviewToken, verifyReviewToken } from './reviewEngine.mjs';

export function reviewSigningKey() {
  const own = String(process.env.REVIEW_SECRET || '').trim();
  if (own) return own;
  const base = String(process.env.MAIL_LINK_SECRET || process.env.HUB_API_KEY || '').trim();
  if (!base) return '';
  // Derived, so a review token never doubles as an unsubscribe signature or reveals the hub key.
  return crypto.createHmac('sha256', base).update('jourvance-review-token-v1').digest('hex');
}

// '' when no key is set: a link without a token opens the portal but cannot save a review.
export function reviewTokenFor(orderId, email) {
  const key = reviewSigningKey();
  if (!key || !orderId || !email) return '';
  return generateReviewToken(orderId, email, key);
}

export function reviewTokenValid(orderId, email, token) {
  const key = reviewSigningKey();
  if (!key) return false;
  return verifyReviewToken(orderId, email, token, key);
}

export function reviewUrlFor(orderId, email) {
  if (!orderId) return '/review';
  const cleanEmail = String(email || '').toLowerCase().trim();
  const token = reviewTokenFor(orderId, cleanEmail);
  return `/review?order=${encodeURIComponent(orderId)}&email=${encodeURIComponent(cleanEmail)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}
