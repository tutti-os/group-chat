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
  return {
    ...current,
    identities: mergeCatalogEntities(current.identities, snapshot.identities),
    participants: mergeCatalogEntities(current.participants, snapshot.participants),
    runtimeProfiles: mergeCatalogEntities(current.runtimeProfiles, snapshot.runtimeProfiles),
  };
}

function mergeCatalogEntities<TEntity extends CatalogEntity>(current: TEntity[], snapshot: TEntity[]) {
  const currentById = new Map(current.map((entity) => [entity.id, entity]));
  const merged = snapshot.map((entity) => {
    const existing = currentById.get(entity.id);
    currentById.delete(entity.id);
    if (!existing) return entity;
    return (existing.updatedAt ?? "") > (entity.updatedAt ?? "") ? existing : entity;
  });
  return [...merged, ...currentById.values()];
}
