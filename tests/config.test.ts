import { describe, expect, it } from "vitest";
import { buildConfig } from "@/config";
import { MIN_SECRET_LENGTH } from "@/config/schema";
import { ConfigError } from "@/lib/errors";

/**
 * Configuration is the layer where a mistake is silent and expensive — an app
 * that boots with a weak key looks fine until it isn't. These tests pin the two
 * rules that matter: invalid values are always fatal, and production refuses to
 * fall back to development defaults.
 */

const base = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
const strongSecret = "a".repeat(MIN_SECRET_LENGTH);

describe("buildConfig", () => {
  it("applies sane defaults with an empty environment", () => {
    const config = buildConfig(base);
    expect(config.env).toBe("test");
    expect(config.appUrl).toBe("http://localhost:3000");
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe("info");
    expect(config.ai.model).toBe("claude-opus-5");
  });

  it("reports optional features as disabled when unconfigured", () => {
    const config = buildConfig(base);
    expect(config.ai.enabled).toBe(false);
    expect(config.google.enabled).toBe(false);
  });

  it("enables Google only when both halves of the credential are present", () => {
    expect(buildConfig({ ...base, GOOGLE_CLIENT_ID: "id" }).google.enabled).toBe(false);
    expect(
      buildConfig({ ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).google
        .enabled,
    ).toBe(true);
  });

  it("treats blank strings as unset rather than configured", () => {
    const config = buildConfig({ ...base, ANTHROPIC_API_KEY: "   ", GOOGLE_CLIENT_ID: "" });
    expect(config.ai.enabled).toBe(false);
    expect(config.google.enabled).toBe(false);
  });

  it("rejects an invalid value in every environment", () => {
    expect(() => buildConfig({ ...base, APP_URL: "not-a-url" })).toThrow(ConfigError);
    expect(() => buildConfig({ ...base, LOG_LEVEL: "verbose" })).toThrow(ConfigError);
    expect(() => buildConfig({ ...base, PORT: "0" })).toThrow(ConfigError);
    expect(() => buildConfig({ ...base, LUMA_EFFORT: "extreme" })).toThrow(ConfigError);
  });

  it("names the offending key without echoing its value", () => {
    try {
      // The value is what must not reach a log line — it could be an internal
      // hostname, or a secret pasted into the wrong variable.
      buildConfig({ ...base, APP_URL: "internal-host.corp.example" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("APP_URL");
      expect((error as ConfigError).message).not.toContain("internal-host.corp.example");
    }
  });

  it("normalizes a trailing slash on APP_URL so redirect URIs stay stable", () => {
    const config = buildConfig({ ...base, APP_URL: "https://luma.example.com/" });
    expect(config.appUrl).toBe("https://luma.example.com");
    expect(config.google.redirectUri).toBe(
      "https://luma.example.com/api/auth/google/callback",
    );
  });

  it("falls back to development secrets outside production", () => {
    const config = buildConfig({ ...base, NODE_ENV: "development" });
    expect(config.sessionSecret.length).toBeGreaterThan(0);
    expect(config.encryptionKey.length).toBeGreaterThan(0);
  });

  it("refuses to start in production without secrets", () => {
    expect(() => buildConfig({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET is required/);
    expect(() =>
      buildConfig({ NODE_ENV: "production", SESSION_SECRET: strongSecret }),
    ).toThrow(/ENCRYPTION_KEY is required/);
  });

  it("refuses a short secret in production", () => {
    expect(() =>
      buildConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "too-short",
        ENCRYPTION_KEY: strongSecret,
      }),
    ).toThrow(/at least/);
  });

  it("accepts a fully configured production environment", () => {
    const config = buildConfig({
      NODE_ENV: "production",
      SESSION_SECRET: strongSecret,
      ENCRYPTION_KEY: `${strongSecret}b`,
      APP_URL: "https://luma.example.com",
    });
    expect(config.isProduction).toBe(true);
    expect(config.sessionSecret).toBe(strongSecret);
  });

  it("keeps demo mode off in production unless explicitly enabled", () => {
    const secrets = { SESSION_SECRET: strongSecret, ENCRYPTION_KEY: `${strongSecret}b` };
    expect(buildConfig({ NODE_ENV: "production", ...secrets }).demoMode).toBe(false);
    expect(
      buildConfig({ NODE_ENV: "production", ...secrets, ENABLE_DEMO_MODE: "true" }).demoMode,
    ).toBe(true);
    // ...and on by default everywhere else, so `npm run dev` just works.
    expect(buildConfig({ NODE_ENV: "development" }).demoMode).toBe(true);
  });
});

describe("describeConfig", () => {
  it("never includes a secret value", async () => {
    const { describeConfig } = await import("@/config");
    const config = buildConfig({
      ...base,
      ANTHROPIC_API_KEY: "sk-ant-super-secret",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_CLIENT_ID: "google-id",
      SESSION_SECRET: strongSecret,
    });
    const serialized = JSON.stringify(describeConfig(config));

    expect(serialized).not.toContain("sk-ant-super-secret");
    expect(serialized).not.toContain("google-secret");
    expect(serialized).not.toContain(strongSecret);
    // It still says whether things are configured, which is the useful part.
    expect(serialized).toContain('"ai":true');
    expect(serialized).toContain('"SESSION_SECRET":true');
  });
});
