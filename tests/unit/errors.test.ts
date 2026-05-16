import { describe, expect, test } from "bun:test";
import * as z from "zod/v4";
import {
  createDisallowedSourceError,
  createInvalidInputError,
  createNoEvidenceError,
  structuredErrorSchema,
  toStructuredError
} from "../../packages/contracts/src/errors";

describe("structured errors", () => {
  test("invalid input returns a schema validation error", () => {
    const inputSchema = z.object({
      projectPath: z.string().min(1)
    });
    const result = inputSchema.safeParse({});

    expect(result.success).toBe(false);

    if (!result.success) {
      const error = createInvalidInputError(result.error);

      expect(structuredErrorSchema.parse(error)).toEqual(error);
      expect(error.code).toBe("invalid_input");
      expect(error.message).toContain("Invalid input");
      expect(error.details?.issues).toEqual([
        {
          path: ["projectPath"],
          message: expect.any(String)
        }
      ]);
    }
  });

  test("disallowed source returns a disallowed-source error", () => {
    const error = createDisallowedSourceError("https://example.com/post");

    expect(structuredErrorSchema.parse(error)).toEqual(error);
    expect(error.code).toBe("disallowed_source");
    expect(error.message).toContain("not allowlisted");
    expect(error.details).toEqual({
      sourceUrl: "https://example.com/post"
    });
  });

  test("fetch failure without cache returns a no-evidence error", () => {
    const error = createNoEvidenceError({
      sourceUrl: "https://bun.com/docs/llms.txt",
      reason: "network unavailable"
    });

    expect(structuredErrorSchema.parse(error)).toEqual(error);
    expect(error.code).toBe("no_evidence");
    expect(error.message).toContain("No source evidence");
    expect(error.details).toEqual({
      sourceUrl: "https://bun.com/docs/llms.txt",
      reason: "network unavailable"
    });
  });

  test("internal errors do not leak stack traces by default", () => {
    const thrown = new Error("database failed");
    thrown.stack = "Error: database failed\n    at secretFunction (/tmp/secret.ts:1:1)";

    const error = toStructuredError(thrown);
    const serialized = JSON.stringify(error);

    expect(structuredErrorSchema.parse(error)).toEqual(error);
    expect(error.code).toBe("internal_error");
    expect(error.message).toBe("Internal server error");
    expect(serialized).not.toContain("secretFunction");
    expect(serialized).not.toContain("/tmp/secret.ts");
    expect(serialized).not.toContain("stack");
  });
});
