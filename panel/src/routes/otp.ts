// 二次验证（TOTP）的绑定与关闭。
//
// 设计上只有三条规则要守住：
//  1. 绑定必须"先验证再启用"：只生成密钥不算，要用户拿 App 输一次码，确认装对了。
//  2. 关闭必须再验证一次（TOTP 码或恢复码），否则临时拿到会话说关就关，等于没加。
//  3. 恢复码只在启用那一刻明文返回一次，库里只有 sha256——和密码同样的处理。
import type { Hono } from "hono";
import { first, now, run, type Env, type UserRow } from "../db";
import { json, okMsg, readBody } from "../http";
import {
  hashRecovery,
  newRecoveryCodes,
  newSecret,
  otpauthURI,
  totpVerify,
} from "../otp";

async function me(c: any): Promise<UserRow | null> {
  const name = c.get("user" as never) as string | undefined;
  if (!name) return null;
  return await first<UserRow>(
    c.env.DB,
    "SELECT * FROM users WHERE username = ?",
    name,
  );
}

/** 校验一次 TOTP 或恢复码；恢复码用掉即作废 */
async function checkProof(
  db: Env["DB"],
  user: UserRow,
  code: string,
): Promise<boolean> {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 6 && user.otp_secret) {
    const step = await totpVerify(user.otp_secret, digits, Number(user.otp_last_step ?? 0));
    if (step > 0) {
      await run(db, "UPDATE users SET otp_last_step = ? WHERE id = ?", step, user.id);
      return true;
    }
    return false;
  }
  let list: string[] = [];
  try {
    list = JSON.parse(user.otp_recovery || "[]") as string[];
  } catch {
    list = [];
  }
  const idx = list.indexOf(await hashRecovery(code));
  if (idx < 0) return false;
  list.splice(idx, 1);
  await run(
    db,
    "UPDATE users SET otp_recovery = ? WHERE id = ?",
    JSON.stringify(list),
    user.id,
  );
  return true;
}

export function registerOtpAdmin(app: Hono<{ Bindings: Env }>) {
  app.get("/api/otp/status", async (c) => {
    const user = await me(c);
    if (!user) return json(c, null, new Error("Invalid login"));
    let left = 0;
    try {
      left = (JSON.parse(user.otp_recovery || "[]") as string[]).length;
    } catch {
      left = 0;
    }
    return json(c, { on: user.otp_on === 1, recovery_left: left });
  });

  // 生成待绑定的密钥。otp_on 保持 0，直到用户输对一次码。
  app.post("/api/otp/setup", async (c) => {
    const user = await me(c);
    if (!user) return json(c, null, new Error("Invalid login"));
    if (user.otp_on === 1)
      return json(c, null, new Error("二次验证已开启，请先关闭再重新绑定"));
    const secret = newSecret();
    await run(c.env.DB, "UPDATE users SET otp_secret = ? WHERE id = ?", secret, user.id);
    return json(c, {
      secret,
      uri: otpauthURI(secret, user.username),
    });
  });

  app.post("/api/otp/enable", async (c) => {
    const user = await me(c);
    if (!user) return json(c, null, new Error("Invalid login"));
    if (!user.otp_secret)
      return json(c, null, new Error("请先生成密钥"));
    const body = await readBody(c);
    const code = String(body.code ?? "");
    const step = await totpVerify(user.otp_secret, code, 0);
    if (!step)
      return json(c, null, new Error("验证码不正确（检查手机时间是否自动同步）"));

    const codes = newRecoveryCodes(10);
    const hashed: string[] = [];
    for (const rc of codes) hashed.push(await hashRecovery(rc));

    // 注意：这里不写 otp_last_step。
    // 写了会把当前 30 秒窗口消耗掉，用户"刚绑定完就退出重登"会立刻被拒——
    // 防重放针对的是"登录成功后同一个码不能再用"，不是"绑定动作本身"。
    await run(
      c.env.DB,
      "UPDATE users SET otp_on = 1, otp_last_step = 0, otp_recovery = ? WHERE id = ?",
      JSON.stringify(hashed),
      user.id,
    );
    // 恢复码只在这里明文出现一次
    return json(c, { recovery: codes });
  });

  app.post("/api/otp/recovery", async (c) => {
    const user = await me(c);
    if (!user) return json(c, null, new Error("Invalid login"));
    if (user.otp_on !== 1) return json(c, null, new Error("二次验证未开启"));
    const body = await readBody(c);
    if (!(await checkProof(c.env.DB, user, String(body.code ?? ""))))
      return json(c, null, new Error("验证码不正确"));

    const codes = newRecoveryCodes(10);
    const hashed: string[] = [];
    for (const rc of codes) hashed.push(await hashRecovery(rc));
    await run(
      c.env.DB,
      "UPDATE users SET otp_recovery = ? WHERE id = ?",
      JSON.stringify(hashed),
      user.id,
    );
    return json(c, { recovery: codes });
  });

  // 关闭：必须提供 TOTP 码或恢复码。手机丢了也能用恢复码关掉。
  app.post("/api/otp/disable", async (c) => {
    const user = await me(c);
    if (!user) return json(c, null, new Error("Invalid login"));
    if (user.otp_on !== 1) return okMsg(c, "already off");
    const body = await readBody(c);
    if (!(await checkProof(c.env.DB, user, String(body.code ?? ""))))
      return json(c, null, new Error("验证码不正确"));

    await run(
      c.env.DB,
      "UPDATE users SET otp_on = 0, otp_secret = '', otp_last_step = 0, otp_recovery = '[]' WHERE id = ?",
      user.id,
    );
    return okMsg(c, "disabled");
  });

  // 兜底：机器丢了、恢复码也丢了，仍可由运维在服务器上执行 SQL 关闭
  app.get("/api/otp/help", async (c) => {
    const user = await me(c);
    if (!user) return json(c, null, new Error("Invalid login"));
    return json(c, {
      sql: `UPDATE users SET otp_on = 0, otp_secret = '', otp_recovery = '[]' WHERE username = '${user.username}'`,
      at: now(),
    });
  });
}
