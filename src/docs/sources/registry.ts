import type { DocsSourcePack } from "./source-pack";

export interface DocsSourceRegistry {
  readonly list: () => readonly DocsSourcePack[];
  readonly get: (sourceId: string) => DocsSourcePack | undefined;
  readonly require: (sourceId: string) => DocsSourcePack;
}

export function createDocsSourceRegistry(sourcePacks: readonly DocsSourcePack[]): DocsSourceRegistry {
  const packsById = new Map<string, DocsSourcePack>();

  for (const sourcePack of sourcePacks) {
    if (packsById.has(sourcePack.sourceId)) {
      throw new Error(`Duplicate docs source pack: ${sourcePack.sourceId}`);
    }

    packsById.set(sourcePack.sourceId, sourcePack);
  }

  return {
    list: () => sourcePacks.filter((sourcePack) => sourcePack.enabled),
    get: (sourceId) => packsById.get(sourceId),
    require: (sourceId) => {
      const sourcePack = packsById.get(sourceId);

      if (sourcePack === undefined) {
        throw new Error(`Unknown docs source pack: ${sourceId}`);
      }

      return sourcePack;
    }
  };
}
