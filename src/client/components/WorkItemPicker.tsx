import { useMemo, useState } from "react";
import type { WorkItem } from "../api";

/**
 * Renders the BQ-derived work items as an actual grouped tree — Category
 * (Roman numeral, e.g. "V PEKERJAAN ARSITEKTUR") > Sub-category (e.g.
 * "V.1 PEKERJAAN LANTAI") > individual item — rather than a flat search
 * list of concatenated path strings. `path` already carries this
 * breadcrumb (Section 4.3 requires it, since item numbers reset per
 * section); this component just re-parses it for display.
 */

interface TreeItem {
  workItem: WorkItem;
  label: string;
}

interface SubcategoryGroup {
  name: string;
  items: TreeItem[];
}

interface CategoryGroup {
  name: string;
  subcategories: Map<string, SubcategoryGroup>;
}

const NO_SUBCATEGORY = "(no sub-category)";

function buildTree(workItems: WorkItem[]): CategoryGroup[] {
  const categories = new Map<string, CategoryGroup>();

  for (const wi of workItems) {
    const segments = wi.path.split(" > ").map((s) => s.trim());
    const categoryName = segments[0] ?? "(uncategorized)";
    const hasSubcategory = segments.length >= 3;
    const subcategoryName = hasSubcategory ? segments[1] : NO_SUBCATEGORY;
    const label = segments[segments.length - 1];

    if (!categories.has(categoryName)) {
      categories.set(categoryName, { name: categoryName, subcategories: new Map() });
    }
    const category = categories.get(categoryName)!;
    if (!category.subcategories.has(subcategoryName)) {
      category.subcategories.set(subcategoryName, { name: subcategoryName, items: [] });
    }
    category.subcategories.get(subcategoryName)!.items.push({ workItem: wi, label });
  }

  return Array.from(categories.values());
}

export function WorkItemPicker({
  workItems,
  selected,
  onSelect,
}: {
  workItems: WorkItem[];
  selected: WorkItem | null;
  onSelect: (item: WorkItem) => void;
}) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);

  const tree = useMemo(() => buildTree(workItems), [workItems]);

  const filteredTree = useMemo(() => {
    if (!filter.trim()) return tree;
    const q = filter.toLowerCase();
    return tree
      .map((cat) => {
        const subcategories = new Map<string, SubcategoryGroup>();
        for (const [key, sub] of cat.subcategories) {
          const items = sub.items.filter(
            (it) => it.label.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q)
          );
          if (items.length > 0) subcategories.set(key, { name: sub.name, items });
        }
        return { name: cat.name, subcategories };
      })
      .filter((cat) => cat.subcategories.size > 0);
  }, [tree, filter]);

  const totalMatches = filteredTree.reduce(
    (sum, cat) =>
      sum + Array.from(cat.subcategories.values()).reduce((s, sub) => s + sub.items.length, 0),
    0
  );

  return (
    <div className="work-item-picker">
      <input
        type="text"
        placeholder={
          selected ? selected.path.split(" > ").pop() : "Search or browse the parsed work items…"
        }
        value={filter}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setFilter(e.target.value);
          setOpen(true);
        }}
      />
      {selected && !open && (
        <div className="work-item-picker__selected">
          <span className="pill pill--accent">selected</span> {selected.path}
        </div>
      )}
      {open && (
        <div className="work-item-picker__tree">
          {workItems.length === 0 && (
            <p className="muted" style={{ padding: "0.6rem" }}>
              Upload a BQ PDF first — the list populates from Step 1.
            </p>
          )}
          {workItems.length > 0 && totalMatches === 0 && (
            <p className="muted" style={{ padding: "0.6rem" }}>
              No items match "{filter}".
            </p>
          )}
          {filteredTree.map((cat) => (
            <div key={cat.name} className="work-item-picker__category">
              <div className="work-item-picker__category-label">{cat.name}</div>
              {Array.from(cat.subcategories.values()).map((sub) => (
                <div key={sub.name}>
                  {sub.name !== NO_SUBCATEGORY && (
                    <div className="work-item-picker__subcategory-label">{sub.name}</div>
                  )}
                  {sub.items.map((it) => (
                    <div
                      key={it.workItem.id}
                      className={
                        "work-item-picker__item" +
                        (selected?.id === it.workItem.id ? " work-item-picker__item--active" : "")
                      }
                      onClick={() => {
                        onSelect(it.workItem);
                        setFilter("");
                        setOpen(false);
                      }}
                    >
                      {it.label}
                      {it.workItem.unit && (
                        <span className="work-item-picker__unit">{it.workItem.unit}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          <div className="work-item-picker__close">
            <button className="ghost" onClick={() => setOpen(false)}>
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
