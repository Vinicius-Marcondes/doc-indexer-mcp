import { useMemo, useState, type FormEvent, type ReactNode } from "react";
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
import type { AdminUser } from "@bun-dev-intel/admin-contracts";
import { AdminApiProvider, useAdminSession, useLoginMutation, useLogoutMutation } from "./session";
import { OverviewPage } from "./overview";
import {
  ChunkDetailPage,
  JobDetailPage,
  JobsPage,
  PageDetailPage,
  SourceDetailPage,
  SourcesPage
} from "./resource-views";

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

  if (!input.email.includes("@")) {
    errors.email = "Enter a valid email address.";
  }

  if (input.password.length === 0) {
    errors.password = "Enter your password.";
  }

  return errors;
}

export function hasLoginErrors(errors: LoginFormErrors): boolean {
  return errors.email !== undefined || errors.password !== undefined;
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
  const [form, setForm] = useState<LoginFormState>({ email: "", password: "" });
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const from = new URLSearchParams(location.search).get("from") ?? "/overview";

  if (session.data !== null && session.data !== undefined) {
    return <Navigate to={from} replace />;
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextErrors = validateLoginForm(form);
    setErrors(nextErrors);

    if (hasLoginErrors(nextErrors)) {
      return;
    }

    login.mutate(form, {
      onSuccess: () => navigate(from, { replace: true })
    });
  }

  return (
    <LoginPageView
      email={form.email}
      password={form.password}
      errors={errors}
      apiError={login.isError ? "Invalid email or password." : null}
      isSubmitting={login.isPending}
      onEmailChange={(email) => setForm((current) => ({ ...current, email }))}
      onPasswordChange={(password) => setForm((current) => ({ ...current, password }))}
      onSubmit={submit}
    />
  );
}

export function LoginPageView(props: {
  readonly email: string;
  readonly password: string;
  readonly errors: LoginFormErrors;
  readonly apiError: string | null;
  readonly isSubmitting: boolean;
  readonly onEmailChange: (email: string) => void;
  readonly onPasswordChange: (password: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
        <form className="form-stack" onSubmit={props.onSubmit} noValidate>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={props.email}
              aria-invalid={props.errors.email === undefined ? "false" : "true"}
              onChange={(event) => props.onEmailChange(event.target.value)}
            />
            {props.errors.email === undefined ? null : <small>{props.errors.email}</small>}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={props.password}
              aria-invalid={props.errors.password === undefined ? "false" : "true"}
              onChange={(event) => props.onPasswordChange(event.target.value)}
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

function SearchLabPage() {
  return (
    <PageFrame title="Search Lab">
      <div className="search-strip">
        <input aria-label="Search query" placeholder="Query indexed docs" />
        <button className="button button-primary" type="button">
          Search
        </button>
      </div>
    </PageFrame>
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
