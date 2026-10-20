import { readFileSync } from "node:fs";
import { join } from "node:path";

// A native (pre-hydration) submit of a credential form must never be a GET: that would put the email and password
// in the URL, browser history and every proxy/server log. Guard every auth form so a new one cannot regress this.
const files = [
  "src/components/auth/login-form.tsx",
  "src/components/auth/signup-form.tsx",
  "src/app/(auth)/forgot-password/page.tsx",
  "src/app/(auth)/reset-password/page.tsx",
];

describe("credential forms", () => {
  it.each(files)("%s declares method=post on every <form>", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const forms = source.match(/<form\b[^>]*>/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const tag of forms) expect(tag).toMatch(/method=["']post["']/);
  });
});
