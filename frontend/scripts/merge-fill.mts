import { readFileSync, writeFileSync } from "node:fs";
const [localeFile, fillFile] = process.argv.slice(2);
const mod = await import(`../src/locales/${localeFile}.ts`);
const unwrap = (m: any) => (m && m.default && !m.success ? m.default : m);
const base = unwrap(mod.default ?? mod);
const fill = JSON.parse(readFileSync(fillFile, "utf8"));
const setp = (o: any, p: string, v: any) => {
  const parts = p.split(".");
  let cur = o;
  for (const k of parts.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = v;
};
let n = 0;
for (const [k, v] of Object.entries(fill)) {
  const parts = k.split(".");
  let has = true, cur: any = base;
  for (const p of parts) { if (cur == null || typeof cur !== "object" || !(p in cur)) { has = false; break; } cur = cur[p]; }
  if (has) continue;
  setp(base, k, v); n++;
}
const body = `export default ${JSON.stringify(base, null, 2)}\n`;
writeFileSync(`src/locales/${localeFile}.ts`, body, "utf8");
console.log(`${localeFile}: merged ${n} new keys`);
