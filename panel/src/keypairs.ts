/**
 * /api/keypairs —— 上游 s-ui 的密钥生成接口。
 *
 * 前端的「一键添加」（QuickTemplate.vue）依赖它：
 *   k=reality        → 返回 ["PrivateKey: <b64url>", "PublicKey: <b64url>"]
 *   k=tls&o=<sni>    → 返回 PEM 行数组（私钥在前、证书在后）
 *
 * 返回结构与 node/service/server.go 的 GenKeypair 保持一致，
 * 前端是按行前缀解析的，格式不能随意改。
 */

/** base64url（无 padding），与 Go 的 base64.RawURLEncoding 对齐。 */
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 通用 PEM 编码（64 字符换行）。 */
function toPem(der: Uint8Array, label: string): string {
  let s = "";
  for (const b of der) s += String.fromCharCode(b);
  const b64 = btoa(s);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

/**
 * Reality 密钥对：X25519。
 *
 * workerd 对 X25519 的支持是分步骤落地的，generateKey 不一定可用，
 * 因此按「生成 → 导入标量 + basepoint 派生」两级降级，最后才报错。
 */
export async function realityKeypair(): Promise<string[]> {
  // SAFETY: workerd 的 SubtleCrypto 缺 X25519 的类型声明，这里只是把真实存在的
  // 同名方法窄化成一个可调用的形状；运行时对象就是 crypto.subtle 本身。
  const subtle = crypto.subtle as unknown as {
    generateKey: (
      a: unknown,
      e: boolean,
      u: string[],
    ) => Promise<CryptoKeyPair>;
    exportKey: (f: string, k: CryptoKey) => Promise<ArrayBuffer>;
    importKey: (
      f: string,
      d: BufferSource,
      a: unknown,
      e: boolean,
      u: string[],
    ) => Promise<CryptoKey>;
    deriveBits: (a: unknown, k: CryptoKey, len: number) => Promise<ArrayBuffer>;
  };

  const toRaw32 = async (
    key: CryptoKey,
    isPrivate: boolean,
  ): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(await subtle.exportKey("raw", key));
    } catch {
      // 私钥常常只能导出 pkcs8，取尾部 32 字节
      if (!isPrivate) return null;
      try {
        const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", key));
        return pkcs8.slice(-32);
      } catch {
        return null;
      }
    }
  };

  // ① 直接生成
  try {
    const kp = await subtle.generateKey({ name: "X25519" }, true, [
      "deriveBits",
    ]);
    const priv = await toRaw32(kp.privateKey, true);
    const pub = await toRaw32(kp.publicKey, false);
    if (priv && pub && priv.length === 32 && pub.length === 32) {
      return [`PrivateKey: ${b64url(priv)}`, `PublicKey: ${b64url(pub)}`];
    }
  } catch {
    /* 落到 ② */
  }

  // ② 自造标量 + basepoint(9) 派生公钥
  try {
    const scalar = crypto.getRandomValues(new Uint8Array(32));
    const privKey = await subtle.importKey(
      "raw",
      scalar,
      { name: "X25519" },
      true,
      ["deriveBits"],
    );
    const basepoint = new Uint8Array(32);
    basepoint[0] = 9;
    const baseKey = await subtle.importKey(
      "raw",
      basepoint,
      { name: "X25519" },
      true,
      [],
    );
    const pubRaw = new Uint8Array(
      await subtle.deriveBits(
        { name: "X25519", public: baseKey },
        privKey,
        256,
      ),
    );
    return [`PrivateKey: ${b64url(scalar)}`, `PublicKey: ${b64url(pubRaw)}`];
  } catch (e) {
    return [
      `Failed to generate Reality keypair: ${(e as Error)?.message ?? e}`,
    ];
  }
}

/**
 * 自签证书：ECDSA P-256 / SHA-256，有效期一年。
 * 上游用 12 个月，这里对齐。
 */
export async function tlsKeypair(serverName: string): Promise<string[]> {
  const sni =
    (serverName || "").trim() && serverName.trim() !== "''"
      ? serverName.trim()
      : "self-signed.local";
  try {
    const x509 = await import("@peculiar/x509");
    // SAFETY: 库要求传入 WebCrypto 的 Crypto 接口，workerd 的 globalThis.crypto
    // 实现该接口但类型定义不完全吻合，运行时是同一个对象。
    x509.cryptoProvider.set(crypto as unknown as Crypto);

    const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
    const keys = (await crypto.subtle.generateKey(alg, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const now = new Date();

    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "01",
      name: `CN=${sni}`,
      notBefore: now,
      notAfter: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
      signingAlgorithm: alg,
      keys,
      extensions: [
        new x509.BasicConstraintsExtension(true, undefined, true),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.digitalSignature |
            x509.KeyUsageFlags.keyEncipherment,
          true,
        ),
        new x509.ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"], false),
        // @peculiar/x509 的 SAN 是带参构造函数，不是静态 create
        new x509.SubjectAlternativeNameExtension([{ type: "dns", value: sni }]),
      ],
    });

    const certPem = cert.toString("pem");
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", keys.privateKey),
    );
    const keyPem = toPem(pkcs8, "PRIVATE KEY");

    return [...keyPem.split("\n"), ...certPem.split("\n")];
  } catch (e) {
    return [`Failed to generate TLS keypair: ${(e as Error)?.message ?? e}`];
  }
}

export async function generateKeypair(
  kind: string,
  options: string,
): Promise<string[]> {
  switch (kind) {
    case "reality":
      return realityKeypair();
    case "tls":
      return tlsKeypair(options);
    case "ech":
    case "wireguard":
      // 前端「一键添加」的模板不用这两个，明确回错而不是假装成功
      return [`keypairs: ${kind} 暂未实现（cf 面板只支持 reality / tls）`];
    default:
      return ["No keypair to generate"];
  }
}
