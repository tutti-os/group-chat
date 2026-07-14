type CatalogEntity = {
  id: string;
  updatedAt?: string;
};

type AgentCatalogState = {
  identities: CatalogEntity[];
  lastSeq: number;
  participants: CatalogEntity[];
  runtimeProfiles: CatalogEntity[];
};

/**
 * Agent refresh snapshots are limited bootstrap reads, not reconnect frames.
 * They may update catalog-owned entities but must never replace timeline state.
 * Merge entities by update time because a newer WebSocket sequence can coexist
 * with a newer catalog row from the refresh request.
 */
export function mergeAgentCatalogSnapshot<TState extends AgentCatalogState>(
  current: TState,
  snapshot: Pick<TState, "identities" | "lastSeq" | "participants" | "runtimeProfiles">,
): TState {
  const snapshotIsAuthoritative = snapshot.lastSeq >= current.lastSeq;
  return {
    ...current,
    identities: mergeCatalogEntities(current.identities, snapshot.identities, {
      acceptSnapshotOnly: snapshotIsAuthoritative,
      retainCurrentOnly: !snapshotIsAuthoritative,
    }),
    participants: mergeCatalogEntities(current.participants, snapshot.participants, {
      acceptSnapshotOnly: snapshotIsAuthoritative,
      retainCurrentOnly: !snapshotIsAuthoritative,
    }),
    runtimeProfiles: mergeCatalogEntities(current.runtimeProfiles, snapshot.runtimeProfiles, {
      acceptSnapshotOnly: true,
      retainCurrentOnly: !snapshotIsAuthoritative,
    }),
  };
}

export function shouldAcceptAgentCatalogRefresh(
  refreshGeneration: number,
  acceptedGeneration: number,
) {
  return refreshGeneration >= acceptedGeneration;
}

function mergeCatalogEntities<TEntity extends CatalogEntity>(
  current: TEntity[],
  snapshot: TEntity[],
  options: { acceptSnapshotOnly: boolean; retainCurrentOnly: boolean },
) {
  const currentById = new Map(current.map((entity) => [entity.id, entity]));
  const merged = snapshot.flatMap((entity) => {
    const existing = currentById.get(entity.id);
    currentById.delete(entity.id);
    if (!existing) return options.acceptSnapshotOnly ? [entity] : [];
    const currentTimestamp = existing.updatedAt ?? "";
    const snapshotTimestamp = entity.updatedAt ?? "";
    const retainCurrent = currentTimestamp > snapshotTimestamp
      || (options.retainCurrentOnly && currentTimestamp === snapshotTimestamp);
    return [retainCurrent ? existing : entity];
  });
  return options.retainCurrentOnly ? [...merged, ...currentById.values()] : merged;
}
