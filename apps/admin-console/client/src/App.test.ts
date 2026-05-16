import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient } from "@tanstack/react-query";
import type { AdminUser } from "@bun-dev-intel/admin-contracts";
import {
  describeLoginError,
  LoginPageView,
  ShellChrome,
  hasLoginErrors,
  readLoginFormData,
  resolveProtectedRedirect,
  validateLoginForm
} from "./App";
import {
  adminSessionQueryKey,
  clearAdminSessionCache
} from "./session";
import {
  AdminApiClient,
  AdminApiClientError,
  AdminApiNetworkError,
  AdminApiUnexpectedResponseError
} from "./api-client";

const viewer: AdminUser = {
  id: 2,
  email: "viewer@example.com",
  role: "viewer"
};

describe("admin React shell", () => {
  test("login form renders email, password, and submit controls", () => {
    const html = renderToStaticMarkup(
      createElement(LoginPageView, {
        errors: {},
        apiError: null,
        isSubmitting: false
      })
    );

    expect(html).toContain("type=\"email\"");
    expect(html).toContain("name=\"email\"");
    expect(html).toContain("type=\"password\"");
    expect(html).toContain("name=\"password\"");
    expect(html).not.toContain("value=\"\"");
    expect(html).toContain("Sign in");
  });

  test("login submit reads browser-populated form values", () => {
    const formData = new FormData();
    formData.set("email", "admin@example.com");
    formData.set("password", "secret");

    expect(readLoginFormData(formData)).toEqual({
      email: "admin@example.com",
      password: "secret"
    });
  });

  test("login form validation catches invalid email and missing password", () => {
    const errors = validateLoginForm({ email: "viewer", password: "" });

    expect(hasLoginErrors(errors)).toBe(true);
    expect(errors.email).toBe("Enter a valid email address.");
    expect(errors.password).toBe("Enter your password.");
    expect(hasLoginErrors(validateLoginForm({ email: "viewer@example.com", password: "secret" }))).toBe(false);
  });

  test("login error message distinguishes API errors from client-side failures", () => {
    expect(describeLoginError(null)).toBeNull();
    expect(
      describeLoginError(
        new AdminApiClientError({
          ok: false,
          error: {
            code: "invalid_credentials",
            message: "Invalid email or password.",
            status: 401
          }
        })
      )
    ).toBe("Invalid email or password.");
    expect(describeLoginError(new Error("boom"))).toBe("The login request did not reach the admin API.");
    expect(
      describeLoginError(
        new AdminApiNetworkError({
          path: "/api/admin/auth/login",
          requestId: "request-1",
          cause: new TypeError("Failed to fetch")
        })
      )
    ).toBe("Could not reach the admin API. Confirm the admin console page and API are using the same origin. Request ID: request-1");
    expect(
      describeLoginError(
        new AdminApiUnexpectedResponseError({
          path: "/api/admin/auth/login",
          status: 200,
          contentType: "text/html",
          bodyKind: "html",
          requestId: "request-2",
          reason: "invalid_json"
        })
      )
    ).toBe(
      "The login endpoint returned HTML instead of admin API JSON. Check that /api/admin/* is routed to the admin API before the frontend fallback. Request ID: request-2"
    );
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
      createRequestId: () => "request-3",
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
    expect(new Headers(requests[0]?.headers).get("x-request-id")).toBe("request-3");
  });

  test("API client sends request IDs and parses successful login responses", async () => {
    const requests: Array<{ readonly url: string | URL | Request; readonly init: RequestInit }> = [];
    const client = new AdminApiClient({
      createRequestId: () => "request-4",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url, init: init ?? {} });

        return new Response(
          JSON.stringify({
            ok: true,
            user: viewer
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": "request-4"
            }
          }
        );
      }) as typeof fetch
    });

    await expect(client.login({ email: "viewer@example.com", password: "secret" })).resolves.toEqual(viewer);
    expect(String(requests[0]?.url)).toBe("/api/admin/auth/login");
    expect(requests[0]?.init.credentials).toBe("include");
    expect(new Headers(requests[0]?.init.headers).get("x-request-id")).toBe("request-4");
  });

  test("API client binds the default native fetch to globalThis", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ readonly thisValue: unknown; readonly url: string | URL | Request; readonly init: RequestInit }> = [];

    globalThis.fetch = (async function fakeFetch(this: unknown, url: string | URL | Request, init?: RequestInit) {
      requests.push({ thisValue: this, url, init: init ?? {} });

      return new Response(
        JSON.stringify({
          ok: true,
          user: viewer
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-bound"
          }
        }
      );
    }) as typeof fetch;

    try {
      const client = new AdminApiClient({ createRequestId: () => "request-bound" });

      await expect(client.login({ email: "viewer@example.com", password: "secret" })).resolves.toEqual(viewer);
      expect(requests[0]?.thisValue).toBe(globalThis);
      expect(String(requests[0]?.url)).toBe("/api/admin/auth/login");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("API client surfaces network failures with request IDs", async () => {
    const client = new AdminApiClient({
      createRequestId: () => "request-5",
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch
    });

    try {
      await client.login({ email: "viewer@example.com", password: "secret" });
      throw new Error("Expected login to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiNetworkError);
      expect((error as AdminApiNetworkError).request.requestId).toBe("request-5");
      expect((error as AdminApiNetworkError).request.path).toBe("/api/admin/auth/login");
    }
  });

  test("API client surfaces HTML fallback responses as unexpected API responses", async () => {
    const client = new AdminApiClient({
      createRequestId: () => "request-6",
      fetchImpl: (async () =>
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "x-request-id": "request-6"
          }
        })) as typeof fetch
    });

    try {
      await client.login({ email: "viewer@example.com", password: "secret" });
      throw new Error("Expected login to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiUnexpectedResponseError);
      expect((error as AdminApiUnexpectedResponseError).response).toMatchObject({
        path: "/api/admin/auth/login",
        status: 200,
        contentType: "text/html",
        bodyKind: "html",
        requestId: "request-6",
        reason: "invalid_json"
      });
    }
  });
});
