import { expect, test } from "bun:test";
import { cleanJsonText } from "../src/net.ts";

test("a JSON answer spoiled with stream leftovers is cleaned; good JSON and text pass through", () => {
  expect(cleanJsonText('{"a":1}\n\ndata: [DONE]')).toBe('{"a":1}');
  expect(cleanJsonText('{"s":"has } and \\" inside","n":[1,{"x":2}]}data: [DONE]')).toBe('{"s":"has } and \\" inside","n":[1,{"x":2}]}');
  expect(cleanJsonText('  {"ok":true}  ')).toBe('{"ok":true}');
  expect(cleanJsonText("plain text")).toBe("plain text");
});
