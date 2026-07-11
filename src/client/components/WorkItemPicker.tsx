import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { WorkItem } from "../api";

/**
 * Renders the Breakdown-derived work items as an actual grouped tree — Category
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

/**
 * The last `path` segment is sometimes the full label already (Tier 1's
 * deterministic parser folds "N. description" into one segment), but Tier
 * 3 (Claude) keeps `path` purely structural — its last segment can be just
 * a bare marker like "1" or "I.9", with the real text only in
 * `description`. Detect the bare-marker case and recombine, so the picker
 * shows the actual work description either way.
 */
function buildLabel(lastSegment: string, description: string): string {
  if (!lastSegment) return description || "(untitled item)";
  if (!description || lastSegment.includes(description)) return lastSegment;
  return `${lastSegment}. ${description}`;
}

/** Full breadcrumb for display, with the last segment corrected the same
 * way as the tree label (see `buildLabel`), so "selected" text and the
 * input placeholder never show a bare marker either. */
function breadcrumbLabel(wi: WorkItem): string {
  const segments = wi.path.split(" > ").map((s) => s.trim());
  const fixedLast = buildLabel(segments[segments.length - 1] ?? "", wi.description);
  return [...segments.slice(0, -1), fixedLast].join(" > ");
}

function buildTree(workItems: WorkItem[]): CategoryGroup[] {
  const categories = new Map<string, CategoryGroup>();

  for (const wi of workItems) {
    const segments = wi.path.split(" > ").map((s) => s.trim());
    const categoryName = segments[0] ?? "(uncategorized)";
    const hasSubcategory = segments.length >= 3;
    const subcategoryName = hasSubcategory ? segments[1] : NO_SUBCATEGORY;
    const label = buildLabel(segments[segments.length - 1] ?? "", wi.description);

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
      <div className="work-item-picker__input-wrap">
        <Search size={15} className="work-item-picker__input-icon" />
        <input
          type="text"
          style={{ paddingLeft: "2.1rem" }}
          placeholder={
            selected ? buildLabel(selected.path.split(" > ").pop() ?? "", selected.description) : "Search or browse the parsed work items…"
          }
          value={filter}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setFilter(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {selected && !open && (
        <div className="work-item-picker__selected">
          <span className="pill pill--accent">selected</span> {breadcrumbLabel(selected)}
        </div>
      )}
      {open && (
        <div className="work-item-picker__tree">
          {workItems.length === 0 && (
            <p className="muted" style={{ padding: "0.6rem" }}>
              Upload a Breakdown PDF first — the list populates from Step 1.
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
                      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {selected?.id === it.workItem.id && <Check size={13} />}
                        {it.label}
                      </span>
                      {(it.workItem.volume_awal != null || it.workItem.unit) && (
                        <span className="work-item-picker__unit">
                          {it.workItem.volume_awal != null ? it.workItem.volume_awal : ""}
                          {it.workItem.volume_awal != null && it.workItem.unit ? " " : ""}
                          {it.workItem.unit ?? ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          <div className="work-item-picker__close">
            <button className="ghost" onClick={() => setOpen(false)}>
              <X size={13} />
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
