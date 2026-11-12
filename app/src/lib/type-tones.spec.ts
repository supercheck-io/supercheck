import { readFileSync } from "node:fs";
import { join } from "node:path";

import { monitorTypes } from "@/components/monitors/data";
import { types as testTypes } from "@/components/tests/data";
import { TYPE_CHIP, TYPE_TEXT, TYPE_TEXT_FORCE, TYPE_TONE, TYPE_TONES, typeText } from "./type-tones";

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
const [light, dark] = [css.slice(css.indexOf(":root"), css.indexOf(".dark {")), css.slice(css.indexOf(".dark {"), css.indexOf("@theme inline"))];

describe("type tones", () => {
  it("defines every tone token in light and dark with a muted chroma", () => {
    for (const tone of TYPE_TONES) {
      for (const block of [light, dark]) {
        const match = block.match(new RegExp(`--type-${tone}: oklch\\(([\\d.]+) ([\\d.]+) [\\d.]+\\);`));
        expect(match).not.toBeNull();
        expect(Number(match![2])).toBeLessThanOrEqual(0.1);
      }
      expect(css).toContain(`--color-type-${tone}: var(--type-${tone});`);
      expect(TYPE_TEXT[tone]).toBe(`text-type-${tone}`);
      expect(TYPE_TEXT_FORCE[tone]).toBe(`!text-type-${tone}`);
      expect(TYPE_CHIP[tone]).toBe(`bg-type-${tone}/10 text-type-${tone}`);
    }
  });

  it("gives every type inside one group its own tone", () => {
    for (const group of Object.values(TYPE_TONE)) {
      const tones = Object.values(group);
      // Jobs deliberately share the tone of the test engine they run.
      if (group === TYPE_TONE.job) continue;
      expect(new Set(tones).size).toBe(tones.length);
    }
    expect(TYPE_TONE.job.playwright).toBe(TYPE_TONE.test.browser);
    expect(TYPE_TONE.job.k6).toBe(TYPE_TONE.test.performance);
  });

  it("feeds the test and monitor type lists from the registry", () => {
    for (const t of testTypes) expect(t.color).toBe(typeText("test", t.value as keyof typeof TYPE_TONE.test));
    for (const t of monitorTypes) expect(t.color).toBe(typeText("monitor", t.value as keyof typeof TYPE_TONE.monitor));
  });

  it("keeps ad-hoc colours out of the type surfaces", () => {
    const read = (file: string) => readFileSync(join(SRC, file), "utf8");
    // Sidebar entries take their colour from the registry, never a literal class.
    expect(read("components/app-sidebar.tsx")).not.toMatch(/color: "/);
    // Command palette type items too.
    expect(read("components/ui/command-search.tsx")).not.toMatch(/!text-(automate|monitor)\b/);
    // Variable type icons and badges come from VARIABLE_TYPES.
    expect(read("components/variables/variable-dialog.tsx")).not.toMatch(/text-(red|green|blue)-\d{3}/);
  });
});
