// @peculiar/x509 依赖 tsyringe，必须先加载反射 polyfill，且必须在其它 import 之前
import "reflect-metadata";
// 面板入口：只做「装配」——安全头、登录、鉴权守卫，其余路由在 routes/ 下。
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import {
  COOKIE,
  ensureAdmin,
  login as doLogin,
  signJWT,
  timingSafeEqual,
  verifyJWT,
  verifyOpsToken,
  tokenIsValid,
  verifyPullToken,
} from "./auth";
import {
  all,
  batch,
  bumpSessionEpoch,
  ensureOtpSchema,
  ensurePerfIndexes,
  ensureSessionEpoch,
  first,
  now,
  run,
  type Env,
  type UserRow,
} from "./db";
import {
  MARKER_COOKIE,
  currentUser,
  json,
  okMsg,
  readBody,
  secretOf,
  baseUrl,
  clientIp,
} from "./http";
import { cronTick } from "./cron";
import { hashRecovery, totpVerify } from "./otp";
import { registerOtpAdmin } from "./routes/otp";
import { registerSub } from "./routes/sub";
import { registerAgentApi } from "./routes/agent-api";
import { registerApiRead } from "./routes/api-read";
import { registerOps } from "./routes/ops";
import { registerSubInfo } from "./routes/sub-info";
import { installScript } from "./install-script";
import { registerApiWrite } from "./routes/api-write";
import { rateLimited, unauthorized } from "./errors";

type Ctx = { Bindings: Env };

const app = new Hono<Ctx>();


// 安全响应头：对所有响应生效（含静态 HTML——它以前完全裸奔，
// 因为 run_worker_first 只覆盖 /api /agent /sub，页面由 Assets 直接吐出）。
//
// 说明两处折中：
//  - style-src 必须留 'unsafe-inline'：Vue 的 :style 绑定会生成 style 属性。
//  - img-src 允许 https:：壁纸可以粘任意图片链接（跨域图无法降采样时直接用 URL）。
// script-src 是 'self'——内联脚本已抽到 /boot.js，没有再放行的理由。
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
  "Strict-Transport-Security": "max-age=15552000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // 私有面板不该被搜索引擎收录
  "X-Robots-Tag": "noindex, nofollow",
};

app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
});

// 路由注册必须在安全头中间件**之后**：Hono 按注册顺序执行，/sub 与 /agent 的
// handler 写回响应后不会再走后面注册的中间件 —— 原来这两类响应完全没有
// CSP/HSTS/X-Content-Type-Options 等头（实测缺失，不只是理论问题）。
registerSub(app);
registerAgentApi(app);

/** 发正式会话 cookie（密码登录与二次验证后共用） */
async function issueSession(c: any, user: UserRow) {
  const mustChange = user.must_change === 1;
  // se = 会话代次。改密/启停 2FA 会 +1，旧 cookie 随即失效（见 http.ts currentUser）。
  const se = Number(user.session_epoch ?? 0);
  const token = await signJWT(
    { u: user.username, uid: user.id, mc: mustChange, se },
    await secretOf(c.env),
  );
  let isHttps = true;
  try {
    isHttps = new URL(c.req.url).protocol === "https:";
  } catch {
    isHttps = true;
  }
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400,
    secure: isHttps,
  });
  // 前端路由守卫读的是 document.cookie 里的 `s-ui`（沿用原名字）。
  // 这只是"已登录"标记；真正的凭据是上面那个 HttpOnly cookie。
  setCookie(c, MARKER_COOKIE, "1", {
    httpOnly: false,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400,
    secure: isHttps,
  });
  return json(c, { must_change: mustChange });
}

/**
 * 登录限流的前置闸：先按 IP，再按全站。
 *
 * 两处（密码登录、OTP 校验）原本各抄了一份 20 行，行为必须完全一致 ——
 * 抄歪一处就等于给暴力破解留了一条绕过。抽成一个函数，改规则只用改这里。
 * 返回非 null 表示应当直接拒绝。
 */
