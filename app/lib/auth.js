const TOKEN_KEY = 'trackmark.spotify.session';
const FLOW_KEY = 'trackmark.spotify.pkce';
export const READ_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];
function randomString() {
  return Array.from(crypto.getRandomValues(new Uint8Array(48)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function codeChallenge(verifier) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function validateConfig(config, origin = location.origin) {
  if (!config?.clientId || !/^[a-zA-Z0-9]{32}$/.test(config.clientId))
    throw new Error('Add your Client ID to app/config.local.js, then reload.');
  const redirect = new URL(config.redirectUri);
  if (redirect.origin !== origin)
    throw new Error(`Open the app at ${redirect.origin} to use the configured Spotify redirect.`);
  if (
    redirect.hostname === 'localhost' ||
    (redirect.protocol !== 'https:' && !['127.0.0.1', '[::1]'].includes(redirect.hostname))
  )
    throw new Error('Spotify requires HTTPS or an explicit loopback address such as 127.0.0.1.');
  return config;
}
export class SpotifyAuth {
  constructor(config, { storage = sessionStorage, fetcher = fetch } = {}) {
    this.config = config;
    this.storage = storage;
    this.fetcher = fetcher;
    this.refreshing = null;
  }
  session() {
    try {
      return JSON.parse(this.storage.getItem(TOKEN_KEY));
    } catch {
      return null;
    }
  }
  connected() {
    const session = this.session();
    return Boolean(session?.accessToken && session.clientId === this.config.clientId);
  }
  disconnect() {
    this.storage.removeItem(TOKEN_KEY);
    this.storage.removeItem(FLOW_KEY);
  }
  async login() {
    validateConfig(this.config);
    const verifier = randomString(),
      state = randomString();
    this.storage.setItem(
      FLOW_KEY,
      JSON.stringify({
        verifier,
        state,
        createdAt: Date.now(),
        redirectUri: this.config.redirectUri,
      }),
    );
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: READ_SCOPES.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: await codeChallenge(verifier),
    });
    location.assign(url.href);
  }
  async callback(url = new URL(location.href)) {
    const code = url.searchParams.get('code'),
      error = url.searchParams.get('error');
    if (!code && !error) return false;
    const flow = JSON.parse(this.storage.getItem(FLOW_KEY) ?? 'null');
    this.storage.removeItem(FLOW_KEY);
    const clean = new URL(url);
    ['code', 'state', 'error', 'error_description'].forEach((key) =>
      clean.searchParams.delete(key),
    );
    history.replaceState(null, '', clean.href);
    if (
      !flow ||
      url.searchParams.get('state') !== flow.state ||
      Date.now() - flow.createdAt > 600000
    )
      throw new Error('Sign-in state is invalid or expired. Please connect again.');
    if (error)
      throw new Error(
        error === 'access_denied'
          ? 'Spotify access was declined.'
          : 'Spotify sign-in failed. Please reconnect.',
      );
    await this.exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      code_verifier: flow.verifier,
    });
    return true;
  }
  async exchange(parameters) {
    const response = await this.fetcher('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: this.config.clientId }),
    });
    const data = await response.json();
    if (!response.ok) {
      this.disconnect();
      throw new Error('Spotify sign-in expired or failed. Please connect again.');
    }
    const prior = this.session();
    const scopes = (data.scope ?? prior?.scopes?.join(' ') ?? '').split(' ');
    if (
      scopes.some((scope) => scope.includes('modify')) ||
      !READ_SCOPES.every((scope) => scopes.includes(scope))
    ) {
      this.disconnect();
      throw new Error(
        'Expected read-only playlist permissions were not granted. Please reconnect.',
      );
    }
    const session = {
      clientId: this.config.clientId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? prior?.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes,
    };
    this.storage.setItem(TOKEN_KEY, JSON.stringify(session));
    return session.accessToken;
  }
  async accessToken() {
    const session = this.session();
    if (!this.connected()) throw new Error('Connect Spotify first.');
    if (session.expiresAt > Date.now() + 30000) return session.accessToken;
    if (!session.refreshToken) {
      this.disconnect();
      throw new Error('Please reconnect Spotify.');
    }
    if (!this.refreshing)
      this.refreshing = this.exchange({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }).finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}
