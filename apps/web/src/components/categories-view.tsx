"use client";
import { Dropdown } from "./dropdown";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  FoldVertical,
  UnfoldVertical,
  Plus,
  Pencil,
  Folder,
  FolderOpen,
  Tag,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { categoryTree } from "@opulya/shared";
import type { Category } from "@/lib/types";
import { api } from "@/lib/api";
import { Button, Empty, ErrorNotice, Field, IconButton, Modal } from "./ui";
import { CategoryForm, categoryName } from "./forms";

export function CategoriesView({ categories }: { categories: Category[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Category | "new">();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [action, setAction] = useState<"delete" | "archive" | "restore">();
  const [parent, setParent] = useState<string>();
  const client = useQueryClient();
  const current =
    form && form !== "new"
      ? (categories.find((c) => c.id === form.id) ?? form)
      : undefined;
  const hasChildren = categories.some((c) => c.parentId === current?.id);
  const isUsed = !!(current?._count?.transactions || current?._count?.budgets);
  const close = () => {
    setForm(undefined);
    setAction(undefined);
  };
  const manage = useMutation({
    mutationFn: () => {
      if (!current || !action) throw new Error("CATEGORY_ACTION_REQUIRED");
      return api(
        action === "delete"
          ? `categories/${current.id}`
          : `categories/${current.id}/${action}`,
        {},
        action === "delete" ? "DELETE" : "POST",
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries();
      close();
    },
    onError: () => client.invalidateQueries({ queryKey: ["categories"] }),
  });
  const query = search.trim().toLocaleLowerCase(locale);
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  const sorted = categories
    .filter(
      (c) => (!type || c.type === type) && (includeArchived || !c.archivedAt),
    )
    .sort(
      (a, b) =>
        collator.compare(categoryName(a, t), categoryName(b, t)) ||
        a.id.localeCompare(b.id),
    );
  const byId = new Map(sorted.map((c) => [c.id, c]));
  const matches = new Set<string>();
  if (query) {
    for (const category of sorted) {
      if (!categoryName(category, t).toLocaleLowerCase(locale).includes(query))
        continue;
      let current: Category | undefined = category;
      while (current && !matches.has(current.id)) {
        matches.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
  }
  const visible = query ? sorted.filter((c) => matches.has(c.id)) : sorted;
  const branchIds = new Set(
    visible.flatMap((c) => (c.parentId ? [c.parentId] : [])),
  );
  const allExpanded =
    !!query || [...branchIds].every((id) => !collapsed.has(id));
  const lastSibling = new Map(visible.map((c) => [c.parentId, c.id]));
  const rows = categoryTree(visible, query ? undefined : collapsed);
  const continues: boolean[] = [];
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <div className="section-heading category-heading">
        <h2>{t("categories.allCategories")}</h2>
        <Button
          onClick={() => {
            setParent(undefined);
            setForm("new");
          }}
        >
          <Plus size={17} />
          {t("categories.add")}
        </Button>
      </div>
      <div className="category-controls">
        <Field label={t("categories.search")}>
          {(id) => (
            <input
              id={id}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("common.type")}>
          {(id) => (
            <Dropdown
              id={id}
              value={type}
              onValueChange={(value) => setType(value)}
            >
              <option value="">{t("common.all")}</option>
              <option value="EXPENSE">{t("categories.expense")}</option>
              <option value="INCOME">{t("categories.income")}</option>
            </Dropdown>
          )}
        </Field>
        <div className="toolbar">
          <IconButton
            label={t(
              allExpanded ? "categories.collapseAll" : "categories.expandAll",
            )}
            disabled={!!query || !branchIds.size}
            onClick={() =>
              setCollapsed((old) => {
                const next = new Set(old);
                for (const id of branchIds) {
                  if (allExpanded) next.add(id);
                  else next.delete(id);
                }
                return next;
              })
            }
          >
            {allExpanded ? (
              <FoldVertical size={18} />
            ) : (
              <UnfoldVertical size={18} />
            )}
          </IconButton>
        </div>
      </div>
      <label className="check filter-check">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        {t("categories.includeArchived")}
      </label>
      <ul className="category-tree" aria-label={t("categories.allCategories")}>
        {rows.map(({ category: c, depth, childCount }) => {
          const name = categoryName(c, t);
          const expanded = !!query || !collapsed.has(c.id);
          const isLast = lastSibling.get(c.parentId) === c.id;
          continues[depth] = !isLast;
          // Show the nearest ancestors when indentation reaches the viewport limit.
          const guides = Array.from({ length: Math.min(depth, 6) }, (_, i) => {
            const level = Math.max(0, depth - 6) + i;
            const branch = level === depth - 1;
            return {
              level,
              branch,
              line: branch || continues[level + 1],
              tail: branch && isLast,
            };
          });
          const content = (
            <>
              <span className="category-guides" aria-hidden="true">
                {guides.map(({ level, branch, line, tail }) => (
                  <span
                    key={level}
                    className={`category-guide${line ? " has-line" : ""}${branch ? " is-branch" : ""}${tail ? " is-tail" : ""}`}
                  />
                ))}
              </span>
              <span
                className={`category-toggle${childCount && expanded ? " has-stem" : ""}`}
              >
                {childCount ? (
                  <span className="category-chevron" aria-hidden="true">
                    {expanded ? (
                      <ChevronDown size={17} />
                    ) : (
                      <ChevronRight size={17} />
                    )}
                  </span>
                ) : (
                  <span className="category-leaf" aria-hidden="true" />
                )}
              </span>
              <span className="category-tree-name">
                {childCount ? (
                  expanded ? (
                    <FolderOpen size={18} aria-hidden="true" />
                  ) : (
                    <Folder size={18} aria-hidden="true" />
                  )
                ) : (
                  <Tag size={16} aria-hidden="true" />
                )}
                <span className="category-tree-label">
                  <strong>{name}</strong>
                  <span>
                    {t(`types.${c.type}`)}
                    {c.archivedAt ? ` · ${t("common.archived")}` : ""}
                    {childCount
                      ? ` · ${t("categories.subcategoryCount", { count: childCount })}`
                      : ""}
                  </span>
                </span>
              </span>
            </>
          );
          return (
            <li
              className="category-tree-row"
              key={c.id}
              data-category-id={c.id}
              data-parent-id={c.parentId ?? ""}
            >
              {childCount ? (
                <button
                  type="button"
                  className="category-row-content category-row-trigger"
                  aria-label={t(
                    expanded ? "categories.collapse" : "categories.expand",
                    { name },
                  )}
                  aria-expanded={expanded}
                  disabled={!!query}
                  onClick={() => toggle(c.id)}
                >
                  {content}
                </button>
              ) : (
                <div className="category-row-content">{content}</div>
              )}
              <div className="row-actions">
                <IconButton
                  label={t("categories.addUnder", { name })}
                  disabled={!!c.archivedAt}
                  onClick={() => {
                    setParent(c.id);
                    setForm("new");
                  }}
                >
                  <Plus size={16} />
                </IconButton>
                <IconButton
                  label={t(
                    c.archivedAt
                      ? "categories.restoreNamed"
                      : "categories.editNamed",
                    { name },
                  )}
                  onClick={() => {
                    setParent(undefined);
                    manage.reset();
                    setAction(c.archivedAt ? "restore" : undefined);
                    setForm(c);
                  }}
                >
                  {c.archivedAt ? (
                    <ArchiveRestore size={16} />
                  ) : (
                    <Pencil size={16} />
                  )}
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      {!rows.length && (
        <Empty title={t(query ? "categories.noMatches" : "categories.empty")} />
      )}
      <Modal
        title={t(
          action
            ? `categories.${action}Title`
            : form === "new"
              ? "categories.add"
              : "categories.edit",
        )}
        open={!!form}
        onClose={() => {
          if (!manage.isPending) close();
        }}
        description={
          action && current
            ? t(`categories.${action}Description`, {
                name: categoryName(current, t),
              })
            : undefined
        }
      >
        {action && current ? (
          <>
            {hasChildren && action !== "restore" && (
              <p role="alert" className="error-notice">
                {t("errors.CATEGORY_HAS_CHILDREN")}
              </p>
            )}
            <ErrorNotice error={manage.error} />
            <div className="form-footer">
              <Button
                className="secondary"
                disabled={manage.isPending}
                onClick={close}
              >
                {t("common.cancel")}
              </Button>
              <Button
                className={action === "delete" ? "danger" : ""}
                disabled={hasChildren && action !== "restore"}
                busy={manage.isPending}
                onClick={() => manage.mutate()}
              >
                {action === "delete" ? (
                  <Trash2 size={17} />
                ) : action === "archive" ? (
                  <Archive size={17} />
                ) : (
                  <ArchiveRestore size={17} />
                )}
                {t(`common.${action}`)}
              </Button>
            </div>
          </>
        ) : (
          form && (
            <CategoryForm
              categories={categories}
              initialType={type === "INCOME" ? "INCOME" : "EXPENSE"}
              existing={current}
              parentId={parent}
              secondaryAction={
                current && (
                  <Button
                    type="button"
                    className="secondary category-manage"
                    onClick={() => {
                      manage.reset();
                      setAction(isUsed ? "archive" : "delete");
                    }}
                  >
                    {isUsed ? <Archive size={17} /> : <Trash2 size={17} />}
                    {t(isUsed ? "common.archive" : "common.delete")}
                  </Button>
                )
              }
              onDone={() => {
                if (parent)
                  setCollapsed((old) => {
                    const next = new Set(old);
                    next.delete(parent);
                    return next;
                  });
                close();
              }}
            />
          )
        )}
      </Modal>
    </>
  );
}