async function loginRateLimited(
  c: any,
  ip: string,
  ts: number,
): Promise<Response | null> {
  const recent = await first<{ c: number }>(
    c.env.DB,
    "SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND ts > ? AND ok = 0",
    ip,
    ts - 300,
  );
  if ((recent?.c ?? 0) >= 8)
    return json(c, null, rateLimited());
  // 全局上限：不看 IP。客户端地址来自请求头，自托管时可能被伪造；
  // 只用「按 IP 计数」的话，攻击者每次换一个头就能绕开。
  //
  // 阈值必须足够高：这个闸门是**不看来源**的，攻击者只要持续打错密码就能把
  // 管理员一起挡在门外（30/5min 时几分钟就能达成，等于一条免费的拒服攻击）。
  // 200/5min 仍然能挡住"换头扫密码"的量级（正常运维不会 5 分钟错 200 次），
  // 但不容易被单独一个人打满。
  const GLOBAL_FAIL_LIMIT = 200;
  const globalRecent = await first<{ c: number }>(
    c.env.DB,
    "SELECT COUNT(*) as c FROM login_attempts WHERE ts > ? AND ok = 0",
    now() - 300,
  );
  if ((globalRecent?.c ?? 0) >= GLOBAL_FAIL_LIMIT)
    return json(c, null, rateLimited());
  return null;
}

// ---------- 登录 ----------

app.post("/api/login", async (c) => {
  const ip = clientIp(c);
  const ts = now();
  const limited = await loginRateLimited(c, ip, ts);
  if (limited) return limited;

  const body = await readBody(c);
  await ensureAdmin(c.env.DB, c.env.ADMIN_USER, c.env.ADMIN_PASS);
  await ensureOtpSchema(c.env.DB);
  // 老库没有 session_epoch 列时，currentUser 的查询会直接报错（面板全体 500）。
  // 与 ensureOtpSchema 一样走「用到才补」：登录路径先补列，之后每次请求才敢查。
  await ensureSessionEpoch(c.env.DB);
  await ensurePerfIndexes(c.env.DB);
  const user = await doLogin(
    c.env.DB,
    String(body.user ?? ""),
    String(body.pass ?? ""),
  );
  await run(
    c.env.DB,
    "INSERT INTO login_attempts (ip, ts, ok) VALUES (?, ?, ?)",
    ip,
    ts,
    user ? 1 : 0,
  );
  if (!user) return json(c, null, new Error("Invalid login"));

  // 开了二次验证：此时还不算登录成功，只发一张 120 秒的票据。
  // 不落库、不设 cookie——票据本身是 HMAC 签名的，验签即可，无需服务器状态。
  if (user.otp_on === 1) {
    const ticket = await signJWT(
      { u: user.username, uid: user.id, otp: 1 },
      await secretOf(c.env),
      120,
    );
    return json(c, { need_otp: true, ticket });
  }
  await ensureOtpSchema(c.env.DB);
  // 老库没有 session_epoch 列时，currentUser 的查询会直接报错（面板全体 500）。
  // 与 ensureOtpSchema 一样走「用到才补」：登录路径先补列，之后每次请求才敢查。
  await ensureSessionEpoch(c.env.DB);
  await ensurePerfIndexes(c.env.DB);
  return await issueSession(c, user);
});

