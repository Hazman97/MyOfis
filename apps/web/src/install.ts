/** One-line runner install commands shown on the Runners page (served by the hub, see apps/hub/src/installer.ts). */
export function installCommands(hubUrl: string, code: string, cfAccess = false): { label: string; text: string }[] {
  const base = hubUrl.replace(/\/$/, "");
  const sh = `${base}/install.sh?code=${encodeURIComponent(code)}`;
  const ps1 = `${base}/install.ps1?code=${encodeURIComponent(code)}`;
  if (cfAccess) {
    return [
      { label: "Windows", text: `irm "${ps1}" -Headers @{ "CF-Access-Client-Id" = $env:CF_ACCESS_CLIENT_ID; "CF-Access-Client-Secret" = $env:CF_ACCESS_CLIENT_SECRET } | iex` },
      { label: "Linux / Mac", text: `curl -fsSL -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" "${sh}" | sh` },
    ];
  }
  return [
    { label: "Windows", text: `irm "${ps1}" | iex` },
    { label: "Linux / Mac", text: `curl -fsSL "${sh}" | sh` },
  ];
}

/** True when the URL only works on the hub's own machine. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");
  } catch {
    return false;
  }
}
