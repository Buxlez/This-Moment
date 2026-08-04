const test = require('node:test');
const assert = require('node:assert/strict');

const { requestNeteaseJson, shouldUseExistingCookie, verifyLoginStatus } = require('../netease-session');

test('reuses only a cookie verified by a Netease account endpoint', () => {
  assert.equal(shouldUseExistingCookie({ valid: true, reason: 'ok' }), true);
  assert.equal(shouldUseExistingCookie({ valid: false, reason: 'profile-missing' }), false);
  assert.equal(shouldUseExistingCookie({ valid: false, reason: 'missing-cookie' }), false);
  assert.equal(shouldUseExistingCookie({ valid: false, reason: 'network-error' }), false);
});

test('uses the account endpoint when login status omits profile data', async () => {
  const calls = [];
  const requestJson = async pathname => {
    calls.push(pathname);
    if (pathname === '/login/status') return { data: { profile: null } };
    if (pathname === '/user/account') return { account: { id: 17788957037 } };
    throw new Error(`unexpected endpoint: ${pathname}`);
  };

  const status = await verifyLoginStatus({ cookie: 'MUSIC_U=test-cookie', requestJson });

  assert.deepEqual(calls, ['/login/status', '/user/account']);
  assert.deepEqual(status, { valid: true, userId: 17788957037, reason: 'account-fallback' });
});

test('passes the saved cookie as a sidecar query parameter', async () => {
  let requestUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestUrl = new URL(url);
    requestOptions = options;
    return { ok: true, async text() { return JSON.stringify({ code: 200 }); } };
  };

  await requestNeteaseJson('/user/account', {}, {
    cookie: 'MUSIC_U=member-cookie; __csrf=token',
    fetchImpl,
  });

  assert.equal(requestUrl.searchParams.get('cookie'), 'MUSIC_U=member-cookie; __csrf=token');
  assert.equal(requestOptions.headers.Cookie, undefined);
});

test('preserves the HTTP status when the sidecar returns an error message', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 405,
    async text() { return JSON.stringify({ message: 'Cheating' }); },
  });

  await assert.rejects(
    requestNeteaseJson('/cloudsearch', {}, { fetchImpl }),
    error => error.message === 'Cheating' && error.status === 405,
  );
});

test('does not send an account cookie to a non-loopback sidecar by default', async () => {
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    throw new Error('should not fetch');
  };

  await assert.rejects(
    requestNeteaseJson('/user/account', {}, {
      baseUrl: 'https://music-api.example.test',
      cookie: 'MUSIC_U=member-cookie',
      fetchImpl,
    }),
    /refusing to send.*cookie.*non-local/i,
  );
  assert.equal(fetched, false);
});