app.post("/api/login/otp", async (c) => {
  const ip = clientIp(c);
  const ts = now();
  const limited = await loginRateLimited(c, ip, ts);
  if (limited) return limited;

  const body = await readBody(c);
  const ticket = String(body.ticket ?? "");
  const code = String(body.code ?? "").trim();
  const payload = await verifyJWT(ticket, await secretOf(c.env));
  if (!payload || payload.otp !== 1 || typeof payload.u !== "string")
    return json(c, null, new Error("验证超时，请重新输入密码"));

  const user = await first<UserRow>(
    c.env.DB,
    "SELECT * FROM users WHERE username = ?",
    payload.u,
  );
  if (!user || user.otp_on !== 1 || !user.otp_secret)
    return json(c, null, new Error("Invalid login"));

  let ok = false;
  let usedStep = 0;
  const digits = code.replace(/\D/g, "");
  if (digits.length === 6) {
    usedStep = await totpVerify(
      user.otp_secret,
      digits,
      Number(user.otp_last_step ?? 0),
    );
    ok = usedStep > 0;
  } else if (code) {
    // 恢复码：用掉即作废
    const hashed = await hashRecovery(code);
    let list: string[] = [];
    try {
      list = JSON.parse(user.otp_recovery || "[]") as string[];
    } catch {
      list = [];
    }
    const idx = list.indexOf(hashed);
    if (idx >= 0) {
      list.splice(idx, 1);
      await run(
        c.env.DB,
        "UPDATE users SET otp_recovery = ? WHERE id = ?",
        JSON.stringify(list),
        user.id,
      );
      ok = true;
    }
  }

  await run(
    c.env.DB,
    "INSERT INTO login_attempts (ip, ts, ok) VALUES (?, ?, ?)",
    ip,
    ts,
    ok ? 1 : 0,
  );
  if (!ok) return json(c, null, new Error("验证码不正确"));

  if (usedStep > 0)
    await run(
      c.env.DB,
      "UPDATE users SET otp_last_step = ? WHERE id = ?",
      usedStep,
      user.id,
    );

  return await issueSession(c, user);
});

// 显式挡掉 GET：登出有副作用（提升会话代次 = 全设备失效），
// 不能是"访问一个 URL 就生效"的动词。之前 GET 会落到 SPA 兜底返回 HTML 200，容易被误认为成功。
app.get("/api/logout", (c) => c.json({ success: false, msg: "use POST" }, 405));

app.post("/api/logout", async (c) => {
  // 光删 cookie 不算登出：JWT 还在有效期内，谁复制过这枚 cookie 就还照样能用。
  // 面板没有会话表，最接近「只登出这个人」的做法是把该用户的会话代次 +1
  // —— 代价是同一账号在其他设备上的会话也一起失效（单管理员场景下这是想要的效果）。
  const session = await currentUser(c);
  if (session?.uid) await bumpSessionEpoch(c.env.DB, session.uid);
  deleteCookie(c, COOKIE, { path: "/" });
  deleteCookie(c, MARKER_COOKIE, { path: "/" });
  return okMsg(c);
});

