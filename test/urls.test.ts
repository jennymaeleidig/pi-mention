import assert from "node:assert/strict";
import { test } from "node:test";
import { detectUrls } from "../src/pi/catalogs/urls.ts";
import { defaultSettings } from "../src/core/settings.ts";
import type { Range } from "../src/core/types.ts";

const settings = defaultSettings();

function urlTexts(text: string, masked: Range[] = []): string[] {
  return detectUrls(text, masked, settings.url).map((mention) =>
    text.slice(mention.span.start, mention.span.end),
  );
}

test("explicit URLs colour and trailing punctuation stays prose", () => {
  assert.deepEqual(urlTexts("See https://example.com/path?q=1. Now"), [
    "https://example.com/path?q=1",
  ]);
  assert.deepEqual(urlTexts("mailto:a@example.com"), ["mailto:a@example.com"]);
});

test("fuzzy hosts colour, source-file names do not", () => {
  assert.deepEqual(urlTexts("github.com and example.dev"), ["github.com", "example.dev"]);
  assert.deepEqual(urlTexts("README.md and script.py and foo.sh"), []);
});

test("masked code and mention ranges suppress URLs", () => {
  assert.deepEqual(urlTexts("`https://example.com`", [{ start: 0, end: 21 }]), []);
  assert.deepEqual(urlTexts("@https://example.com", [{ start: 0, end: 20 }]), []);
});

test("a URL inside prose keeps its exact offsets", () => {
  const [mention] = detectUrls("go to https://pi.dev/docs.", [], settings.url);
  assert.equal(mention?.span.start, 6);
  assert.equal(mention?.span.end, 25);
});
