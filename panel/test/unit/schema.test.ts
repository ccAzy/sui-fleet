import { describe, expect, it } from "vitest";
import {
  AgentReportBody,
  ImportBundleSchema,
  SaveEnvelope,
  ValidationError,
  decode,
  tryDecode,
} from "../../src/schema";

// 边界校验的意义：脏输入在入口就被拒，业务层不必再 typeof。
describe("SaveEnvelope", () => {
  it("接受已知 object 与任意动作", () => {
    expect(SaveEnvelope.safeParse({ object: "inbounds", action: "new" }).success).toBe(true);
    expect(SaveEnvelope.safeParse({ object: "servers", action: "del" }).success).toBe(true);
  });

  it("拒绝未知 object（以前会掉进 saveObject 的 unknown 分支）", () => {
    expect(SaveEnvelope.safeParse({ object: "inboundz", action: "new" }).success).toBe(false);
  });

  it("拒绝空动作", () => {
    expect(SaveEnvelope.safeParse({ object: "clients", action: "" }).success).toBe(false);
  });
});

describe("AgentReportBody", () => {
  it("接受一次正常上报", () => {
    const r = AgentReportBody.safeParse({
      revision: 12,
      core_state: "running",
      traffic: [{ tag: "alice", up: 100, down: 200 }],
      commands: [{ id: 3, ok: true }],
    });
    expect(r.success).toBe(true);
  });

  it("允许负数流量（节点计数器会抖），但拒绝 NaN/Infinity", () => {
    expect(AgentReportBody.safeParse({ traffic: [{ up: -5 }] }).success).toBe(true);
    expect(AgentReportBody.safeParse({ traffic: [{ up: Number.NaN }] }).success).toBe(false);
    expect(AgentReportBody.safeParse({ traffic: [{ down: Number.POSITIVE_INFINITY }] }).success).toBe(false);
  });

  it("拒绝未知的 core_state", () => {
    expect(AgentReportBody.safeParse({ core_state: "zombie" }).success).toBe(false);
  });

  it("拒绝过长的日志（撑爆 status_json 的老问题）", () => {
    expect(AgentReportBody.safeParse({ last_log: "x".repeat(20001) }).success).toBe(false);
  });

  it("命令结果数量有上限", () => {
    const cmds = Array.from({ length: 501 }, (_, i) => ({ id: i, ok: true }));
    expect(AgentReportBody.safeParse({ commands: cmds }).success).toBe(false);
  });
});

describe("ImportBundleSchema", () => {
  it("接受表名 → 行数组", () => {
    expect(ImportBundleSchema.safeParse({ tables: { nodes: [], users: [{ id: 1 }] } }).success).toBe(true);
  });

  it("拒绝 tables 不是对象、或值不是数组", () => {
    expect(ImportBundleSchema.safeParse({ tables: [] }).success).toBe(false);
    expect(ImportBundleSchema.safeParse({ tables: { nodes: {} } }).success).toBe(false);
  });
});

describe("decode / tryDecode", () => {
  const S = SaveEnvelope;

  it("成功时返回解析后的值", () => {
    expect(decode(S, { object: "tls", action: "edit" }, "save").object).toBe("tls");
  });

  it("失败时抛 ValidationError，且带字段路径", () => {
    try {
      decode(S, { object: "nope", action: "x" }, "save");
      throw new Error("应当抛错");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const msg = (e as ValidationError).message;
      expect(msg).toContain("save 校验失败");
      expect(msg).toContain("object");
    }
  });

  it("tryDecode 不抛，返回 issues", () => {
    const r = tryDecode(S, { object: "nope", action: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });
});
