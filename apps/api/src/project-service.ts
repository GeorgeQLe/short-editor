import { randomUUID } from "node:crypto";
import {
  createProjectInputSchema,
  deleteProjectInputSchema,
  updateProjectInputSchema,
  type AuthenticatedContext,
  type Project
} from "@siftcut/saas-contracts";
import type { ProjectRepository } from "@siftcut/infrastructure";
import { requireRole } from "./auth.js";
import { SaasError } from "./errors.js";

export class ProjectApiService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly now: () => Date = () => new Date()
  ) {}
  listProjects(context: AuthenticatedContext) { return this.projects.list(context); }
  async getProject(context: AuthenticatedContext, projectId: string) {
    const project = await this.projects.get(context, projectId);
    if (!project) throw new SaasError("NOT_FOUND", "Project not found");
    return project;
  }
  createProject(context: AuthenticatedContext, raw: unknown): Promise<Project> {
    requireRole(context, ["owner", "editor"]);
    const input = createProjectInputSchema.parse(raw);
    const timestamp = this.now().toISOString();
    return this.projects.create(context, {
      id: randomUUID(), name: input.name, revision: 1, state: "active",
      createdAt: timestamp, updatedAt: timestamp
    });
  }
  updateProject(context: AuthenticatedContext, projectId: string, raw: unknown) {
    requireRole(context, ["owner", "editor"]);
    const input = updateProjectInputSchema.parse(raw);
    return this.projects.update(context, projectId, input.expectedRevision, {
      name: input.name, updatedAt: this.now().toISOString()
    });
  }
  deleteProject(context: AuthenticatedContext, projectId: string, raw: unknown) {
    requireRole(context, ["owner"]);
    const input = deleteProjectInputSchema.parse(raw);
    const requestedAt = this.now();
    return this.projects.delete(context, projectId, input.expectedRevision,
      requestedAt.toISOString(),
      new Date(requestedAt.getTime() + 86_400_000).toISOString());
  }
}
