import { describe, expect, it } from "vitest";
import { categoryTree } from "@opulya/shared";
import { budgetCategories } from "./budget-categories";

const categories = [
  { id: "food", parentId: null },
  { id: "groceries", parentId: "food" },
  { id: "produce", parentId: "groceries" },
  { id: "travel", parentId: null },
];

describe("budget category selection", () => {
  it("does not display categories before a budget is configured", () => {
    expect(budgetCategories(categories, [])).toEqual([]);
    expect(
      budgetCategories(categories, [{ categoryId: "food", amount: null }]),
    ).toEqual([]);
  });

  it("keeps explicitly configured zero budgets and ignores unknown categories", () => {
    expect(
      budgetCategories(categories, [
        { categoryId: "food", amount: "0" },
        { categoryId: "unknown", amount: "100" },
      ]),
    ).toEqual([{ id: "food", parentId: null }]);
  });

  it("displays a selected subcategory without adding unselected parents or children", () => {
    expect(
      budgetCategories(categories, [{ categoryId: "groceries", amount: "60" }]),
    ).toEqual([{ id: "groceries", parentId: null }]);
    expect(categories[1]?.parentId).toBe("food");
  });

  it("groups chosen descendants under their nearest chosen ancestor", () => {
    const chosen = budgetCategories(categories, [
      { categoryId: "food", amount: "100" },
      { categoryId: "produce", amount: "20" },
    ]);
    expect(chosen).toEqual([
      { id: "food", parentId: null },
      { id: "produce", parentId: "food" },
    ]);
    const tree = chosen.map((category) => ({ ...category, type: "EXPENSE" }));
    expect(
      categoryTree(tree).map((row) => [
        row.category.id,
        row.depth,
        row.childCount,
      ]),
    ).toEqual([
      ["food", 0, 1],
      ["produce", 1, 0],
    ]);
    expect(categoryTree(tree, new Set(["food"]))).toHaveLength(1);
  });

  it("hides paused, removed and stopped budgets when the resolved amount is null", () => {
    expect(
      budgetCategories(categories, [
        { categoryId: "food", amount: null },
        { categoryId: "groceries", amount: "60" },
        { categoryId: "produce", amount: null },
      ]),
    ).toEqual([{ id: "groceries", parentId: null }]);
  });

  it("retains selected archived categories and does not mutate their stored hierarchy", () => {
    const archived = categories.map((category) => ({
      ...category,
      archivedAt: "2026-01-01",
    }));
    const chosen = budgetCategories(archived, [
      { categoryId: "produce", amount: "10" },
    ]);
    expect(chosen).toEqual([
      { id: "produce", parentId: null, archivedAt: "2026-01-01" },
    ]);
    expect(archived[2]?.parentId).toBe("groceries");
  });

  it("stops walking malformed or missing unselected ancestors", () => {
    expect(
      budgetCategories(
        [
          { id: "a", parentId: "b" },
          { id: "b", parentId: "b" },
        ],
        [{ categoryId: "a", amount: "10" }],
      ),
    ).toEqual([{ id: "a", parentId: null }]);
    expect(
      budgetCategories(
        [{ id: "a", parentId: "missing" }],
        [{ categoryId: "a", amount: "10" }],
      ),
    ).toEqual([{ id: "a", parentId: null }]);
  });
});
