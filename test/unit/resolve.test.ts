import { describe, expect, it } from "vitest";

import { resolveConnection } from "../../src/core/config/resolve.js";
import type { ProfilesStore } from "../../src/core/config/store.js";

const store: ProfilesStore = {
  currentProfile: "default",
  currentTarget: {
    url: "http://target:5984",
    user: "target-user",
    db: "target-db"
  },
  profiles: {
    default: {
      url: "http://profile:5984",
      user: "profile-user",
      password: "profile-password",
      db: "profile-db"
    }
  },
  sessions: {
    "http://profile:5984::profile-user": {
      url: "http://profile:5984",
      user: "profile-user",
      cookie: "AuthSession=abc",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  }
};

describe("resolveConnection", () => {
  it("uses CLI options over env and profile", () => {
    const resolved = resolveConnection(
      {
        url: "http://cli:5984",
        user: "cli-user",
        password: "cli-password",
        db: "cli-db",
        timeout: "5000",
        json: true
      },
      store,
      {},
      {
        COUCH_URL: "http://env:5984",
        COUCH_DB: "env-db",
        COUCH_USER: "env-user",
        COUCH_PASSWORD: "env-password"
      }
    );

    expect(resolved.url).toBe("http://cli:5984");
    expect(resolved.db).toBe("cli-db");
    expect(resolved.user).toBe("cli-user");
    expect(resolved.password).toBe("cli-password");
    expect(resolved.timeoutMs).toBe(5000);
    expect(resolved.json).toBe(true);
  });

  it("falls back to profile and resolves matching session cookie", () => {
    const resolved = resolveConnection({}, store, {}, {});

    expect(resolved.url).toBe("http://profile:5984");
    expect(resolved.db).toBe("profile-db");
    expect(resolved.user).toBe("profile-user");
    expect(resolved.sessionCookie).toBe("AuthSession=abc");
  });

  it("falls back to current target when no profile is active", () => {
    const resolved = resolveConnection(
      {},
      {
        ...store,
        currentProfile: undefined
      },
      {},
      {}
    );

    expect(resolved.url).toBe("http://target:5984");
    expect(resolved.user).toBe("target-user");
    expect(resolved.db).toBe("target-db");
  });
});
