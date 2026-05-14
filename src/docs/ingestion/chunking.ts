import { computeContentHash } from "../../cache/sqlite-cache";
import type { DocsChunkingDefaults } from "../sources/source-pack";

export interface ChunkDocsPageInput {
  readonly sourceId: string;
  readonly pageId?: string;
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly chunking: DocsChunkingDefaults;
}

export interface DocsChunk {
  readonly sourceId: string;
  readonly pageId?: string;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly previousChunkIndex?: number;
  readonly nextChunkIndex?: number;
}

export interface ChunkDocsPageResult {
  readonly sourceId: string;
  readonly pageId?: string;
  readonly title: string;
  readonly url: string;
  readonly pageContentHash: string;
  readonly chunks: readonly DocsChunk[];
}

interface MarkdownBlock {
  readonly content: string;
  readonly headingPath: readonly string[];
  readonly isHeading: boolean;
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function estimateTokenCount(content: string): number {
  const normalized = content.trim();

  if (normalized.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function headingText(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.+)$/u.exec(line.trim());

  if (match === null) {
    return null;
  }

  return {
    level: match[1]?.length ?? 1,
    text: match[2]?.trim() ?? ""
  };
}

function denseHeadingPath(path: readonly (string | undefined)[]): string[] {
  return path.filter((part): part is string => typeof part === "string" && part.length > 0);
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const headingPath: string[] = [];
  let currentLines: string[] = [];
  let currentHeadingPath: readonly string[] = [];
  let inCodeFence = false;

  function flushCurrent(): void {
    const blockContent = normalizeContent(currentLines.join("\n"));

    if (blockContent.length > 0) {
      blocks.push({
        content: blockContent,
        headingPath: currentHeadingPath,
        isHeading: false
      });
    }

    currentLines = [];
  }

  for (const line of normalizeContent(content).split("\n")) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      currentLines.push(line);
      continue;
    }

    const heading = inCodeFence ? null : headingText(line);

    if (heading !== null) {
      flushCurrent();
      headingPath.length = heading.level - 1;
      headingPath[heading.level - 1] = heading.text;
      blocks.push({
        content: line.trim(),
        headingPath: denseHeadingPath(headingPath),
        isHeading: true
      });
      currentHeadingPath = denseHeadingPath(headingPath);
      continue;
    }

    if (!inCodeFence && line.trim().length === 0) {
      flushCurrent();
      currentHeadingPath = denseHeadingPath(headingPath);
      continue;
    }

    if (currentLines.length === 0) {
      currentHeadingPath = denseHeadingPath(headingPath);
    }

    currentLines.push(line);
  }

  flushCurrent();

  return blocks;
}

function contentForBlocks(blocks: readonly MarkdownBlock[]): string {
  return normalizeContent(blocks.map((block) => block.content).join("\n\n"));
}

function headingPathForBlocks(blocks: readonly MarkdownBlock[]): readonly string[] {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const path = blocks[index]?.headingPath ?? [];

    if (path.length > 0) {
      return path;
    }
  }

  return [];
}

function appendChunk(
  chunks: Omit<DocsChunk, "previousChunkIndex" | "nextChunkIndex">[],
  input: ChunkDocsPageInput,
  blocks: readonly MarkdownBlock[]
): void {
  const content = contentForBlocks(blocks);

  if (content.length === 0) {
    return;
  }

  chunks.push({
    sourceId: input.sourceId,
    ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
    title: input.title,
    url: input.url,
    headingPath: headingPathForBlocks(blocks),
    chunkIndex: chunks.length,
    content,
    contentHash: computeContentHash(content),
    tokenEstimate: estimateTokenCount(content)
  });
}

function splitOversizedBlock(block: MarkdownBlock, targetTokens: number): MarkdownBlock[] {
  if (estimateTokenCount(block.content) <= targetTokens || block.content.includes("```")) {
    return [block];
  }

  const pieces: MarkdownBlock[] = [];
  const maxCharacters = Math.max(1, targetTokens * 4);
  const words = block.content.split(/\s+/u);
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;

    if (candidate.length > maxCharacters && current.length > 0) {
      pieces.push({
        ...block,
        content: current
      });
      current = word;
      continue;
    }

    current = candidate;
  }

  if (current.length > 0) {
    pieces.push({
      ...block,
      content: current
    });
  }

  return pieces;
}

function withNeighborIndexes(chunks: readonly Omit<DocsChunk, "previousChunkIndex" | "nextChunkIndex">[]): DocsChunk[] {
  return chunks.map((chunk, index) => ({
    ...chunk,
    ...(index === 0 ? {} : { previousChunkIndex: index - 1 }),
    ...(index === chunks.length - 1 ? {} : { nextChunkIndex: index + 1 })
  }));
}

export function chunkDocsPage(input: ChunkDocsPageInput): ChunkDocsPageResult {
  const normalizedContent = normalizeContent(input.content);
  const targetTokens = Math.max(1, input.chunking.targetTokens);
  const blocks = parseMarkdownBlocks(normalizedContent).flatMap((block) => splitOversizedBlock(block, targetTokens));
  const chunks: Omit<DocsChunk, "previousChunkIndex" | "nextChunkIndex">[] = [];
  let currentBlocks: MarkdownBlock[] = [];

  for (const block of blocks) {
    if (block.isHeading && currentBlocks.length > 0) {
      appendChunk(chunks, input, currentBlocks);
      currentBlocks = [];
    }

    const candidateBlocks = [...currentBlocks, block];
    const candidateTokenEstimate = estimateTokenCount(contentForBlocks(candidateBlocks));

    if (candidateTokenEstimate > targetTokens && currentBlocks.length > 0) {
      appendChunk(chunks, input, currentBlocks);
      currentBlocks = [block];
      continue;
    }

    currentBlocks = candidateBlocks;
  }

  appendChunk(chunks, input, currentBlocks);

  return {
    sourceId: input.sourceId,
    ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
    title: input.title,
    url: input.url,
    pageContentHash: computeContentHash(normalizedContent),
    chunks: withNeighborIndexes(chunks)
  };
}
