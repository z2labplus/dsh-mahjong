import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSystemProxy, systemProxyForUrl } from '../lib/system-proxy.js';
import { isLoopback } from '../lib/service-network.js';

const settings = `<dictionary> {
  ExceptionsList : <array> {
    0 : localhost
    1 : 127.0.0.0/8
    2 : *.internal.example
  }
  ExcludeSimpleHostnames : 1
  HTTPEnable : 1
  HTTPPort : 10808
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 10809
  HTTPSProxy : ::1
}`;

test('system HTTP proxies route service requests and WebSockets consistently', () => {
  const config = parseSystemProxy(settings);
  assert.equal(config.httpProxy, 'http://127.0.0.1:10808');
  assert.equal(config.httpsProxy, 'http://[::1]:10809');
  for (const scheme of ['http', 'ws']) assert.equal(systemProxyForUrl(`${scheme}://mahjong.example/`, config), config.httpProxy);
  for (const scheme of ['https', 'wss']) assert.equal(systemProxyForUrl(`${scheme}://mahjong.example/`, config), config.httpsProxy);
});

test('disabled, malformed and PAC-only configurations do not invent a proxy', () => {
  for (const text of ['', 'ProxyAutoConfigEnable : 1', settings.replace('HTTPSEnable : 1', 'HTTPSEnable : 0'), settings.replace('HTTPSPort : 10809', 'HTTPSPort : 70000'), settings.replace('HTTPSProxy : ::1', 'HTTPSProxy : user@proxy')]) {
    assert.equal(systemProxyForUrl('https://mahjong.example/', parseSystemProxy(text)), '');
  }
  assert.equal(systemProxyForUrl('https://mahjong.example/', null), '');
});

test('system exceptions and explicit NO_PROXY avoid forwarding excluded destinations', () => {
  const config = parseSystemProxy(settings);
  for (const host of ['localhost', '127.42.0.9', 'desk', 'a.internal.example']) assert.equal(systemProxyForUrl(`https://${host}/`, config), '');
  for (const noProxy of ['*', 'mahjong.example', '.example', '*.example', 'mahjong.example:443']) {
    assert.equal(systemProxyForUrl('wss://mahjong.example/', config, noProxy), '');
  }
  assert.equal(systemProxyForUrl('https://mahjong.example/', config, 'mahjong.example:8443'), config.httpsProxy);
  assert.equal(systemProxyForUrl('https://evilinternal.example/', config), config.httpsProxy);
});

test('the local Harness and local service bypass proxies for HTTP and WebSockets', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(isLoopback(`http://${host}:3082/`), true);
    assert.equal(isLoopback(`ws://${host}:8787/`), true);
  }
  assert.equal(isLoopback('https://mahjong.example/'), false);
});
