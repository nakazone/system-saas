/**
 * Resolve user IDs who should get job push (assignee + members + crew).
 */
export function teamUserIdsForJob(wo: {
  assignedUserId?: string | null;
  members?: { userId: string }[] | null;
  crew?: { members?: { userId: string }[] | null } | null;
}): string[] {
  const ids = new Set<string>();
  if (wo.assignedUserId) ids.add(wo.assignedUserId);
  for (const m of wo.members || []) {
    if (m?.userId) ids.add(m.userId);
  }
  for (const m of wo.crew?.members || []) {
    if (m?.userId) ids.add(m.userId);
  }
  return [...ids];
}
