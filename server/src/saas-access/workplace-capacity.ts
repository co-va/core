// Stable DEMO -> LIVE capacity projection. Existing workplace rows are preserved.
export function excessWorkplaceIds(
  orderedWorkplaces: readonly { id: string }[],
  limit: number | null,
): string[] {
  if (limit === null) return [];
  const retained = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return orderedWorkplaces.slice(retained).map((workplace) => workplace.id);
}
