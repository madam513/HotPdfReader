import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { Store } from "@tauri-apps/plugin-store";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type PdfDoc = pdfjsLib.PDFDocumentProxy;

type PdfTab = {
  id: string;
  name: string;
  pdf: PdfDoc;
  page: number;
  numPages: number;
};

type SearchHit = {
  page: number;
  text: string;
};

type Annotation = {
  id: string;
  page: number;
  text: string;
};

let store: Store | null = null;

async function getStore() {
  if (!store) {
    store = await Store.load("hot-pdf-reader.json");
  }

  return store;
}

export default function App() {
  const [tabs, setTabs] = useState<PdfTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [scale, setScale] = useState(1.3);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeTab = useMemo(() => {
    return tabs.find((tab) => tab.id === activeTabId) ?? null;
  }, [tabs, activeTabId]);

  async function openPdfFromFile(file: File) {
    const bytes = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: bytes,
    }).promise;

    const tab: PdfTab = {
      id: crypto.randomUUID(),
      name: file.name,
      pdf,
      page: 1,
      numPages: pdf.numPages,
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    await addRecentFile(file.name);
  }

  async function addRecentFile(name: string) {
    const appStore = await getStore();

    const updated = [name, ...recentFiles.filter((file) => file !== name)].slice(
      0,
      8
    );

    setRecentFiles(updated);
    await appStore.set("recentFiles", updated);
    await appStore.save();
  }

  async function loadRecentFiles() {
    const appStore = await getStore();
    const saved = await appStore.get<string[]>("recentFiles");

    if (Array.isArray(saved)) {
      setRecentFiles(saved);
    }
  }

  function updateActiveTab(patch: Partial<PdfTab>) {
    if (!activeTab) return;

    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              ...patch,
            }
          : tab
      )
    );
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);

      if (id === activeTabId) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }

      return next;
    });
  }

  async function renderPage() {
    if (!activeTab || !canvasRef.current) return;

    const page = await activeTab.pdf.getPage(activeTab.page);
    const viewport = page.getViewport({ scale });

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;
  }

  async function searchPdf() {
    if (!activeTab || !searchQuery.trim()) {
      setSearchHits([]);
      return;
    }

    const hits: SearchHit[] = [];

    for (let pageNumber = 1; pageNumber <= activeTab.numPages; pageNumber++) {
      const page = await activeTab.pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");

      if (text.toLowerCase().includes(searchQuery.toLowerCase())) {
        hits.push({
          page: pageNumber,
          text: text.slice(0, 180),
        });
      }
    }

    setSearchHits(hits);
  }

  function addAnnotation() {
    if (!activeTab) return;

    const text = prompt("Annotation text:");
    if (!text) return;

    setAnnotations((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        page: activeTab.page,
        text,
      },
    ]);
  }

  function sendChatMessage() {
    if (!chatInput.trim()) return;

    setChatMessages((current) => [
      ...current,
      `You: ${chatInput}`,
      "AI: This is a placeholder. Next step is connecting this to extracted PDF text and an LLM API.",
    ]);

    setChatInput("");
  }

  useEffect(() => {
    loadRecentFiles();
  }, []);

  useEffect(() => {
    renderPage();
  }, [activeTabId, activeTab?.page, scale]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!activeTab) return;

      if (event.key === "ArrowRight") {
        updateActiveTab({
          page: Math.min(activeTab.numPages, activeTab.page + 1),
        });
      }

      if (event.key === "ArrowLeft") {
        updateActiveTab({
          page: Math.max(1, activeTab.page - 1),
        });
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "+") {
        setScale((current) => Math.min(4, current + 0.2));
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "-") {
        setScale((current) => Math.max(0.5, current - 0.2));
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById("searchInput")?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTab]);

  return (
    <main
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();

        const file = event.dataTransfer.files?.[0];

        if (file && file.type === "application/pdf") {
          openPdfFromFile(file);
        }
      }}
    >
      <aside className="sidebar">
        <h1>Hot PDF 🔥</h1>

        <label className="fileButton">
          Open PDF
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) {
                openPdfFromFile(file);
              }
            }}
          />
        </label>

        <section>
          <h3>Tabs</h3>

          {tabs.length === 0 && <p className="muted">No open tabs</p>}

          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === activeTabId ? "tab active" : "tab"}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.name}</span>

              <b
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </b>
            </button>
          ))}
        </section>

        <section>
          <h3>Recent</h3>

          {recentFiles.length === 0 && <p className="muted">No recent files</p>}

          {recentFiles.map((file) => (
            <p key={file} className="recent">
              {file}
            </p>
          ))}
        </section>

        {activeTab && (
          <>
            <section className="controls">
              <button
                disabled={activeTab.page <= 1}
                onClick={() => updateActiveTab({ page: activeTab.page - 1 })}
              >
                Previous
              </button>

              <span>
                {activeTab.page} / {activeTab.numPages}
              </span>

              <button
                disabled={activeTab.page >= activeTab.numPages}
                onClick={() => updateActiveTab({ page: activeTab.page + 1 })}
              >
                Next
              </button>
            </section>

            <section className="controls">
              <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
                -
              </button>

              <span>{Math.round(scale * 100)}%</span>

              <button onClick={() => setScale((s) => Math.min(4, s + 0.2))}>
                +
              </button>
            </section>

            <section>
              <h3>Thumbnails</h3>

              <div className="thumbList">
                {Array.from({ length: activeTab.numPages }, (_, index) => {
                  const page = index + 1;

                  return (
                    <button
                      key={page}
                      className={
                        page === activeTab.page ? "thumb activeThumb" : "thumb"
                      }
                      onClick={() => updateActiveTab({ page })}
                    >
                      Page {page}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3>Search</h3>

              <div className="searchBox">
                <input
                  id="searchInput"
                  value={searchQuery}
                  placeholder="Search PDF..."
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      searchPdf();
                    }
                  }}
                />

                <button onClick={searchPdf}>Go</button>
              </div>

              <div className="searchResults">
                {searchHits.map((hit) => (
                  <button
                    key={`${hit.page}-${hit.text}`}
                    onClick={() => updateActiveTab({ page: hit.page })}
                  >
                    <strong>Page {hit.page}</strong>
                    <span>{hit.text}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>Annotations</h3>

              <button onClick={addAnnotation}>Add annotation</button>

              {annotations
                .filter((annotation) => annotation.page === activeTab.page)
                .map((annotation) => (
                  <p key={annotation.id} className="annotation">
                    {annotation.text}
                  </p>
                ))}
            </section>
          </>
        )}
      </aside>

      <section className="viewer">
        <div className="topBar">
          <span>
            {activeTab
              ? `${activeTab.name} — Page ${activeTab.page}`
              : "Drop a PDF here"}
          </span>

          <span>⌘F Search · ← → Pages · ⌘+ / ⌘- Zoom</span>
        </div>

        {activeTab ? (
          <canvas ref={canvasRef} className="pdfCanvas" />
        ) : (
          <div className="emptyState">
            <h2>Open or drop a PDF</h2>
            <p>Drag-and-drop, tabs, search, annotations, and AI chat UI ready.</p>
          </div>
        )}
      </section>

      <aside className="chatPanel">
        <h3>AI Chat</h3>

        <div className="chatMessages">
          {chatMessages.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>

        <div className="chatInput">
          <input
            value={chatInput}
            placeholder="Ask about this PDF..."
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendChatMessage();
              }
            }}
          />

          <button onClick={sendChatMessage}>Send</button>
        </div>
      </aside>
    </main>
  );
}