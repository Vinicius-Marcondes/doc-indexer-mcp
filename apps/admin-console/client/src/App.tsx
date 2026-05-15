import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Activity,
  Database,
  FileClock,
  LogOut,
  Search,
  ShieldCheck,
  UserRound
} from "lucide-react";
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router";
import { adminLoginRequestSchema, type AdminUser } from "@bun-dev-intel/admin-contracts";
import { AdminApiProvider, useAdminSession, useLoginMutation, useLogoutMutation } from "./session";
import { AdminApiClientError, AdminApiNetworkError, AdminApiUnexpectedResponseError } from "./api-client";
import { OverviewPage } from "./overview";
import {
  ChunkDetailPage,
  JobDetailPage,
  JobsPage,
  PageDetailPage,
  SourceDetailPage,
  SourcesPage
} from "./resource-views";
import { SearchLabPage } from "./search-lab";

export interface LoginFormState {
  readonly email: string;
  readonly password: string;
}

export interface LoginFormErrors {
  email?: string;
  password?: string;
}

export const navigationItems = [
  { to: "/overview", label: "Overview", icon: Activity },
  { to: "/sources", label: "Sources", icon: Database },
  { to: "/jobs", label: "Jobs", icon: FileClock },
  { to: "/search", label: "Search Lab", icon: Search },
  { to: "/audit", label: "Audit", icon: ShieldCheck }
] as const;

export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: false
      }
    }
  });
}

export function validateLoginForm(input: LoginFormState): LoginFormErrors {
  const errors: LoginFormErrors = {};
  const parsed = adminLoginRequestSchema.safeParse(input);

  if (parsed.success) {
    return errors;
  }

  for (const issue of parsed.error.issues) {
    if (issue.path[0] === "email") {
      errors.email = "Enter a valid email address.";
    }

    if (issue.path[0] === "password") {
      errors.password = "Enter your password.";
    }
  }

  return errors;
}

export function hasLoginErrors(errors: LoginFormErrors): boolean {
  return errors.email !== undefined || errors.password !== undefined;
}

export function readLoginFormData(formData: FormData): LoginFormState {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? "")
  };
}

export function readLoginFormState(form: HTMLFormElement): LoginFormState {
  return readLoginFormData(new FormData(form));
}

export function describeLoginError(error: unknown): string | null {
  if (error === null || error === undefined) {
    return null;
  }

  if (error instanceof AdminApiClientError) {
    return withRequestId(error.response.error.message, error.requestId);
  }

  if (error instanceof AdminApiNetworkError) {
    return withRequestId(
      "Could not reach the admin API. Confirm the admin console page and API are using the same origin.",
      error.request.requestId
    );
  }

  if (error instanceof AdminApiUnexpectedResponseError) {
    if (error.response.bodyKind === "html") {
      return withRequestId(
        "The login endpoint returned HTML instead of admin API JSON. Check that /api/admin/* is routed to the admin API before the frontend fallback.",
        error.response.requestId
      );
    }

    return withRequestId(
      `The admin API returned an unexpected response (${error.response.status}, ${error.response.reason}).`,
      error.response.requestId
    );
  }

  return "The login request did not reach the admin API.";
}

function withRequestId(message: string, requestId: string | null): string {
  return requestId === null ? message : `${message} Request ID: ${requestId}`;
}

export function resolveProtectedRedirect(user: AdminUser | null | undefined, pathname: string): string | null {
  if (user !== null && user !== undefined) {
    return null;
  }

  return `/login?from=${encodeURIComponent(pathname)}`;
}

export function App() {
  const queryClient = useMemo(() => createAdminQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AdminApiProvider>
        <BrowserRouter>
          <AdminRoutes />
        </BrowserRouter>
      </AdminApiProvider>
    </QueryClientProvider>
  );
}

export function TestRouterApp(props: { readonly initialPath?: string; readonly children?: ReactNode }) {
  return <MemoryRouter initialEntries={[props.initialPath ?? "/overview"]}>{props.children ?? <AdminRoutes />}</MemoryRouter>;
}

function AdminRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<AuthenticatedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/sources/:sourceId" element={<SourceDetailPage />} />
          <Route path="/sources/:sourceId/pages/:pageId" element={<PageDetailPage />} />
          <Route path="/sources/:sourceId/chunks/:chunkId" element={<ChunkDetailPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/search" element={<SearchLabPage />} />
          <Route path="/audit" element={<AuditPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

function AuthenticatedRoute() {
  const location = useLocation();
  const session = useAdminSession();

  if (session.isLoading) {
    return <FullPageState title="Loading session" tone="neutral" />;
  }

  if (session.isError) {
    return <FullPageState title="Session check failed" tone="danger" />;
  }

  const redirectTo = resolveProtectedRedirect(session.data, location.pathname);

  if (redirectTo !== null) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}

function LoginRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useAdminSession();
  const login = useLoginMutation();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const from = new URLSearchParams(location.search).get("from") ?? "/overview";

  const submitLoginForm = useCallback((formElement: HTMLFormElement): void => {
    login.reset();
    const submittedForm = readLoginFormState(formElement);
    const nextErrors = validateLoginForm(submittedForm);
    setErrors(nextErrors);

    if (hasLoginErrors(nextErrors)) {
      return;
    }

    login.mutate(submittedForm, {
      onSuccess: () => navigate(from, { replace: true })
    });
  }, [from, login, navigate]);

  useEffect(() => {
    const formElement = formRef.current;

    if (formElement === null) {
      return;
    }

    const activeForm = formElement;

    function submit(event: SubmitEvent): void {
      event.preventDefault();
      submitLoginForm(activeForm);
    }

    activeForm.addEventListener("submit", submit);
    return () => activeForm.removeEventListener("submit", submit);
  }, [submitLoginForm]);

  if (session.data !== null && session.data !== undefined) {
    return <Navigate to={from} replace />;
  }

  return (
    <LoginPageView
      formRef={formRef}
      errors={errors}
      apiError={describeLoginError(login.error)}
      isSubmitting={login.isPending}
    />
  );
}

export function LoginPageView(props: {
  readonly formRef?: RefObject<HTMLFormElement | null>;
  readonly errors: LoginFormErrors;
  readonly apiError: string | null;
  readonly isSubmitting: boolean;
}) {
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-mark" aria-hidden="true">
          <Database size={22} />
        </div>
        <div>
          <p className="app-kicker">Bun Dev Intel</p>
          <h1 id="login-title">Docs Admin</h1>
          <p className="login-copy">Sign in with your admin console account.</p>
        </div>
        <form ref={props.formRef} className="form-stack" noValidate>
          <label className="field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              aria-invalid={props.errors.email === undefined ? "false" : "true"}
            />
            {props.errors.email === undefined ? null : <small>{props.errors.email}</small>}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={props.errors.password === undefined ? "false" : "true"}
            />
            {props.errors.password === undefined ? null : <small>{props.errors.password}</small>}
          </label>
          {props.apiError === null ? null : <div className="inline-error">{props.apiError}</div>}
          <button className="button button-primary" type="submit" disabled={props.isSubmitting}>
            {props.isSubmitting ? "Signing in" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AppShell() {
  const session = useAdminSession();
  const logout = useLogoutMutation();
  const navigate = useNavigate();
  const user = session.data;

  if (user === null || user === undefined) {
    return null;
  }

  function submitLogout(): void {
    logout.mutate(undefined, {
      onSuccess: () => navigate("/login", { replace: true })
    });
  }

  return <ShellChrome user={user} isLoggingOut={logout.isPending} onLogout={submitLogout} />;
}

export function ShellChrome(props: {
  readonly user: AdminUser;
  readonly isLoggingOut: boolean;
  readonly onLogout: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <main className="admin-shell">
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="brand-block">
          <div className="brand-icon" aria-hidden="true">
            <Database size={20} />
          </div>
          <div>
            <p className="app-kicker">Bun Dev Intel</p>
            <h1>Docs Admin</h1>
          </div>
        </div>
        <nav className="nav-list">
          {navigationItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink key={item.to} to={item.to}>
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <UserRound size={16} aria-hidden="true" />
            <div>
              <strong>{props.user.email}</strong>
              <span>{props.user.role}</span>
            </div>
          </div>
          <button className="button button-secondary button-full" type="button" onClick={props.onLogout} disabled={props.isLoggingOut}>
            <LogOut size={16} aria-hidden="true" />
            {props.isLoggingOut ? "Signing out" : "Sign out"}
          </button>
        </div>
      </aside>
      <section className="workspace">
        {props.children ?? <Outlet />}
      </section>
    </main>
  );
}

function AuditPage() {
  return (
    <PageFrame title="Audit">
      <DataTable columns={["Time", "Actor", "Event", "Target"]} emptyLabel="No audit events loaded" />
    </PageFrame>
  );
}

function PageFrame(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <h2>{props.title}</h2>
        </div>
      </header>
      {props.children}
    </div>
  );
}

function DataTable(props: { readonly columns: readonly string[]; readonly emptyLabel: string }) {
  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={props.columns.length}>{props.emptyLabel}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FullPageState(props: { readonly title: string; readonly tone: "neutral" | "danger" }) {
  return (
    <main className="state-page">
      <div className={`state-box state-${props.tone}`}>{props.title}</div>
    </main>
  );
}
