/**
 * Run tokens.
 *
 * A game asks for a token when a run starts and hands it back with the score.
 * The token is `game.issuedAt.nonce.signature`, HMAC-signed with RUN_KEY, so
 * the Worker can tell how long the run has been going without storing
 * anything at the start. The nonce is recorded when a score is accepted, which
 * is what stops one token posting twice.
 *
 * This keeps out the casual `curl` with a made-up number and bounds a score by
 * the time it took. It does not stop someone determined who reads the game
 * code; nothing that runs in the browser can. Moderation covers the rest.
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const enc = new TextEncoder();

let cachedSecret = null;
let cachedKey = null;

async function hmacKey(secret) {
  if (secret !== cachedSecret) {
    cachedKey = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
    cachedSecret = secret;
  }
  return cachedKey;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const signed = (body) => enc.encode(`run.v1|${body}`);

export async function issueRun(secret, game, now) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${game}.${now}.${nonce}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), signed(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Returns `{ nonce, seconds }` for a good token, or `{ error }` saying why
 * not. `error` is one of 'invalid', 'expired'.
 */
export async function checkRun(secret, token, game, now) {
  if (typeof token !== 'string' || token.length > 200) return { error: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 4) return { error: 'invalid' };
  const [g, issued, nonce, sig] = parts;
  if (g !== game || !/^\d{13}$/.test(issued) || !/^[A-Za-z0-9_-]{16}$/.test(nonce)) {
    return { error: 'invalid' };
  }

  let sigBytes;
  try { sigBytes = unb64url(sig); } catch { return { error: 'invalid' }; }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, signed(`${g}.${issued}.${nonce}`));
  if (!ok) return { error: 'invalid' };

  const age = now - Number(issued);
  if (age < -SKEW_MS) return { error: 'invalid' };
  if (age > MAX_AGE_MS) return { error: 'expired' };
  return { nonce, seconds: Math.max(0, Math.floor(age / 1000)) };
}
