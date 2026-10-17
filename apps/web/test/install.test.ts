import { describe, expect, test } from "bun:test";
import { installCommands, isLoopbackUrl } from "../src/install.ts";

describe("install commands", () => {
  test("one line per OS, pointing at the hub with the code", () => {
    const [win, nix] = installCommands("http://192.168.1.50:8788/", "AB12-CD34");
    expect(win!.text).toBe('irm "http://192.168.1.50:8788/install.ps1?code=AB12-CD34" | iex');
    expect(nix!.text).toBe('curl -fsSL "http://192.168.1.50:8788/install.sh?code=AB12-CD34" | sh');
  });

  test("behind Cloudflare Access the commands send the service token headers", () => {
    const [win, nix] = installCommands("https://office.example.com", "AB12-CD34", true);
    expect(win!.text).toContain('"CF-Access-Client-Id" = $env:CF_ACCESS_CLIENT_ID');
    expect(nix!.text).toContain('-H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"');
  });

  test("loopback addresses are flagged", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8788")).toBe(true);
    expect(isLoopbackUrl("http://localhost:5180")).toBe(true);
    expect(isLoopbackUrl("http://192.168.1.50:8788")).toBe(false);
    expect(isLoopbackUrl("https://office.example.com")).toBe(false);
  });
});
