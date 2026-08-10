import { useEffect, useMemo, useState } from "react";
import { api, type Card } from "./api";
import { MarkdownBody } from "./MarkdownBody";
import {
  buildPreviewSources,
  groupLabel,
  groupSources,
  type PreviewSource,
} from "./previewSources";

export function DocPreviewModal(props: {
  boardId: string;
  card: Card;
  cards: Card[];
  initialPath?: string;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<PreviewSource[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(
    props.initialPath ?? null,
  );
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("text");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const grouped = useMemo(() => groupSources(sources), [sources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    buildPreviewSources(props.boardId, props.card, props.cards)
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        setListLoading(false);
        const prefer =
          (props.initialPath &&
            list.find((s) => s.path === props.initialPath)?.path) ||
          list[0]?.path ||
          null;
        setActivePath((cur) => cur ?? prefer);
      })
      .catch((e) => {
        if (cancelled) return;
        setListError(String(e));
        setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.boardId, props.card, props.cards, props.initialPath]);

  useEffect(() => {
    if (!activePath) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    api
      .getWorkspaceFile(props.boardId, activePath)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        setLanguage(file.language);
        setFileLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setContent(null);
        setFileError(String(e));
        setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.boardId, activePath]);

  const isMarkdown = language === "markdown" || activePath?.endsWith(".md");
  const isHtml =
    language === "html" ||
    !!activePath?.match(/\.html?$/i);

  function openInBrowser() {
    if (!activePath) return;
    const url = api.workspaceRawUrl(props.boardId, activePath);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className="doc-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="文档预览"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="doc-preview-modal">
        <header className="doc-preview-header">
          <div>
            <h2>文档与代码预览</h2>
            <p className="meta">{props.card.title}</p>
          </div>
          <div className="doc-preview-header-actions">
            {isHtml && activePath && !fileLoading && !fileError && (
              <button type="button" onClick={openInBrowser}>
                在浏览器打开
              </button>
            )}
            <button type="button" onClick={props.onClose}>
              关闭
            </button>
          </div>
        </header>
        <div className="doc-preview-body">
          <aside className="doc-preview-nav">
            {listLoading && <p className="meta">加载文件列表…</p>}
            {listError && <p className="doc-preview-error">{listError}</p>}
            {!listLoading && sources.length === 0 && (
              <p className="meta">暂无可预览文件</p>
            )}
            {grouped.map(({ group, items }) => (
              <div key={group} className="doc-preview-group">
                <h3>{groupLabel(group)}</h3>
                <ul>
                  {items.map((s) => (
                    <li key={s.path}>
                      <button
                        type="button"
                        className={
                          activePath === s.path ? "active" : undefined
                        }
                        title={s.path}
                        onClick={() => setActivePath(s.path)}
                      >
                        <span className="doc-preview-name">{s.label}</span>
                        {s.from === "discovered" && (
                          <span className="doc-preview-tag">发现</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </aside>
          <main className="doc-preview-content">
            {activePath && (
              <div className="doc-preview-path-row">
                <p className="doc-preview-path meta" title={activePath}>
                  {activePath}
                  {language ? ` · ${language}` : ""}
                </p>
                {isHtml && !fileLoading && !fileError && (
                  <button
                    type="button"
                    className="linkish"
                    onClick={openInBrowser}
                  >
                    在浏览器打开
                  </button>
                )}
              </div>
            )}
            {fileLoading && <p className="meta">加载中…</p>}
            {fileError && <p className="doc-preview-error">{fileError}</p>}
            {!fileLoading && !fileError && content !== null && (
              isMarkdown ? (
                <div className="doc-preview-md">
                  <MarkdownBody text={content} />
                </div>
              ) : isHtml ? (
                <div className="doc-preview-html-hint">
                  <p className="meta">
                    HTML 源码如下。点击「在浏览器打开」可渲染页面（相对资源会按同目录解析）。
                  </p>
                  <pre className="doc-preview-code">
                    <code className={`language-${language}`}>{content}</code>
                  </pre>
                </div>
              ) : (
                <pre className="doc-preview-code">
                  <code className={`language-${language}`}>{content}</code>
                </pre>
              )
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
