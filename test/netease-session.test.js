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

test('rejects a 127-prefixed hostname before forwarding an account cookie', async () => {
  const cookie = 'MUSIC_U=crafted-host-cookie';
  let capturedUrl;
  const fetchImpl = async url => {
    capturedUrl = new URL(url);
    throw new Error('should not fetch');
  };

  await assert.rejects(
    requestNeteaseJson('/user/account', {}, {
      baseUrl: 'http://127.example.invalid:3000',
      cookie,
      fetchImpl,
    }),
    error => /refusing to send.*cookie.*non-local/i.test(error.message)
      && !error.message.includes(cookie),
  );
  assert.equal(capturedUrl, undefined);
});

test('sends account cookies only to actual loopback hosts by default', async t => {
  const allowedBaseUrls = [
    'http://localhost:3000',
    'http://LOCALHOST:3000',
    'http://127.0.0.1:3000',
    'http://127.2.3.4:3000',
    'http://[::1]:3000',
  ];
  const rejectedBaseUrls = [
    'http://127.example.invalid:3000',
    'http://localhost.example:3000',
    'http://prefix-localhost:3000',
    'http://localhost-suffix:3000',
    'http://127.0.0.1.example:3000',
    'http://127.0.0.1x:3000',
    'http://128.0.0.1:3000',
    'http://192.168.1.10:3000',
    'http://localhost@evil.example:3000',
    'http://127.0.0.1@evil.example:3000',
  ];

  for (const baseUrl of allowedBaseUrls) {
    await t.test(`allows ${baseUrl}`, async () => {
      const cookie = 'MUSIC_U=loopback-cookie';
      let capturedUrl;
      const fetchImpl = async url => {
        capturedUrl = new URL(url);
        return { ok: true, async text() { return JSON.stringify({ code: 200 }); } };
      };

      await requestNeteaseJson('/user/account', {}, { baseUrl, cookie, fetchImpl });

      assert.equal(capturedUrl.searchParams.get('cookie'), cookie);
    });
  }

  for (const baseUrl of rejectedBaseUrls) {
    await t.test(`rejects ${baseUrl}`, async () => {
      const cookie = 'MUSIC_U=non-loopback-cookie';
      let fetched = false;
      const fetchImpl = async () => {
        fetched = true;
        throw new Error('should not fetch');
      };

      await assert.rejects(
        requestNeteaseJson('/user/account', {}, { baseUrl, cookie, fetchImpl }),
        error => /refusing to send.*cookie.*non-local/i.test(error.message)
          && !error.message.includes(cookie),
      );
      assert.equal(fetched, false);
    });
  }
});

test('rejects a malformed numeric host before forwarding an account cookie', async () => {
  const cookie = 'MUSIC_U=malformed-host-cookie';
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    throw new Error('should not fetch');
  };

  await assert.rejects(
    requestNeteaseJson('/user/account', {}, {
      baseUrl: 'http://127.0.0.999:3000',
      cookie,
      fetchImpl,
    }),
    error => !error.message.includes(cookie),
  );
  assert.equal(fetched, false);
});

test('preserves explicit remote cookie opt-in for HTTPS only', async () => {
  const cookie = 'MUSIC_U=trusted-remote-cookie';
  let capturedUrl;
  const fetchImpl = async url => {
    capturedUrl = new URL(url);
    return { ok: true, async text() { return JSON.stringify({ code: 200 }); } };
  };

  await requestNeteaseJson('/user/account', {}, {
    baseUrl: 'https://music-api.example.test',
    cookie,
    allowRemoteCookie: true,
    fetchImpl,
  });
  assert.equal(capturedUrl.searchParams.get('cookie'), cookie);

  capturedUrl = undefined;
  await assert.rejects(
    requestNeteaseJson('/user/account', {}, {
      baseUrl: 'http://music-api.example.test',
      cookie,
      allowRemoteCookie: true,
      fetchImpl,
    }),
    error => /refusing to send.*cookie.*non-local/i.test(error.message)
      && !error.message.includes(cookie),
  );
  assert.equal(capturedUrl, undefined);
});
