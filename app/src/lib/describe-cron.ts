const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const plural = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
const int = /^\d+$/;

/** Plain-words form of the common 5-field cron shapes; anything else is returned as written. */
export function describeCron(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = f;
  const step = (v: string) => (/^\*\/\d+$/.test(v) ? Number(v.slice(2)) : null);
  if (dom === "*" && mon === "*" && dow === "*") {
    if (min === "*" && hour === "*") return "Every minute";
    // A step is only a uniform interval when it divides the field's range (*/7 minutes ends with a 4-minute gap).
    const even = (n: number | null, range: number) => n !== null && n > 0 && n < range && range % n === 0;
    if (hour === "*" && even(step(min), 60)) return plural(step(min)!, "minute");
    if (hour === "*" && min === "0") return "Hourly";
    if (min === "0" && even(step(hour), 24)) return plural(step(hour)!, "hour");
    if (int.test(min) && int.test(hour) && +min < 60 && +hour < 24) return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  if (dom === "*" && mon === "*" && int.test(dow) && +dow <= 7 && int.test(min) && int.test(hour) && +min < 60 && +hour < 24) {
    return `${DAYS[+dow % 7]}s at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return cron;
}
