export interface NormalizeBunDocsContentInput {
  readonly url: string;
  readonly body: string;
  readonly contentType?: string;
  readonly title?: string;
}

export interface NormalizedBunDocsContent {
  readonly title: string;
  readonly content: string;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]*>/gu, ""));
}

function inlineHtmlToText(input: string): string {
  return stripTags(input)
    .replace(/[ \t\n]+/gu, " ")
    .trim();
}

function inlineHtmlToMarkdown(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/giu, (_, text) => `\`${inlineHtmlToText(String(text))}\``)
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/giu, (_, text) => inlineHtmlToText(String(text)))
      .replace(/<[^>]*>/gu, "")
  )
    .replace(/[ \t\n]+/gu, " ")
    .trim();
}

function titleFromMarkdown(content: string, fallback: string): string {
  const titleMatch = /^#\s+(.+)$/mu.exec(content);
  return titleMatch?.[1]?.trim() ?? fallback;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);

    if (lastSegment !== undefined) {
      return lastSegment
        .replace(/[-_]+/gu, " ")
        .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
    }
  } catch {
    // Fall through to the generic title below.
  }

  return "Bun docs page";
}

function normalizeMarkdown(input: NormalizeBunDocsContentInput): NormalizedBunDocsContent {
  const content = normalizeText(input.body);

  return {
    title: input.title?.trim() ?? titleFromMarkdown(content, titleFromUrl(input.url)),
    content
  };
}

function normalizeHtml(input: NormalizeBunDocsContentInput): NormalizedBunDocsContent {
  const withoutBoilerplate = input.body
    .replace(/<!doctype[^>]*>/giu, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
    .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/giu, "");
  const titleMatch = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/iu.exec(withoutBoilerplate);
  const fallbackTitle = titleFromUrl(input.url);
  const title = input.title?.trim() ?? (titleMatch === null ? fallbackTitle : inlineHtmlToText(titleMatch[2] ?? ""));
  const codeBlocks: string[] = [];
  let content = withoutBoilerplate.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/giu, (_, code) => {
    const index = codeBlocks.push(normalizeText(decodeHtmlEntities(String(code)))) - 1;
    return `\n\n__BUN_DOCS_CODE_BLOCK_${index}__\n\n`;
  });

  content = content
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_, level, text) => {
      return `\n\n${"#".repeat(Number(level))} ${inlineHtmlToMarkdown(String(text))}\n\n`;
    })
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/giu, (_, text) => `\n\n${inlineHtmlToMarkdown(String(text))}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_, text) => `\n- ${inlineHtmlToMarkdown(String(text))}\n`)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/giu, (_, text) => `\`${inlineHtmlToText(String(text))}\``)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/giu, (_, text) => inlineHtmlToText(String(text)))
    .replace(/<[^>]*>/gu, "");

  for (const [index, code] of codeBlocks.entries()) {
    content = content.replace(`__BUN_DOCS_CODE_BLOCK_${index}__`, `\`\`\`\n${code}\n\`\`\``);
  }

  return {
    title,
    content: normalizeText(decodeHtmlEntities(content))
  };
}

export function normalizeBunDocsContent(input: NormalizeBunDocsContentInput): NormalizedBunDocsContent {
  const contentType = input.contentType?.toLowerCase() ?? "";

  if (contentType.includes("html") || /<\/?[a-z][\s\S]*>/iu.test(input.body)) {
    return normalizeHtml(input);
  }

  return normalizeMarkdown(input);
}
