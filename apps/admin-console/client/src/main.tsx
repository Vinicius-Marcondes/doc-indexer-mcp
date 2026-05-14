import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, Database, Search } from "lucide-react";
import { adminServiceName } from "@bun-dev-intel/admin-contracts";
import "./styles.css";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="app-shell">
        <aside className="sidebar" aria-label="Admin navigation">
          <div>
            <p className="eyebrow">Bun Dev Intel</p>
            <h1>Docs Admin</h1>
          </div>
          <nav>
            <a href="#overview">
              <Activity size={18} aria-hidden="true" />
              Overview
            </a>
            <a href="#sources">
              <Database size={18} aria-hidden="true" />
              Sources
            </a>
            <a href="#search">
              <Search size={18} aria-hidden="true" />
              Search Lab
            </a>
          </nav>
        </aside>

        <section className="workspace">
          <header>
            <p className="eyebrow">{adminServiceName}</p>
            <h2>Admin Console Scaffold</h2>
          </header>
          <div className="status-grid">
            <article>
              <span>Service</span>
              <strong>Optional admin console</strong>
            </article>
            <article>
              <span>Runtime</span>
              <strong>Bun + Hono</strong>
            </article>
            <article>
              <span>Frontend</span>
              <strong>React 19 + Vite</strong>
            </article>
          </div>
        </section>
      </main>
    </QueryClientProvider>
  );
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Admin console root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
