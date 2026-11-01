// sui-ops：控制面执行器。只跑在两件事都成立的地方——它自己是面板主机、且能 SSH 到其他节点。
//
// 职责：把 promote.sh 推到目标机执行，返回逐行日志；不改任何配置、不碰 DNS。
// 安全边界：
//   1. 只认配置里的目标名（白名单），不接受任意 IP/命令；
//   2. 只暴露在 127.0.0.1，外部访问必须经过面板；
//   3. 所有调用要带 ops token（与面板同源）。
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const CFG_PATH = process.env.OPS_CONFIG ?? "/etc/sui-ops.json";
let cfg;
try {
  cfg = JSON.parse(readFileSync(CFG_PATH, "utf8"));
} catch (err) {
  process.stderr.write(`读不到配置 ${CFG_PATH}: ${err.message}\n`);
  process.exit(1);
}

const PORT = Number(process.env.OPS_PORT ?? cfg.port ?? 8790);
const TOKEN = process.env.OPS_TOKEN ?? cfg.token;
const SSH_KEY = cfg.ssh_key ?? "/root/.ssh/exec_ed25519";
const SSH_PORT = cfg.ssh_port ?? 6688;
const PROMOTE =
  cfg.promote_script ?? "/opt/sui-panel/apps/selfhost/scripts/promote.sh";
const TARGETS = new Map(Object.entries(cfg.targets ?? {}));

const log = (line) => process.stdout.write(`${line}\n`);

function authorized(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  const tk =
    url.searchParams.get("token") ??
    (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return TOKEN && tk === TOKEN;
}

/** 把 promote.sh 通过 stdin 推给目标机的 bash，逐行流式返回。 */
function runPromote(name, args, onLine) {
  const host = TARGETS.get(name);
  if (!host) throw new Error(`未配置的目标: ${name}`);

  const sshArgs = [
    "-i",
    SSH_KEY,
    "-p",
    String(SSH_PORT),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ConnectTimeout=10",
    `root@${host}`,
    `bash -s -- ${args.join(" ")}`,
  ];
  const child = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(readFileSync(PROMOTE));
  child.stdin.end();
  child.stdout.on("data", (b) =>
    b.toString().split("\n").filter(Boolean).forEach(onLine),
  );
  child.stderr.on("data", (b) =>
    b
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => onLine(`! ${l}`)),
  );
  return new Promise((resolve) => child.on("close", (code) => resolve(code)));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    // 健康检查不需要令牌（只报告自己活着），但也不泄露目标列表
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({ ok: true, service: "sui-ops", targets: TARGETS.size }),
    );
  }

  if (!authorized(req)) {
    res.writeHead(401, { "content-type": "text/plain" });
    return res.end("unauthorized");
  }

  if (url.pathname === "/targets") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ targets: [...TARGETS.keys()] }));
  }

  if (url.pathname === "/promote" && req.method === "POST") {
    const name = url.searchParams.get("target") ?? "";
    const dry = url.searchParams.get("dry") === "1";
    if (!TARGETS.has(name)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end(`unknown target: ${name}`);
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    const args = [`--primary ${cfg.panel_url}`, `--token ${TOKEN}`];
    if (dry) args.push("--dry-run");
    const code = await runPromote(name, args, (line) => res.write(`${line}\n`));
    res.end(`\n[DONE exit=${code}]\n`);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () =>
  log(`sui-ops 监听 127.0.0.1:${PORT}，目标 ${TARGETS.size} 台`),
);
