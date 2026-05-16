import * as z from "zod/v4";

export const errorCodeValues = [
  "invalid_input",
  "unsafe_path",
  "disallowed_source",
  "fetch_failed",
  "parse_failed",
  "cache_miss",
  "no_evidence",
  "unsupported_project",
  "internal_error"
] as const;

export const errorCodeSchema = z.enum(errorCodeValues);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const structuredErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();
export type StructuredError = z.infer<typeof structuredErrorSchema>;

export function createStructuredError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): StructuredError {
  return structuredErrorSchema.parse({
    code,
    message,
    ...(details === undefined ? {} : { details })
  });
}

export function createInvalidInputError(error: z.ZodError): StructuredError {
  return createStructuredError("invalid_input", "Invalid input: request did not match the expected schema.", {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message
    }))
  });
}

export function createDisallowedSourceError(sourceUrl: string): StructuredError {
  return createStructuredError("disallowed_source", "Source URL is not allowlisted for this MCP server.", {
    sourceUrl
  });
}

export function createNoEvidenceError(input: { sourceUrl?: string; reason: string }): StructuredError {
  return createStructuredError("no_evidence", "No source evidence is available, so no recommendation was generated.", {
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    reason: input.reason
  });
}

export function toStructuredError(error: unknown): StructuredError {
  const parsed = structuredErrorSchema.safeParse(error);

  if (parsed.success) {
    return parsed.data;
  }

  return createStructuredError("internal_error", "Internal server error");
}
