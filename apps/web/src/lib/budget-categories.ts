import type { CategoryNode } from "@opulya/shared";

export function budgetCategories<
  T extends Pick<CategoryNode, "id" | "parentId">,
>(categories: T[], rows: { categoryId: string; amount: string | null }[]): T[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const selected = new Set(
    rows
      .filter((row) => row.amount !== null && byId.has(row.categoryId))
      .map((row) => row.categoryId),
  );
  return categories
    .filter((category) => selected.has(category.id))
    .map((category) => {
      // Keep only budgeted ancestors in the display tree, without changing stored parents.
      let parentId = category.parentId;
      const visited = new Set([category.id]);
      while (parentId) {
        if (visited.has(parentId)) {
          parentId = null;
          break;
        }
        if (selected.has(parentId)) break;
        visited.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return { ...category, parentId };
    });
}
