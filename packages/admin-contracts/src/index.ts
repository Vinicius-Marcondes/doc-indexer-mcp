import * as z from "zod/v4";

export const adminServiceName = "bun-dev-intel-admin-console" as const;

export const adminHealthResponseSchema = z
  .object({
    ok: z.literal(true),
    status: z.enum(["ok", "ready"]),
    service: z.literal(adminServiceName)
  })
  .strict();

export type AdminHealthResponse = z.infer<typeof adminHealthResponseSchema>;

export const adminErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        status: z.number().int().min(400).max(599)
      })
      .strict()
  })
  .strict();

export type AdminErrorResponse = z.infer<typeof adminErrorResponseSchema>;
