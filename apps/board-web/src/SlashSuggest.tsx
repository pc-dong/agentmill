import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { api } from "./api";

export type SlashItem = {
  name: string;
  description: string;
  path: string;
  kind: "skill" | "command";
  source: string;
};

/** Match `/query` at end of text before cursor (not mid-word like http://). */
export function matchSlashQuery(
  value: string,
  cursor: number,
): { query: string; start: number } | null {
  const before = value.slice(0, cursor);
  const m = before.match(/(^|[\s\n])\/([^\s/]*)$/);
  if (!m) return null;
  const full = m[0]!;
  const query = m[2] ?? "";
  const start = before.length - full.length + (m[1]?.length ?? 0);
  return { query, start };
}

export function filterSlashItems(
  items: SlashItem[],
  query: string,
): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items.slice(0, 40);
  return items
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.kind.includes(q),
    )
    .slice(0, 40);
}

export function useWorkspaceSkills(boardId: string) {
  const [items, setItems] = useState<SlashItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listWorkspaceSkills(boardId)
      .then((res) => {
        if (!cancelled) {
          setItems(res.skills);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  return { items, error, loading };
}

export function useSlashSuggest(opts: {
  boardId: string;
  value: string;
  setValue: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { items } = useWorkspaceSkills(opts.boardId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [matchStart, setMatchStart] = useState(0);

  const suggestions = useMemo(
    () => filterSlashItems(items, query),
    [items, query],
  );

  const detect = useCallback(
    (value: string, cursor: number) => {
      const m = matchSlashQuery(value, cursor);
      if (!m) {
        setOpen(false);
        return;
      }
      setQuery(m.query);
      setMatchStart(m.start);
      setOpen(true);
      setIndex(0);
    },
    [],
  );

  const insert = useCallback(
    (item: SlashItem) => {
      const el = opts.textareaRef.current;
      const cursor = el?.selectionStart ?? opts.value.length;
      const before = opts.value.slice(0, cursor);
      const after = opts.value.slice(cursor);
      const m = matchSlashQuery(opts.value, cursor);
      if (!m) return;
      const token = `/${item.name} `;
      const next = `${before.slice(0, m.start)}${token}${after}`;
      opts.setValue(next);
      setOpen(false);
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = m.start + token.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [opts],
  );

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(suggestions[index]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return {
    open: open && suggestions.length > 0,
    suggestions,
    index,
    setIndex,
    detect,
    insert,
    onKeyDown,
    matchStart,
    close: () => setOpen(false),
  };
}

export function SlashSuggestMenu(props: {
  suggestions: SlashItem[];
  index: number;
  onPick: (item: SlashItem) => void;
  onHover: (i: number) => void;
}) {
  if (props.suggestions.length === 0) return null;
  return (
    <ul className="mention-menu slash-menu" role="listbox">
      {props.suggestions.map((item, i) => (
        <li key={`${item.kind}:${item.path}`}>
          <button
            type="button"
            className={i === props.index ? "active" : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(item);
            }}
            onMouseEnter={() => props.onHover(i)}
          >
            <span className="mention-menu-name">/{item.name}</span>
            <span className="slash-kind">{item.kind}</span>
            {item.description && (
              <span className="meta slash-desc">{item.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
