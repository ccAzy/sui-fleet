-- s-ui Cloudflare 控制面 D1 schema
-- 设计原则:对象(raw JSON)按 node 分区存,服务端只做 id 分配/关联维护,
-- 让节点侧继续用 s-ui 原生 Go 逻辑渲染 sing-box 配置(零重写渲染)。

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- pbkdf2$<iter>$<salt_b64>$<hash_b64>
  created_at    INTEGER NOT NULL
);

-- 面板登录令牌(与 s-ui 的 tokens 语义一致,给 apiv2 / 第三方调用)
CREATE TABLE IF NOT EXISTS tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  desc       TEXT NOT NULL DEFAULT '',
  token      TEXT NOT NULL UNIQUE,
  expiry     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 被管理的服务器(节点)。token_hash = sha256(agent_token),不存明文。
CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,        -- 短 id,给前端当 X-Remote-Server
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  address      TEXT NOT NULL DEFAULT '', -- 展示用地址(IP:端口 / 域名),订阅拼链接用
  sub_key      TEXT NOT NULL DEFAULT '', -- 订阅 URL 的访问密钥(避免按 6 位 id 枚举)
  remark       TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  revision     INTEGER NOT NULL DEFAULT 1,  -- 配置版本号,变更即 +1
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,

  -- 节点上报的状态(由 agent report 写入)
  last_seen    INTEGER NOT NULL DEFAULT 0,
  last_ip      TEXT NOT NULL DEFAULT '',
  agent_ver    TEXT NOT NULL DEFAULT '',
  kernel_ver   TEXT NOT NULL DEFAULT '', -- 节点上 sing-box 的编译版本
  core_state   TEXT NOT NULL DEFAULT 'unknown', -- running / stopped / error
  status_json  TEXT NOT NULL DEFAULT '{}',
  applied_rev  INTEGER NOT NULL DEFAULT 0        -- 节点已生效的 revision
);

-- 每节点一套面板对象。kind ∈ inbounds|outbounds|endpoints|services|tls|clients|servers
CREATE TABLE IF NOT EXISTS objects (
  node_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  obj_id     INTEGER NOT NULL,
  tag        TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL,             -- 原始 JSON(与前端交互的完整对象形态)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, kind, obj_id)
);
CREATE INDEX IF NOT EXISTS idx_objects_node_kind ON objects(node_id, kind);

-- 每节点的面板设置(settings 键值 + sing-box 主配置 JSON)
CREATE TABLE IF NOT EXISTS settings (
  node_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (node_id, key)
);

-- 变更日志:前端靠它轮询 lu 判断是否刷新(对应 s-ui Changes 表)
CREATE TABLE IF NOT EXISTS changes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  actor   TEXT NOT NULL DEFAULT '',
  kind    TEXT NOT NULL,
  action  TEXT NOT NULL,
  obj     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_changes_node_ts ON changes(node_id, ts);

-- 节点上报的流量增量(按客户端 tag 聚合,落库后累加到 objects.clients)
CREATE TABLE IF NOT EXISTS usage (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  tag     TEXT NOT NULL DEFAULT '',
  up      INTEGER NOT NULL DEFAULT 0,
  down    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_node_ts ON usage(node_id, ts);

-- 下发给节点的指令(pull 时取走,执行后 report 回执)
CREATE TABLE IF NOT EXISTS commands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- restart_core|stop_core|kick_user|reset_traffic
  payload    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'pending', -- pending|done|failed
  result     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  done_at    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_commands_pending ON commands(node_id, status);

-- 登录失败计数(Worker 无状态,只能落库做简单限流)
CREATE TABLE IF NOT EXISTS login_attempts (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ip   TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  ok   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_login_ip_ts ON login_attempts(ip, ts);

-- 面板自身的元信息(如 schema 版本、是否需要初始化)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
