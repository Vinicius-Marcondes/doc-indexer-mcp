import * as z from "zod/v4";
import { cacheStatusSchema, confidenceSchema } from "./contracts";

const isoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-compatible timestamp"
});

const isoDateSchema = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), {
  message: "Expected an ISO date in YYYY-MM-DD format"
});

export const agentOutputSchemaVersion = "agent-output-v1" as const;

export const responseModeValues = ["brief", "standard", "full"] as const;
export const responseModeSchema = z.enum(responseModeValues);
export type ResponseMode = z.infer<typeof responseModeSchema>;

export const agentCitationSourceTypeValues = [
  "bun-docs",
  "bun-release",
  "npm-registry",
  "mcp-docs",
  "typescript-docs",
  "local-project"
] as const;
export const agentCitationSourceTypeSchema = z.enum(agentCitationSourceTypeValues);
export type AgentCitationSourceType = z.infer<typeof agentCitationSourceTypeSchema>;

export const citationIdSchema = z.string().min(1);
export type CitationId = z.infer<typeof citationIdSchema>;

export const agentCitationSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().min(1),
    sourceType: agentCitationSourceTypeSchema,
    fetchedAt: isoTimestampSchema,
    contentHash: z.string().min(1).optional()
  })
  .strict();
export type AgentCitation = z.infer<typeof agentCitationSchema>;

export const agentCitationMapSchema = z.record(citationIdSchema, agentCitationSchema);
export type AgentCitationMap = z.infer<typeof agentCitationMapSchema>;

export const agentFindingLocationSchema = z
  .object({
    filePath: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional()
  })
  .strict();
export type AgentFindingLocation = z.infer<typeof agentFindingLocationSchema>;

export const agentChangeMetadataSchema = z
  .object({
    sinceVersion: z.string().min(1).optional(),
    sinceDate: isoDateSchema.optional(),
    breaking: z.boolean().optional(),
    afterAgentTrainingCutoff: z.boolean().optional(),
    evidence: z.enum(["official-source", "npm-publish-time", "unavailable"]),
    citationIds: z.array(citationIdSchema)
  })
  .strict()
  .superRefine((change, context) => {
    if (change.evidence !== "unavailable" && change.citationIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Change metadata with source evidence must reference at least one citation",
        path: ["citationIds"]
      });
    }
  });
export type AgentChangeMetadata = z.infer<typeof agentChangeMetadataSchema>;

export const agentFindingSchema = z
  .object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
    framework: z.literal("bun"),
    severity: z.enum(["info", "warning", "error"]),
    title: z.string().min(1),
    message: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    locations: z.array(agentFindingLocationSchema),
    citationIds: z.array(citationIdSchema).min(1),
    fix: z.record(z.string(), z.unknown()).optional(),
    change: agentChangeMetadataSchema.optional(),
    fingerprint: z.string().min(1)
  })
  .strict();
export type AgentFinding = z.infer<typeof agentFindingSchema>;

export const agentActionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["command", "edit", "verify", "manual"]),
    title: z.string().min(1),
    command: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    risk: z.enum(["low", "medium", "high"]),
    requiresApproval: z.boolean(),
    reason: z.string().min(1),
    citationIds: z.array(citationIdSchema).min(1),
    relatedFindingIds: z.array(z.string().min(1))
  })
  .strict()
  .superRefine((action, context) => {
    if (action.kind === "command" && action.command === undefined) {
      context.addIssue({
        code: "custom",
        message: "Command actions must include a command",
        path: ["command"]
      });
    }

    if (action.kind === "edit" && action.filePath === undefined) {
      context.addIssue({
        code: "custom",
        message: "Edit actions must include a filePath",
        path: ["filePath"]
      });
    }

    if ((action.command !== undefined || action.kind === "edit") && action.requiresApproval !== true) {
      context.addIssue({
        code: "custom",
        message: "Command and edit actions must require approval",
        path: ["requiresApproval"]
      });
    }
  });
export type AgentAction = z.infer<typeof agentActionSchema>;

export const agentExampleSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    language: z.enum(["ts", "js", "json", "shell", "text"]),
    code: z.string().min(1),
    citationIds: z.array(citationIdSchema).min(1)
  })
  .strict();
export type AgentExample = z.infer<typeof agentExampleSchema>;

export const agentWarningSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    message: z.string().min(1),
    evidence: z.array(z.string().min(1)),
    citationIds: z.array(citationIdSchema)
  })
  .strict();
export type AgentWarning = z.infer<typeof agentWarningSchema>;

export const agentDeltaSchema = z
  .object({
    sinceToken: z.string().min(1),
    newFindingIds: z.array(z.string().min(1)),
    changedFindingIds: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)),
    repeatedFindingIds: z.array(z.string().min(1))
  })
  .strict();
export type AgentDelta = z.infer<typeof agentDeltaSchema>;

export const agentResponseEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    schemaVersion: z.literal(agentOutputSchemaVersion),
    generatedAt: isoTimestampSchema,
    responseMode: responseModeSchema,
    summary: z.string(),
    cacheStatus: cacheStatusSchema,
    confidence: confidenceSchema,
    findings: z.array(agentFindingSchema),
    actions: z.array(agentActionSchema),
    examples: z.array(agentExampleSchema),
    citations: agentCitationMapSchema,
    warnings: z.array(agentWarningSchema),
    detailResource: z.string().min(1).optional(),
    projectHash: z.string().min(1).optional(),
    deltaToken: z.string().min(1).optional(),
    delta: agentDeltaSchema.optional()
  })
  .strict();
export type AgentResponseEnvelope = z.infer<typeof agentResponseEnvelopeSchema>;

function collectCitationIds(response: AgentResponseEnvelope): string[] {
  const ids: string[] = [];

  for (const finding of response.findings) {
    ids.push(...finding.citationIds);
    if (finding.change !== undefined) {
      ids.push(...finding.change.citationIds);
    }
  }

  for (const action of response.actions) {
    ids.push(...action.citationIds);
  }

  for (const example of response.examples) {
    ids.push(...example.citationIds);
  }

  for (const warning of response.warnings) {
    ids.push(...warning.citationIds);
  }

  return ids;
}

export function missingCitationReferences(response: AgentResponseEnvelope): string[] {
  const knownIds = new Set(Object.keys(response.citations));
  return [...new Set(collectCitationIds(response).filter((citationId) => !knownIds.has(citationId)))].sort();
}

export function validateAgentResponseEnvelope(input: unknown): AgentResponseEnvelope {
  const response = agentResponseEnvelopeSchema.parse(input);
  const missingCitationIds = missingCitationReferences(response);

  if (missingCitationIds.length > 0) {
    throw new Error(`Missing citation references: ${missingCitationIds.join(", ")}`);
  }

  return response;
}
