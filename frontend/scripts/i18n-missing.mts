import en from "../src/locales/en.ts";
import fa from "../src/locales/fa.ts";
import vi from "../src/locales/vi.ts";
import zhcn from "../src/locales/zhcn.ts";
import zhtw from "../src/locales/zhtw.ts";
import ru from "../src/locales/ru.ts";
function paths(o: any, p = ""): string[] {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    return Object.entries(o).flatMap(([k, v]) => paths(v, p ? `${p}.${k}` : k));
  }
  return [p];
}
const base = new Set(paths(en));
console.log("en:", base.size);
for (const [name, obj] of Object.entries({ fa, vi, zhcn, zhtw, ru })) {
  const set = new Set(paths(obj));
  const missing = [...base].filter((k) => !set.has(k));
  console.log(`${name}: ${set.size} / missing ${missing.length} (${Math.round((missing.length / base.size) * 100)}%)`);
  if (missing.length) console.log("   ", missing.slice(0, 6).join(", "));
}
