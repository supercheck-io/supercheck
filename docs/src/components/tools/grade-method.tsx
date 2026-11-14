// The security header methodology, printed so a grade can be reproduced by hand.
// Must match tools-api/src/grade.ts.
const RULES: [string, string, string][] = [
  ["Content-Security-Policy", "Missing (report-only counts as missing)", "−25"],
  ["", "script-src (or script-src-elem / script-src-attr) allows 'unsafe-inline' without a nonce or hash, data:, * or http:", "−20"],
  ["", "script-src allows 'unsafe-eval'", "−10"],
  ["", "No unsafe sources and object-src 'none'", "+5"],
  ["Strict-Transport-Security", "Missing, invalid, or the final URL is http", "−20"],
  ["", "max-age under six months", "−10"],
  ["", "max-age of a year or more, includeSubDomains and preload", "+5"],
  ["X-Content-Type-Options", "Not nosniff", "−5"],
  ["Framing", "No X-Frame-Options (DENY or SAMEORIGIN) and no CSP frame-ancestors", "−20"],
  ["", "CSP frame-ancestors set", "+5"],
  ["Referrer-Policy", "no-referrer, same-origin, strict-origin or strict-origin-when-cross-origin", "+5"],
  ["", "unsafe-url, origin, origin-when-cross-origin, or invalid", "−5"],
  ["Permissions-Policy, COOP", "Shown, not scored", "0"],
];
const GRADES = "A+ 100+ · A 90–99 · A− 85–89 · B+ 80–84 · B 70–79 · B− 65–69 · C+ 60–64 · C 50–59 · C− 45–49 · D+ 40–44 · D 30–39 · D− 25–29 · F 0–24";

export function GradeMethod() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <h2 className="text-2xl font-semibold tracking-tight">Scoring rules</h2>
      <p className="mt-3 max-w-2xl text-sm text-fd-muted-foreground">
        We start at 100 and apply each rule. Bonuses count only when the score is already 90 or more. The score never goes below 0.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-fd-border bg-fd-background">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-xs text-fd-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Header</th>
              <th scope="col" className="px-4 py-2 font-medium">Condition</th>
              <th scope="col" className="px-4 py-2 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map(([header, condition, score]) => (
              <tr key={condition} className="border-t border-fd-border">
                <td className="px-4 py-2 font-medium">{header}</td>
                <td className="px-4 py-2 text-fd-muted-foreground">{condition}</td>
                <td className="px-4 py-2 font-mono">{score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-fd-muted-foreground">Grades: {GRADES}.</p>
    </div>
  );
}