// 一键接入脚本：公开、无状态，只吐 bash（token 由用户在执行时传入）
app.get(
  "/install.sh",
  (c) =>
    new Response(installScript(baseUrl(c)), {
      status: 200,
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
);

// ---------- 对外健康检查与仲裁者（P4） ----------
//
// /health 只回"服务活着 + 当前代次"，不含任何节点/用户信息，供仲裁者从公网探活。
// 代次（epoch）是防脑裂的核心：谁被提升为主控，epoch 就 +1；落后代次的实例
// 只允许以只读身份启动（见 apps/selfhost/README.md）。

async function readControlState(db: Env["DB"]) {
  const rows = await all<{ key: string; value: string }>(
    db,
    "SELECT key, value FROM meta WHERE key IN ('control_epoch','control_primary','control_order','control_switched_at')",
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let order: string[] = [];
  try {
    order = JSON.parse(m.control_order ?? "[]") as string[];
  } catch {
    order = [];
  }
  return {
    epoch: Number(m.control_epoch ?? 0) || 0,
    primary: m.control_primary ?? "",
    order,
    switched_at: Number(m.control_switched_at ?? 0) || 0,
  };
}

app.get("/health", async (c) => {
  const st = await readControlState(c.env.DB);
  return c.json({
    ok: true,
    service: "sui-panel",
    epoch: st.epoch,
    primary: st.primary,
    ts: now(),
  });
});

// 仲裁者读写：令牌走 ops token（与备份同一个），GET 看状态，POST 推进代次
app.get("/api/arbiter", async (c) => {
  const tk = c.req.query("token") ?? "";
  if (!(await verifyOpsToken(c.env.DB, tk)))
    return json(c, null, new Error("unauthorized"));
  return json(c, await readControlState(c.env.DB));
});

app.post("/api/arbiter", async (c) => {
  const tk = c.req.query("token") ?? "";
  if (!(await verifyOpsToken(c.env.DB, tk)))
    return json(c, null, new Error("unauthorized"));
  const body = (await readBody(c)) as {
    epoch?: number;
    primary?: string;
    order?: string[];
    reason?: string;
  };
  const cur = await readControlState(c.env.DB);
  // Number("abc") 是 NaN，Math.max(NaN, n) 也是 NaN，落库就成了字符串 "NaN"；
  // 而所有读取方都用 `Number(x) || 0` 兜底，NaN 会被读成 0 —— 比任何历史代次都低，
  // 防脑裂的单调围栏当场失效。非法输入必须拒绝，不能写进控制面状态。
  const asked = Number(body.epoch ?? cur.epoch);
  if (!Number.isInteger(asked) || asked < 0)
    return json(c, null, new Error("epoch 必须是有限的非负整数"));
  const nextEpoch = Math.max(asked, cur.epoch);
  const stmts = [
    c.env.DB.prepare(
      "INSERT INTO meta (key,value) VALUES ('control_epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).bind(String(nextEpoch)),
    c.env.DB.prepare(
      "INSERT INTO meta (key,value) VALUES ('control_primary',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).bind(String(body.primary ?? cur.primary)),
    c.env.DB.prepare(
      "INSERT INTO meta (key,value) VALUES ('control_switched_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).bind(String(now())),
  ];
  if (Array.isArray(body.order)) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO meta (key,value) VALUES ('control_order',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(JSON.stringify(body.order)),
    );
  }
  await batch(c.env.DB, stmts);
  await run(
    c.env.DB,
    "INSERT INTO changes (node_id, ts, actor, kind, action, obj) VALUES (?, ?, ?, ?, ?, ?)",
    "",
    now(),
    "arbiter",
    "control",
    "switch",
    JSON.stringify({
      from: cur.epoch,
      to: nextEpoch,
      primary: body.primary ?? cur.primary,
      reason: body.reason ?? "",
    }),
  );
  return json(c, await readControlState(c.env.DB));
});

// ---------- 需要登录的 /api ----------

app.use("/api/*", async (c, next) => {
  const p = c.req.path;
  if (p.endsWith("/login") || p.endsWith("/login/otp") || p.endsWith("/logout"))
    return await next();
  // 拉备份令牌：只放行 getdb 一个端点，供备用机无人值守拉快照。
  // 用 verifyPullToken（backup 或 ops 均可），而不是 ops —— 两个令牌各管各的。
  if (p === "/api/getdb") {
    const tk = c.req.query("token") ?? "";
    if (tk && (await verifyPullToken(c.env.DB, tk))) {
      // 还没完成首次改密的实例，连备份都不给拉：此时库里是默认口令凭据，
      // 导出一份等于把“能用默认口令登录”的完整证据交给对方。
      const pending = await first<{ c: number }>(
        c.env.DB,
        "SELECT COUNT(*) c FROM users WHERE must_change = 1",
      );
      if ((pending?.c ?? 0) > 0)
        return json(
          c,
          null,
          new Error("panel not initialized: change the default password first"),
        );
      await run(
        c.env.DB,
        "INSERT INTO changes (node_id, ts, actor, kind, action, obj) VALUES (?, ?, ?, ?, ?, ?)",
        "",
        now(),
        "backup-token",
        "backup",
        "download",
        JSON.stringify({ ip: clientIp(c) }),
      );
      return await next();
    }
  }
  // 只读 API Token：给脚本/监控用（UI 里一直这么宣传，但原来从不校验）。
  // 只放行读接口，写接口一律要求真实会话 —— 令牌不该能改配置。
  // 兼容 Authorization: Bearer <t> 和 ?token=<t>（后者会进日志，文档里注明）。
  if (c.req.method === "GET") {
    const auth = c.req.header("Authorization") ?? "";
    const bearer = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    const tk = bearer || (c.req.query("token") ?? "");
    if (tk) {
      const row = await first<{ id: number; expiry: number }>(
        c.env.DB,
        "SELECT id, expiry FROM tokens WHERE token = ?",
        tk,
      );
      // 只保留「不含秘密」的读接口。
      // /api/load、/api/tls、/api/clients 都会返回 TLS/Reality 私钥与客户端 UUID/密码，
      // 给一个长期令牌读这些等于发了一把「随时导出全部凭据」的钥匙，与「只读监控」的用途不符。
      // 需要看配置的人应该用真会话登录。
      const READ_ONLY = new Set([
        "/api/status",
        "/api/servers",
        "/api/inbounds",
        "/api/outbounds",
        "/api/endpoints",
        "/api/services",
      ]);
      if (READ_ONLY.has(p) && tokenIsValid(row, now())) {
        // 打标：这几个端点的对象里住着私钥/密码/服务 token，令牌身份读到的响应
        // 必须过 redactForToken() 再出去。授权粒度是字段，不是端点名。
        c.set("tokenOnly" as never, true);
        return await next();
      }
    }
  }

  const session = await currentUser(c);
  if (!session) return json(c, null, unauthorized());
  const action = c.req.path.split("/").pop() ?? "";
  if (
    session.mustChange &&
    ![
      "changePass",
      "logout",
      "login",
      "users",
      // 不能放行 changes：它的 obj 是保存时的**完整对象**，含客户端 UUID/密码、
      // TLS/Reality 私钥、SS 服务端密码。默认口令会话能读它 = 绕过改密闸直接导出全部凭据。
      // 不能放行 tokens：默认口令的会话能读到明文 API token，等于把「必须先改密」这道闸绕过。
      "servers",
    ].includes(action)
  ) {
    return json(
      c,
      null,
      new Error("当前是默认密码，请先到「管理 → 修改密码」改成自己的密码"),
    );
  }
  c.set("user" as never, session.username as never);
  return await next();
});

// 顺序敏感：login/logout → /api/* 守卫 → 其余 /api 路由
registerApiRead(app);
registerSubInfo(app);
registerOps(app);
registerApiWrite(app);
registerOtpAdmin(app);

// 手动触发一次巡检。必须在 Cloudflare 定时事件之外提供，但它是一条**无人值守的写操作**
// （配额判定、到期停用、流量重置、数据清理），所以必须鉴权：
// Cloudflare 定时走 scheduled()，根本不需要这个路由；只有排障/测试才手动打。
// 没配 CRON_SECRET 时默认拒绝（fail closed），而不是默认放行。
app.all("/__cron", async (c) => {
  const want = (c.env as Env & { CRON_SECRET?: string }).CRON_SECRET ?? "";
  const got = c.req.header("x-cron-secret") ?? "";
  // 恒定时间比较：`!==` 的提前返回时机与内容相关。
  if (!want || !timingSafeEqual(got, want)) return c.text("forbidden", 403);
  await cronTick(c.env.DB);
  return c.text("ok");
});

// 未命中任何 Worker 路由 = 前端静态资源（含 SPA 深链兜底）。
// 交给 Assets 取，然后补上同一套安全头——静态响应不经过上面的 c.header。
app.notFound(async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env) {
    await cronTick(env.DB);
  },
};
