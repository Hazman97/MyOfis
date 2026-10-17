const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Plain-words description of the common 5-field cron shapes the owner uses
 * ("Weekdays at 08:00", "Every night at 02:00"). Falls back to null for anything
 * unusual; the UI then shows the raw expression only.
 */
export function describeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*") return null;
  if (!/^\d+$/.test(min)) return null;
  const mm = min.padStart(2, "0");
  if (hour === "*") return dow === "*" ? `Every hour at :${mm}` : null;
  if (!/^\d+$/.test(hour)) return null;
  const at = `${hour.padStart(2, "0")}:${mm}`;
  const h = Number(hour);
  if (dow === "*") return h < 6 || h >= 22 ? `Every night at ${at}` : `Every day at ${at}`;
  if (dow === "1-5") return `Weekdays at ${at}`;
  if (dow === "0,6" || dow === "6,0") return `Weekends at ${at}`;
  if (/^[0-6]$/.test(dow)) return `Every ${DAYS[Number(dow)]} at ${at}`;
  if (/^[0-6](,[0-6])+$/.test(dow)) return `${dow.split(",").map((d) => DAYS[Number(d)]).join(", ")} at ${at}`;
  return null;
}
