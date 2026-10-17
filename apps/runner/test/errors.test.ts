import { describe, expect, test } from "bun:test";
import { describeError } from "../src/runtimes/errors.ts";

describe("describeError", () => {
  test("unwraps a retried OpenRouter 429 to the upstream reason", () => {
    const apiError = Object.assign(new Error("Provider returned error"), {
      statusCode: 429,
      responseBody: JSON.stringify({
        error: { message: "Provider returned error", code: 429, metadata: { raw: "google/gemma-4-31b-it:free is temporarily rate-limited upstream." } },
      }),
    });
    const retry = Object.assign(new Error("Failed after 3 attempts. Last error: Provider returned error"), { lastError: apiError });
    expect(describeError(retry)).toBe(
      "HTTP 429: google/gemma-4-31b-it:free is temporarily rate-limited upstream.: Provider returned error (after retries)",
    );
  });

  test("plain errors pass through", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("weird")).toBe("weird");
  });

  test("non-JSON body is shown briefly", () => {
    const e = Object.assign(new Error("Bad Gateway"), { statusCode: 502, responseBody: "<html>upstream down</html>" });
    expect(describeError(e)).toBe("HTTP 502: <html>upstream down</html>: Bad Gateway");
  });
});
