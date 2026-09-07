import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function parseSystemProxy(output) {
  const value = (key) => output.match(new RegExp(`^\\s*${key} : (.+)$`, "m"))?.[1].trim();
  const address = (kind) => {
    if (value(`${kind}Enable`) !== "1") return "";
    const host = value(`${kind}Proxy`), port = Number(value(`${kind}Port`));
    if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return "";
    try { return new URL(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`).origin; }
    catch { return ""; }
  };
  const block = output.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1] ?? "";
  const exceptions = [...block.matchAll(/^\s*\d+ : (.+)$/gm)].map((m) => m[1].trim());
  if (value("ExcludeSimpleHostnames") === "1") exceptions.push("<local>");
  return { httpProxy: address("HTTP"), httpsProxy: address("HTTPS"), exceptions };
}

function bypass(url, entry) {
  entry = entry.toLowerCase();
  const host = url.hostname.toLowerCase();
  if (entry === "*") return true;
  if (entry === "<local>") return !host.includes(".") && !host.includes(":");
  const cidr = entry.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (cidr) {
    const ipv4 = (value) => {
      const parts = value.split(".");
      return parts.length === 4 && parts.every((p) => /^\d+$/.test(p) && Number(p) <= 255)
        ? parts.reduce((n, p) => (n << 8) | Number(p), 0) : null;
    };
    const target = ipv4(host), network = ipv4(cidr[1]), bits = Number(cidr[2]);
    const mask = bits === 0 ? 0 : -1 << (32 - bits);
    return target !== null && network !== null && bits <= 32 && (target & mask) === (network & mask);
  }
  const withPort = entry.match(/^(.*):(\d+)$/);
  if (withPort) {
    const port = url.port || (["https:", "wss:"].includes(url.protocol) ? "443" : "80");
    if (Number(withPort[2]) !== Number(port)) return false;
    entry = withPort[1];
  }
  if (entry.startsWith("*")) entry = entry.slice(1);
  return entry.startsWith(".") ? host.endsWith(entry) : host === entry;
}

export function systemProxyForUrl(input, config, noProxy = "") {
  if (!config) return "";
  const url = new URL(input);
  const exceptions = [...config.exceptions, ...noProxy.split(/[\s,]+/).filter(Boolean)];
  if (exceptions.some((entry) => bypass(url, entry))) return "";
  if (["https:", "wss:"].includes(url.protocol)) return config.httpsProxy;
  if (["http:", "ws:"].includes(url.protocol)) return config.httpProxy;
  return "";
}

let settings;
export async function readSystemProxy() {
  if (process.platform !== "darwin") return null;
  settings ??= execute("/usr/sbin/scutil", ["--proxy"], { timeout: 2000, maxBuffer: 65536 })
    .then(({ stdout }) => parseSystemProxy(stdout)).catch(() => null);
  return settings;
}
