import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyAuth, codeChallenge, validateConfig, READ_SCOPES } from '../app/lib/auth.js';
const config = { clientId: 'a'.repeat(32), redirectUri: 'http://127.0.0.1:4173/' };
const storage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
};
const response = (data, ok = true) => ({ ok, json: async () => data });
test('PKCE challenge follows the RFC 7636 example', async () => {
  assert.equal(
    await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});
test('local setup rejects localhost, foreign origin, and absent IDs', () => {
  assert.equal(validateConfig(config, 'http://127.0.0.1:4173'), config);
  assert.throws(
    () =>
      validateConfig({ ...config, redirectUri: 'http://localhost:4173/' }, 'http://localhost:4173'),
    /loopback/,
  );
  assert.throws(() => validateConfig(config, 'https://other.example'), /Open the app/);
  assert.throws(
    () => validateConfig({ ...config, clientId: '' }, 'http://127.0.0.1:4173'),
    /Client ID/,
  );
});
test('token refresh retains refresh token when Spotify does not rotate it', async () => {
  const memory = storage();
  let call = 0;
  const auth = new SpotifyAuth(config, {
    storage: memory,
    fetcher: async () =>
      response({
        access_token: ++call === 1 ? 'first' : 'second',
        refresh_token: call === 1 ? 'refresh' : undefined,
        expires_in: call === 1 ? 0 : 3600,
        scope: READ_SCOPES.join(' '),
      }),
  });
  await auth.exchange({ grant_type: 'authorization_code', code: 'code' });
  assert.equal(await auth.accessToken(), 'second');
  assert.equal(auth.session().refreshToken, 'refresh');
  auth.disconnect();
  assert.equal(auth.connected(), false);
});
test('write scopes are rejected and invalid grants clear the session without retry', async () => {
  let calls = 0;
  const auth = new SpotifyAuth(config, {
    storage: storage(),
    fetcher: async () => {
      calls++;
      return response({
        access_token: 'token',
        expires_in: 3600,
        scope: [...READ_SCOPES, 'playlist-modify-private'].join(' '),
      });
    },
  });
  await assert.rejects(() => auth.exchange({ grant_type: 'authorization_code' }), /read-only/);
  assert.equal(auth.connected(), false);
  assert.equal(calls, 1);
});
test('callback verifies state before exchanging a code and removes URL credentials', async () => {
  const memory = storage();
  memory.setItem(
    'trackmark.spotify.pkce',
    JSON.stringify({ state: 'expected', verifier: 'verifier', createdAt: Date.now() }),
  );
  let calls = 0,
    cleaned;
  globalThis.history = {
    replaceState: (_a, _b, url) => {
      cleaned = url;
    },
  };
  const auth = new SpotifyAuth(config, {
    storage: memory,
    fetcher: async () => {
      calls++;
      return response({});
    },
  });
  await assert.rejects(
    () => auth.callback(new URL('http://127.0.0.1:4173/?code=secret&state=wrong')),
    /state/,
  );
  assert.equal(calls, 0);
  assert.ok(!cleaned.includes('code='));
  assert.equal(memory.getItem('trackmark.spotify.pkce'), null);
});

test('an invalid refresh grant clears stored tokens and is not retried', async () => {
  let calls = 0;
  const auth = new SpotifyAuth(config, {
    storage: storage(),
    fetcher: async () =>
      ++calls === 1
        ? response({
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 0,
            scope: READ_SCOPES.join(' '),
          })
        : response({ error: 'invalid_grant' }, false),
  });
  await auth.exchange({ grant_type: 'authorization_code' });
  await assert.rejects(() => auth.accessToken(), /connect again/);
  assert.equal(auth.connected(), false);
  assert.equal(calls, 2);
});
