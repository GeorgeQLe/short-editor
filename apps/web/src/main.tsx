import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  CreateOrganization,
  OrganizationSwitcher,
  Show,
  SignInButton,
  UserButton,
  useAuth,
  useOrganization,
  useReverification
} from "@clerk/react";
import { isReverificationCancelledError } from "@clerk/react/errors";
import type {
  AuthenticatedContext,
  OrganizationRole,
  Project
} from "@siftcut/saas-contracts";
import {
  CloudApi,
  CloudApiError,
  completeOrganizationDeletion,
  parseDeletionResponse
} from "./api.js";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required");

function App() {
  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="/">SiftCut</a>
        <Show when="signed-in">
          <div className="account-controls">
            <OrganizationSwitcher
              afterCreateOrganizationUrl="/"
              afterSelectOrganizationUrl="/"
              hidePersonal
            />
            <UserButton />
          </div>
        </Show>
      </header>
      <Show when="signed-out">
        <main className="signed-out">
          <p className="eyebrow">SiftCut Cloud</p>
          <h1>Turn long-form video into polished shorts.</h1>
          <p>Sign in to your organization workspace to continue.</p>
          <SignInButton mode="modal">
            <button className="primary">Sign in</button>
          </SignInButton>
        </main>
      </Show>
      <Show when="signed-in"><OrganizationWorkspace /></Show>
    </div>
  );
}

function OrganizationWorkspace() {
  const { getToken, orgId, isLoaded: authLoaded } = useAuth();
  const { organization, membership, isLoaded: organizationLoaded } = useOrganization();
  const [projects, setProjects] = useState<Project[]>([]);
  const [session, setSession] = useState<AuthenticatedContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const api = useMemo(() => new CloudApi({ getToken }), [getToken, orgId]);
  const deleteOrganizationRequest = useCallback(async (confirmation: string) => (
    parseDeletionResponse(await api.fetch("/organization", {
      method: "DELETE",
      body: JSON.stringify({ confirmation })
    }))
  ), [api]);
  const reverifiedDeleteOrganization = useReverification(deleteOrganizationRequest);

  // An organization change immediately discards every tenant-derived value.
  // Fetches from the previous organization are prevented from committing by
  // the effect cleanup below.
  useEffect(() => {
    setProjects([]);
    setSession(null);
    setError(null);
    if (!authLoaded || !organizationLoaded || !orgId) return;
    let current = true;
    setLoading(true);
    void Promise.all([
      api.request<Project[]>("/projects"),
      api.request<AuthenticatedContext>("/session")
    ]).then(([nextProjects, nextSession]) => {
      if (!current) return;
      setProjects(nextProjects);
      setSession(nextSession);
    }).catch((reason: unknown) => {
      if (!current) return;
      setError(apiMessage(reason));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [api, authLoaded, organizationLoaded, orgId]);

  if (!authLoaded || !organizationLoaded) {
    return <main><p className="status">Loading your workspace…</p></main>;
  }
  if (!orgId || !organization) {
    return (
      <main className="organization-required">
        <p className="eyebrow">Organization required</p>
        <h1>Create your workspace</h1>
        <p>SiftCut keeps projects and media isolated by organization.</p>
        <CreateOrganization afterCreateOrganizationUrl="/" />
      </main>
    );
  }

  const role = roleFromClerk(membership?.role);
  const canEdit = role === "owner" || role === "editor";
  const organizationName = organization.name;

  async function createProject() {
    const trimmed = name.trim();
    if (!trimmed || !canEdit) return;
    setError(null);
    try {
      const created = await api.request<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ name: trimmed })
      });
      setProjects((current) => [created, ...current]);
      setName("");
    } catch (reason) {
      setError(apiMessage(reason));
    }
  }

  async function deleteOrganization() {
    if (role !== "owner" || deletionConfirmation !== organizationName) return;
    setDeleting(true);
    setError(null);
    try {
      const outcome = await completeOrganizationDeletion(
        reverifiedDeleteOrganization,
        deletionConfirmation,
        isReverificationCancelledError
      );
      if (outcome === "cancelled") {
        setDeleting(false);
        return;
      }
      window.location.assign("/");
    } catch (reason) {
      setError(apiMessage(reason));
      setDeleting(false);
    }
  }

  return (
    <main>
      <section className="workspace-heading">
        <div>
          <p className="eyebrow">{role} workspace</p>
          <h1>{organizationName}</h1>
        </div>
        <span className="session-state">
          {session ? "Secure session active" : "Verifying session"}
        </span>
      </section>

      {canEdit && (
        <form className="new-project" onSubmit={(event) => {
          event.preventDefault();
          void createProject();
        }}>
          <label htmlFor="project-name">New project</label>
          <div>
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              placeholder="Episode name"
            />
            <button className="primary" disabled={!name.trim()}>Create</button>
          </div>
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <p className="status">Loading projects…</p>
      ) : projects.length === 0 ? (
        <section className="empty">
          <h2>No projects yet</h2>
          <p>{canEdit ? "Create the first project for this organization." : "An owner or editor can create a project."}</p>
        </section>
      ) : (
        <section className="project-grid" aria-label="Projects">
          {projects.map((project) => (
            <article key={project.id}>
              <span>{project.kind === "screenletter_recording" ? "Screenletter" : "Episode"}</span>
              <h2>{project.name}</h2>
              <p>Updated {new Date(project.updatedAt).toLocaleDateString()}</p>
            </article>
          ))}
        </section>
      )}

      {role === "owner" && (
        <section className="danger-zone">
          <h2>Delete organization</h2>
          <p>
            This immediately disables access and schedules organization data for
            purge. Recent authentication is required.
          </p>
          <label htmlFor="delete-confirmation">
            Type <strong>{organizationName}</strong> to confirm
          </label>
          <div>
            <input
              id="delete-confirmation"
              value={deletionConfirmation}
              onChange={(event) => setDeletionConfirmation(event.target.value)}
            />
            <button
              type="button"
              disabled={deleting || deletionConfirmation !== organizationName}
              onClick={() => void deleteOrganization()}
            >
              {deleting ? "Deleting…" : "Delete organization"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function roleFromClerk(role: string | undefined): OrganizationRole {
  const normalized = role?.replace(/^org:/, "");
  if (normalized === "admin" || normalized === "owner") return "owner";
  if (normalized === "editor") return "editor";
  return "viewer";
}

function apiMessage(reason: unknown): string {
  if (reason instanceof CloudApiError) return reason.message;
  return "The workspace could not be loaded. Please try again.";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>
);
