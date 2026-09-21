import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACTION,
  isSensitivePath,
  previewValue,
  redactString,
  redactValue,
} from "./index";

const PRIVATE_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEpAIBAAKCAQEA7",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("redactString — patterns", () => {
  it("redacts a private key block as one unit", () => {
    const r = redactString(`before\n${PRIVATE_KEY}\nafter`);
    expect(r.value).toBe("before\n[REDACTED:private_key_block]\nafter");
    expect(r.redactedCount).toBe(1);
    expect(r.kinds).toEqual(["private_key_block"]);
  });

  it("redacts AWS access keys (AKIA and ASIA)", () => {
    const r = redactString("key AKIAIOSFODNN7EXAMPLE and ASIAIOSFODNN7EXAMPLE");
    expect(r.value).toBe("key [REDACTED:aws_access_key] and [REDACTED:aws_access_key]");
    expect(r.redactedCount).toBe(2);
  });

  it("redacts GitHub tokens (ghp_ and github_pat_)", () => {
    const r = redactString("ghp_aBcDeFgHiJkLmNoPqRsT1234 github_pat_11ABCDEFG0_aBcDeFgHiJkLmNoPqRs");
    expect(r.redactedCount).toBe(2);
    expect(r.kinds).toEqual(["github_token"]);
    expect(r.value).not.toContain("ghp_");
    expect(r.value).not.toContain("github_pat_11");
  });

  it("redacts Anthropic keys", () => {
    const r = redactString("sk-ant-api03-abcDEF123_-abcDEF123_-xyz");
    expect(r.value).toBe("[REDACTED:anthropic_key]");
    expect(r.kinds).toEqual(["anthropic_key"]);
  });

  it("redacts OpenAI keys including sk-proj- form", () => {
    const r = redactString("sk-abcDEF1234567890abcDEF12 then sk-proj-abcDEF1234567890abcDEF");
    expect(r.redactedCount).toBe(2);
    expect(r.kinds).toEqual(["openai_key"]);
  });

  it("labels an Anthropic key as anthropic_key, not openai_key", () => {
    const r = redactString("sk-ant-abcDEF123_-abcDEF123_-abcDEF123_-");
    expect(r.kinds).toEqual(["anthropic_key"]);
    expect(r.redactedCount).toBe(1);
  });

  it("redacts Slack tokens", () => {
    const r = redactString("xoxb-123456789012-abcdefghijkl");
    expect(r.value).toBe("[REDACTED:slack_token]");
  });

  it("redacts Google API keys", () => {
    const key = "AIza" + "x1Y".repeat(11) + "ab"; // exactly 35 chars after AIza
    const r = redactString(`key: ${key} done`);
    expect(r.value).toBe("key: [REDACTED:google_api_key] done");
  });

  it("redacts typesafe keys", () => {
    const r = redactString("ts_live_abcdef1234567890");
    expect(r.value).toBe("[REDACTED:typesafe_key]");
  });

  it("redacts JWTs", () => {
    const r = redactString("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-ghiJKL456");
    expect(r.value).toBe("[REDACTED:jwt]");
  });

  it("redacts bearer tokens but keeps the word Bearer", () => {
    const r = redactString("Authorization: Bearer abcdef1234567890TOKEN");
    expect(r.value).toBe("Authorization: Bearer [REDACTED:bearer_token]");
  });

  it("redacts URL credentials but keeps scheme and host", () => {
    const r = redactString("postgres://admin:hunter2p@db.internal:5432/app");
    expect(r.value).toBe("postgres://[REDACTED:url_credentials]@db.internal:5432/app");
  });

  it("redacts secret assignments, keeping key and separator", () => {
    const r = redactString("password=hunter2xyz");
    expect(r.value).toBe("password=[REDACTED:secret_assignment]");
  });

  it("redacts JSON-style secret assignments", () => {
    const r = redactString('{"client_secret": "abcd1234efgh"}');
    expect(r.value).toBe('{"client_secret": "[REDACTED:secret_assignment]"}');
  });

  it("does not redact .env.example-style placeholders", () => {
    const samples = [
      "password=<your-password-here>",
      "API_KEY=${MY_API_KEY}",
      "token=******",
      "secret=[REDACTED:secret_assignment]",
      "pwd=short",
      "OPENAI_API_KEY=<sk-...>",
    ];
    for (const s of samples) {
      const r = redactString(s);
      expect(r.value).toBe(s);
      expect(r.redactedCount).toBe(0);
    }
  });

  it("records kinds in order of first occurrence across mixed text", () => {
    const r = redactString("xoxb-123456789012-abcdefghijkl then AKIAIOSFODNN7EXAMPLE then xoxp-123456789012-abcdefghij");
    expect(r.kinds).toEqual(["slack_token", "aws_access_key"]);
    expect(r.redactedCount).toBe(3);
  });
});

