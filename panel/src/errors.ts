// 领域错误：给失败一个机器可读的 code，避免前端只能靠中文文案分支。
//
// 现状：所有失败都是 `new Error("中文句子")`，前端拿到 `{success:false,msg}` 之后
// 只能字符串匹配（"Invalid login" / "too many"…），改一句文案就断。
// 这里加一层：`code` 是稳定契约，`message` 才是给人看的。
//
// 注意：这是**增量**字段。老的 `new Error(...)` 仍然照常工作，只是没有 code；
// 逐个把关键路径换过来即可，不需要一次性迁移。

export type ErrCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrCode;

  constructor(code: ErrCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export const unauthorized = (m = "Invalid login") => new AppError("UNAUTHORIZED", m);
export const forbidden = (m = "forbidden") => new AppError("FORBIDDEN", m);
export const invalid = (m: string) => new AppError("VALIDATION", m);
export const notFound = (m = "not found") => new AppError("NOT_FOUND", m);
export const conflict = (m: string) => new AppError("CONFLICT", m);
export const rateLimited = (m = "too many failed attempts, retry in a few minutes") =>
  new AppError("RATE_LIMITED", m);
export const internal = (m = "internal error") => new AppError("INTERNAL", m);

/** 给响应层用：是不是我们认识的领域错误。 */
export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
