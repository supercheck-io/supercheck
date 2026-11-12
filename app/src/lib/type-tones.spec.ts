import { readFileSync } from "node:fs";
import { join } from "node:path";

import { monitorTypes } from "@/components/monitors/data";
import { types as testTypes } from "@/components/tests/data";
import { TYPE_CHIP, TYPE_TEXT, TYPE_TEXT_FORCE, TYPE_TONE, TYPE_TONES, typeText } from "./type-tones";

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
const [light, dark] = [css.slice(css.indexOf(":root"), css.indexOf(".dark {")), css.slice(css.indexOf(".dark {"), css.indexOf("@theme inline"))];

describe("type tones", () => {
  it("defines every tone token in light and dark", () => {
    for (const tone of TYPE_TONES) {
      for (const block of [light, dark]) expect(block).toMatch(new RegExp(`--type-${tone}: oklch\\(`));
      expect(css).toContain(`--color-type-${tone}: var(--type-${tone});`);
      expect(TYPE_TEXT[tone]).toBe(`text-type-${tone}`);
      expect(TYPE_TEXT_FORCE[tone]).toBe(`!text-type-${tone}`);
      expect(TYPE_CHIP[tone]).toBe(`bg-type-${tone}/10 text-type-${tone}`);
    }
  });

  it("keeps the original test and monitor colours (Tailwind 600 light, 400 dark)", () => {
    const original = [
      ["sky", "0.588 0.158 241.966", "0.746 0.16 232.661"],
      ["teal", "0.6 0.118 184.704", "0.777 0.152 181.912"],
      ["cyan", "0.609 0.126 221.723", "0.789 0.154 211.53"],
      ["blue", "0.546 0.245 262.881", "0.707 0.165 254.624"],
      ["purple", "0.558 0.288 302.321", "0.714 0.203 305.504"],
    ];
    for (const [tone, l, d] of original) {
      expect(light).toContain(`--type-${tone}: oklch(${l});`);
      expect(dark).toContain(`--type-${tone}: oklch(${d});`);
    }
    expect(Object.values(TYPE_TONE.test)).toEqual(["sky", "teal", "cyan", "blue", "purple"]);
    expect(Object.values(TYPE_TONE.monitor)).toEqual(["teal", "sky", "cyan", "blue", "purple"]);
    expect(TYPE_TONE.job).toEqual({ playwright: "sky", k6: "purple" });
  });

  it("gives every other type its own tone, apart from the five tests and monitors share", () => {
    const shared = new Set<string>(Object.values(TYPE_TONE.test));
    const others = [TYPE_TONE.variable, TYPE_TONE.sre, TYPE_TONE.admin].flatMap((g) => Object.values(g));
    expect(new Set(others).size).toBe(others.length);
    for (const tone of others) expect(shared.has(tone)).toBe(false);
    for (const tone of Object.values(TYPE_TONE.monitor)) expect(shared.has(tone)).toBe(true);
    // No tone is defined without a user.
    const used = new Set<string>([...shared, ...others]);
    expect([...TYPE_TONES].filter((t) => !used.has(t))).toEqual([]);
  });

  it("defines the Organization and Super Admin area tokens", () => {
    for (const token of ["organization", "superadmin"]) {
      for (const block of [light, dark]) expect(block).toMatch(new RegExp(`--${token}: oklch\\(`));
    }
    // Status pages deliberately share the success green of the status page cards.
    for (const block of [light, dark]) expect(block).toContain("--statuspage: var(--success-strong);");
  });

  it("feeds the test and monitor type lists from the registry", () => {
    for (const t of testTypes) expect(t.color).toBe(typeText("test", t.value as keyof typeof TYPE_TONE.test));
    for (const t of monitorTypes) expect(t.color).toBe(typeText("monitor", t.value as keyof typeof TYPE_TONE.monitor));
  });

  it("keeps ad-hoc colours out of the type surfaces", () => {
    const read = (file: string) => readFileSync(join(SRC, file), "utf8");
    expect(read("components/app-sidebar.tsx")).not.toMatch(/color: "/);
    expect(read("components/ui/command-search.tsx")).not.toMatch(/text-(automate|monitor|sky|teal|cyan|blue|purple)\b/);
    expect(read("components/variables/variable-dialog.tsx")).not.toMatch(/text-(red|green|blue)-\d{3}/);
  });
});
