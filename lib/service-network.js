// Keep proxy handling local to the Mahjong connection; do not change Harness globals.
import { readSystemProxy, systemProxyForUrl } from "./system-proxy.js";

export function isLoopback(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
}
let httpProxy;
let socketProxy;
const systemHttpProxies = new Map();
const configured = () => Boolean(process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY);
const systemProxy = async (url) => systemProxyForUrl(url, await readSystemProxy(), process.env.no_proxy || process.env.NO_PROXY);
export async function serviceFetch(url, options) {
  if (isLoopback(url)) return globalThis.fetch(url, options);
  if (configured()) {
    const { fetch, EnvHttpProxyAgent } = await import("undici");
    httpProxy ??= new EnvHttpProxyAgent();
    return fetch(url, { ...options, dispatcher: httpProxy });
  }
  const proxy = await systemProxy(url);
  if (!proxy) return globalThis.fetch(url, options);
  const { fetch, ProxyAgent } = await import("undici");
  if (!systemHttpProxies.has(proxy)) systemHttpProxies.set(proxy, new ProxyAgent(proxy));
  return fetch(url, { ...options, dispatcher: systemHttpProxies.get(proxy) });
}
export async function createServiceSocketFactory() {
  const { WebSocket } = await import("ws");
  if (configured() || await readSystemProxy()) {
    const { ProxyAgent } = await import("proxy-agent");
    socketProxy ??= new ProxyAgent(configured() ? {} : { getProxyForUrl: systemProxy });
  }
  return (url, options = {}) => new WebSocket(url, {
    ...options,
    ...(!isLoopback(url) && socketProxy ? { agent: socketProxy } : {}),
  });
}
