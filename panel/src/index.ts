// @peculiar/x509 依赖 tsyringe，必须先加载反射 polyfill，且必须在其它 import 之前
import "reflect-metadata";
// 面板入口：只做「装配」——安全头、登录、鉴权守卫，其余路由在 routes/ 下。
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { COOKIE, ensureAdmin, login as doLogin, signJWT } from "./auth";
import { first, now, run, type Env } from "./db";
import { MARKER_COOKIE, currentUser, json, okMsg, secretOf } from "./http";
import { cronTick } from "./cron";
import { registerSub } from "./routes/sub";
import { registerAgentApi } from "./routes/agent-api";
import { registerApiRead } from "./routes/api-read";
import { registerApiWrite } from "./routes/api-write";

type Ctx = { Bindings: Env };

const app = new Hono<Ctx>();

registerSub(app);
registerAgentApi(app);

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
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // 私有面板不该被搜索引擎收录
  "X-Robots-Tag": "noindex, nofollow",
};

app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
});

// ---------- 登录 ----------

app.post("/api/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const ts = now();
  const recent = await first<{ c: number }>(
    c.env.DB,
    "SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND ts > ? AND ok = 0",
    ip,
    ts - 300,
  );
  if ((recent?.c ?? 0) >= 8)
    return json(
      c,
      null,
      new Error("too many failed attempts, retry in a few minutes"),
    );

  const body = await c.req.parseBody();
  await ensureAdmin(c.env.DB, c.env.ADMIN_USER, c.env.ADMIN_PASS);
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
  const mustChange = user.must_change === 1;
  const token = await signJWT(
    { u: user.username, uid: user.id, mc: mustChange },
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
  // 前端路由守卫读的是 document.cookie 里的 `s-ui`（沿用它原来的名字）。
  // 这个只是"已登录"标记，读得到也无所谓；真正的凭据是上面那个 HttpOnly cookie。
  setCookie(c, MARKER_COOKIE, "1", {
    httpOnly: false,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400,
    secure: isHttps,
  });
  return json(c, { must_change: mustChange });
});

app.get("/api/logout", async (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  deleteCookie(c, MARKER_COOKIE, { path: "/" });
  return okMsg(c);
});

// ---------- 需要登录的 /api ----------

app.use("/api/*", async (c, next) => {
  const p = c.req.path;
  if (p.endsWith("/login") || p.endsWith("/logout")) return await next();
  const session = await currentUser(c);
  if (!session) return json(c, null, new Error("Invalid login"));
  const action = c.req.path.split("/").pop() ?? "";
  if (
    session.mustChange &&
    ![
      "changePass",
      "logout",
      "login",
      "users",
      "changes",
      "tokens",
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
registerApiWrite(app);

app.all("/__cron", async (c) => {
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
