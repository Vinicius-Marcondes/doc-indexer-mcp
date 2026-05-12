import * as z from "zod/v4";

const isoDateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-compatible timestamp"
});

export const cacheStatusValues = ["fresh", "stale", "miss", "disabled"] as const;
export const cacheStatusSchema = z.enum(cacheStatusValues);
export type CacheStatus = z.infer<typeof cacheStatusSchema>;

export const confidenceValues = ["high", "medium", "low"] as const;
export const confidenceSchema = z.enum(confidenceValues);
export type Confidence = z.infer<typeof confidenceSchema>;

export const sourceTypeValues = [
  "bun-docs",
  "npm-registry",
  "mcp-docs",
  "typescript-docs",
  "local-project"
] as const;
export const sourceTypeSchema = z.enum(sourceTypeValues);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const recommendationSeverityValues = ["info", "warning", "error"] as const;
export const recommendationSeveritySchema = z.enum(recommendationSeverityValues);
export type RecommendationSeverity = z.infer<typeof recommendationSeveritySchema>;

export const sourceCitationSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().min(1),
    sourceType: sourceTypeSchema,
    fetchedAt: isoDateStringSchema,
    contentHash: z.string().min(1).optional()
  })
  .strict();
export type SourceCitation = z.infer<typeof sourceCitationSchema>;

export const recommendationSchema = z
  .object({
    id: z.string().min(1),
    severity: recommendationSeveritySchema,
    title: z.string().min(1),
    detail: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    sources: z.array(z.string().min(1)).min(1),
    recommendedAction: z.string().min(1).optional()
  })
  .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;

export const warningSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    detail: z.string().min(1),
    evidence: z.array(z.string().min(1)).default([]),
    sources: z.array(z.string().min(1)).default([])
  })
  .strict();
export type ResponseWarning = z.infer<typeof warningSchema>;

export const cacheMetadataSchema = z
  .object({
    cacheStatus: cacheStatusSchema,
    fetchedAt: isoDateStringSchema.optional(),
    expiresAt: isoDateStringSchema.optional(),
    sourceUrl: z.string().min(1).optional(),
    contentHash: z.string().min(1).optional()
  })
  .strict();
export type CacheMetadata = z.infer<typeof cacheMetadataSchema>;

export const baseToolResponseSchema = z
  .object({
    generatedAt: isoDateStringSchema,
    cacheStatus: cacheStatusSchema,
    sources: z.array(sourceCitationSchema),
    confidence: confidenceSchema,
    recommendations: z.array(recommendationSchema),
    warnings: z.array(warningSchema)
  })
  .strict();
export type BaseToolResponse = z.infer<typeof baseToolResponseSchema>;
