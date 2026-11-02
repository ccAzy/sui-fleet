import type { J } from "./util";

// 对象层的常量与类型：对外契约的一部分（前端/agent 都依赖这些取值）。

export const OBJECT_KINDS = [
  "inbounds",
  "outbounds",
  "endpoints",
  "services",
  "tls",
  "clients",
] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const DEFAULT_CONFIG: J = {
  log: { level: "info", timestamp: true },
  dns: {
    servers: [{ tag: "google", address: "tls://8.8.8.8", detour: "direct" }],
    rules: [{ domain: ["geosite:cn"], server: "local" }],
    final: "google",
    strategy: "prefer_ipv4",
  },
  inbounds: [],
  outbounds: [],
  route: {
    rules: [{ protocol: "dns", outbound: "dns-out" }],
    rule_set: [],
    final: "direct",
    auto_detect_interface: true,
    default_domain_resolver: "google",
  },
  experimental: {
    cache_file: { enabled: true, path: "cache.db" },
    clash_api: { external_controller: "127.0.0.1:9090" },
  },
};