describe("redactString — truncation", () => {
  it("truncates long strings with exact removed count", () => {
    const text = "a".repeat(2500);
    const r = redactString(text);
    expect(r.truncated).toBe(true);
    expect(r.value).toBe(`${"a".repeat(2000)}…[truncated 500 chars]`);
  });

  it("does not truncate strings at the limit", () => {
    const r = redactString("a".repeat(2000));
    expect(r.truncated).toBe(false);
    expect(r.value).toHaveLength(2000);
  });
});

describe("redactValue", () => {
  it("passes numbers, booleans, and null through unchanged", () => {
    const input = { n: 42, f: 3.14, b: true, z: null, list: [0, false, null] };
    const r = redactValue(input);
    expect(r.value).toEqual(input);
    expect(r.redactedCount).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.kinds).toEqual([]);
  });

  it("redacts a secret nested at depth 3", () => {
    const key = "sk-ant-" + "abcDEF123_-".repeat(3) + "xyz";
    const input = { a: { b: { c: { key } } } };
    const r = redactValue(input);
    expect(r.value).toEqual({ a: { b: { c: { key: "[REDACTED:anthropic_key]" } } } });
    expect(r.redactedCount).toBe(1);
  });

  it("does not redact object keys", () => {
    const r = redactValue({ AKIAIOSFODNN7EXAMPLE: "harmless" });
    expect(r.value).toEqual({ AKIAIOSFODNN7EXAMPLE: "harmless" });
  });

  it("truncates arrays and appends a marker with the dropped count", () => {
    const input = Array.from({ length: 55 }, (_, i) => i);
    const r = redactValue(input, { maxArrayLength: 50 });
    const out = r.value as unknown[];
    expect(r.truncated).toBe(true);
    expect(out).toHaveLength(51);
    expect(out[49]).toBe(49);
    expect(out[50]).toBe("…[truncated 5 items]");
  });

  it("replaces subtrees beyond maxDepth with the depth marker", () => {
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: "too deep" } } } } } } };
    const r = redactValue(deep);
    expect(r.truncated).toBe(true);
    const v = r.value as Record<string, unknown>;
    // root is depth 0, so the l6 object sits at depth 6 == maxDepth and is replaced whole
    const l5 = ((((v.l1 as Record<string, unknown>).l2 as Record<string, unknown>).l3 as Record<string, unknown>)
      .l4 as Record<string, unknown>).l5 as Record<string, unknown>;
    expect(l5.l6).toBe("[truncated: depth]");
  });

  it("handles circular references without hanging", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const r = redactValue(a);
    expect(r.value).toEqual({ name: "a", self: "[circular]" });
  });

  it("aggregates redactedCount and kinds across the whole walk", () => {
    const input = {
      env: ["AKIAIOSFODNN7EXAMPLE", "password=hunter2xyz"],
      headers: { auth: "Bearer abcdef1234567890TOKEN" },
    };
    const r = redactValue(input);
    expect(r.redactedCount).toBe(3);
    expect(r.kinds).toEqual(["aws_access_key", "secret_assignment", "bearer_token"]);
    expect(r.truncated).toBe(false);
  });

  it("stringifies unexpected values instead of throwing", () => {
    const r = redactValue({ fn: () => 1, sym: Symbol("tok") });
    const v = r.value as Record<string, unknown>;
    expect(typeof v.fn).toBe("string");
    expect(v.sym).toBe("Symbol(tok)");
  });
});

describe("previewValue", () => {
  it("returns the string itself, redacted", () => {
    expect(previewValue("key is AKIAIOSFODNN7EXAMPLE ok")).toBe("key is [REDACTED:aws_access_key] ok");
  });

  it("JSON-encodes objects as a single line", () => {
    const p = previewValue({ a: 1, b: { c: "x\ny\tz" } });
    expect(p).not.toContain("\n");
    expect(JSON.parse(p.replace(/…$/, ""))).toBeDefined();
  });

  it("caps output at previewLength plus ellipsis", () => {
    const p = previewValue("x".repeat(5000));
    expect(p.length).toBe(DEFAULT_REDACTION.previewLength + 1);
    expect(p.endsWith("…")).toBe(true);
  });

  it("does not append ellipsis when under the limit", () => {
    expect(previewValue("short")).toBe("short");
  });

  it("respects a custom previewLength", () => {
    const p = previewValue("x".repeat(100), { previewLength: 10 });
    expect(p).toBe(`${"x".repeat(10)}…`);
  });
});

describe("isSensitivePath re-export", () => {
  it("flags .env as sensitive", () => {
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath("config/.env.local")).toBe(true);
  });

  it("does not flag .env.example", () => {
    expect(isSensitivePath(".env.example")).toBe(false);
  });
});
