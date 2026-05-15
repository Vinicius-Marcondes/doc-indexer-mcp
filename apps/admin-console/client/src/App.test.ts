import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient } from "@tanstack/react-query";
import type { AdminUser } from "@bun-dev-intel/admin-contracts";
import {
  LoginPageView,
  ShellChrome,
  hasLoginErrors,
  resolveProtectedRedirect,
  validateLoginForm
} from "./App";
import {
  adminSessionQueryKey,
  clearAdminSessionCache
} from "./session";
import { AdminApiClient } from "./api-client";

const viewer: AdminUser = {
  id: 2,
  email: "viewer@example.com",
  role: "viewer"
};

describe("admin React shell", () => {
  test("login form renders email, password, and submit controls", () => {
    const html = renderToStaticMarkup(
      createElement(LoginPageView, {
        email: "",
        password: "",
        errors: {},
        apiError: null,
        isSubmitting: false,
        onEmailChange: () => undefined,
        onPasswordChange: () => undefined,
        onSubmit: () => undefined
      })
    );

    expect(html).toContain("type=\"email\"");
    expect(html).toContain("type=\"password\"");
    expect(html).toContain("Sign in");
  });

  test("login form validation catches invalid email and missing password", () => {
    const errors = validateLoginForm({ email: "viewer", password: "" });

    expect(hasLoginErrors(errors)).toBe(true);
    expect(errors.email).toBe("Enter a valid email address.");
    expect(errors.password).toBe("Enter your password.");
    expect(hasLoginErrors(validateLoginForm({ email: "viewer@example.com", password: "secret" }))).toBe(false);
  });

  test("auth guard redirects anonymous users away from admin routes", () => {
    expect(resolveProtectedRedirect(null, "/sources")).toBe("/login?from=%2Fsources");
    expect(resolveProtectedRedirect(undefined, "/jobs")).toBe("/login?from=%2Fjobs");
    expect(resolveProtectedRedirect(viewer, "/overview")).toBeNull();
  });

  test("shell navigation renders after authenticated session data is available", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/overview"] },
        createElement(ShellChrome, {
          user: viewer,
          isLoggingOut: false,
          onLogout: () => undefined,
          children: createElement("div", null, "workspace")
        })
      )
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Sources");
    expect(html).toContain("Jobs");
    expect(html).toContain("Search Lab");
    expect(html).toContain("Audit");
    expect(html).toContain("viewer@example.com");
    expect(html).toContain("viewer");
  });

  test("logout clears cached session state", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(adminSessionQueryKey, viewer);

    clearAdminSessionCache(queryClient);

    expect(queryClient.getQueryData(adminSessionQueryKey)).toBeNull();
  });

  test("API client treats unauthorized /me as anonymous and keeps credentials on requests", async () => {
    const requests: RequestInit[] = [];
    const client = new AdminApiClient({
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {});

        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "unauthorized",
              message: "Authentication is required.",
              status: 401
            }
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        );
      }) as typeof fetch
    });

    expect(await client.getMe()).toBeNull();
    expect(requests[0]?.credentials).toBe("include");
  });
});
