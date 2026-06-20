import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

type Source = {
  title: string;
  file_path: string;
  header_path: string | null;
  score: number;
  preview: string;
  chunk_index?: number;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
};

type RagResponse = {
  conversation_id: string;
  answer: string;
  sources?: Source[];
};

type PanelPosition = {
  left: number;
  top: number;
};

type DragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
};

const STORAGE_KEY = 'zephyr-ai-chat-state';
const DEFAULT_API_URL = '/api/v1/ai/rag/chat';
const apiUrl = import.meta.env.PUBLIC_RAG_API_URL || DEFAULT_API_URL;

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我是 Zephyr Blog 的 AI 札记助手。可以问我文章、项目或技术笔记里的内容。',
};

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function readErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return '请求失败，请稍后再试。';
  }

  if ('error' in payload) {
    const error = (payload as { error?: { message?: unknown; code?: unknown } }).error;
    if (typeof error?.message === 'string') return error.message;
    if (typeof error?.code === 'string') return error.code;
  }

  if ('detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((item) => JSON.stringify(item)).join('\n');
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
  }

  return '请求失败，请稍后再试。';
}

function isDesktopViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
}

function clampPanelPosition(position: PanelPosition, panel: HTMLElement): PanelPosition {
  const margin = 16;
  const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);

  return {
    left: Math.min(Math.max(position.left, margin), maxLeft),
    top: Math.min(Math.max(position.top, margin), maxTop),
  };
}

function SourceList({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!sources.length) return null;

  return (
    <div className="mt-3 border-t border-[var(--color-border)]/60 pt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[11px] font-mono tracking-widest text-[var(--color-tertiary)] transition-colors hover:bg-[var(--color-primary)]/5"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>// SOURCES · {sources.length}</span>
        <span className="text-[var(--color-brand)]">{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {sources.map((source, index) => (
            <article
              key={`${source.file_path}-${source.chunk_index ?? index}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)]/60 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="m-0 text-sm font-bold text-[var(--color-primary)] font-serif-sc">
                    {source.title || '未命名片段'}
                  </h4>
                  {source.header_path && (
                    <p className="m-0 mt-1 text-xs text-[var(--color-secondary)]">{source.header_path}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-tertiary)]">
                  {source.score.toFixed(2)}
                </span>
              </div>
              <p className="m-0 mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--color-secondary)]">
                {source.preview}
              </p>
              <p className="m-0 mt-2 truncate text-[10px] font-mono text-[var(--color-tertiary)]">
                {source.file_path}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AiChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading]);
  const panelStyle = useMemo<CSSProperties>(() => {
    if (!panelPosition) return {};

    return {
      left: panelPosition.left,
      top: panelPosition.top,
      bottom: 'auto',
    };
  }, [panelPosition]);

  useEffect(() => {
    try {
      const rawState = localStorage.getItem(STORAGE_KEY);
      if (!rawState) return;

      const savedState = JSON.parse(rawState) as {
        conversationId?: string;
        messages?: ChatMessage[];
      };

      if (savedState.conversationId) setConversationId(savedState.conversationId);
      if (savedState.messages?.length) setMessages(savedState.messages);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          conversationId,
          messages,
        }),
      );
    } catch {
      // localStorage may be unavailable in private contexts; chat still works for this page view.
    }
  }, [conversationId, messages]);

  useEffect(() => {
    if (!isOpen) return;

    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
    inputRef.current?.focus();
  }, [isOpen, messages, isLoading]);

  useEffect(() => {
    if (!isOpen || !isDesktopViewport()) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    setPanelPosition((current) => clampPanelPosition(current ?? { left: rect.left, top: rect.top }, panel));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleResize() {
      const panel = panelRef.current;
      if (!panel || !isDesktopViewport()) {
        setPanelPosition(null);
        return;
      }

      setPanelPosition((current) => clampPanelPosition(current ?? { left: panel.getBoundingClientRect().left, top: panel.getBoundingClientRect().top }, panel));
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  useEffect(() => {
    if (!isDragging) return;

    document.body.classList.add('zephyr-chat-dragging');
    return () => document.body.classList.remove('zephyr-chat-dragging');
  }, [isDragging]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();

    const message = input.trim();
    if (!message || isLoading) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: message,
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          top_k: 5,
          temperature: 0.2,
          max_tokens: 1024,
          include_history: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as RagResponse | unknown;

      if (!response.ok) {
        throw new Error(readErrorMessage(payload));
      }

      const data = payload as RagResponse;
      setConversationId(data.conversation_id);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: data.answer,
          sources: data.sources ?? [],
        },
      ]);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : '请求失败，请稍后再试。';
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          content: `抱歉，刚才没有顺利连上知识库。${message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();
    void sendMessage();
  }

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDesktopViewport() || event.button !== 0) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPanelPosition({ left: rect.left, top: rect.top });
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    const panel = panelRef.current;
    if (!dragState || !panel || dragState.pointerId !== event.pointerId) return;

    setPanelPosition(
      clampPanelPosition(
        {
          left: event.clientX - dragState.offsetX,
          top: event.clientY - dragState.offsetY,
        },
        panel,
      ),
    );
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clearConversation() {
    setMessages([welcomeMessage]);
    setConversationId(undefined);
    setInput('');
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
    inputRef.current?.focus();
  }

  return (
    <div className="fixed bottom-5 left-5 z-[60] sm:bottom-6 sm:left-6 print:hidden">
      {isOpen && (
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="zephyr-ai-chat-title"
          style={panelStyle}
          className="glass-panel zephyr-chat-panel fixed bottom-20 left-5 flex h-[min(640px,calc(100vh-7rem))] w-[calc(100vw-2.5rem)] flex-col rounded-3xl text-[var(--color-primary)] shadow-2xl sm:bottom-24 sm:left-6 sm:w-[24rem] motion-safe:animate-[zephyrChatIn_0.35s_ease-out]"
        >
          <div
            className={[
              'touch-auto border-b border-[var(--color-border)]/70 bg-[var(--color-bg-base)]/35 px-4 py-3 sm:cursor-grab sm:select-none',
              isDragging ? 'sm:cursor-grabbing' : '',
            ].join(' ')}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="m-0 text-[10px] font-mono tracking-[0.28em] text-[var(--color-tertiary)]">// RAG CHAT</p>
                <h2 id="zephyr-ai-chat-title" className="m-0 mt-1 font-serif-sc text-lg font-bold tracking-wide text-[var(--color-primary)]">
                  Zephyr AI 札记
                </h2>
              </div>
              <div className="flex items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="rounded-full px-3 py-1 text-xs text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-primary)]/5 hover:text-[var(--color-primary)]"
                  onClick={clearConversation}
                  aria-label="清空当前 AI 对话"
                >
                  清空
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-primary)]/5 hover:text-[var(--color-primary)]"
                  onClick={() => setIsOpen(false)}
                  aria-label="收起 AI 对话框"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div
            ref={listRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4 [scrollbar-width:thin]"
            aria-live="polite"
            aria-busy={isLoading}
          >
            {messages.map((message) => (
              <article key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={[
                    'max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
                    message.role === 'user'
                      ? 'rounded-br-md bg-[var(--color-brand)] text-[var(--color-bg-base)]'
                      : 'rounded-bl-md border border-[var(--color-border)] bg-[var(--color-bg-base)]/70 text-[var(--color-primary)]',
                  ].join(' ')}
                >
                  <p className="m-0 whitespace-pre-wrap">{message.content}</p>
                  {message.sources && <SourceList sources={message.sources} />}
                </div>
              </article>
            ))}

            {isLoading && (
              <div className="flex justify-start" aria-label="AI 正在生成回复">
                <div className="rounded-2xl rounded-bl-md border border-[var(--color-border)] bg-[var(--color-bg-base)]/70 px-4 py-3 text-sm text-[var(--color-secondary)] shadow-sm">
                  <span className="font-serif-sc">正在翻阅札记</span>
                  <span className="ml-1 inline-flex gap-1 align-middle" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] opacity-40 motion-safe:animate-pulse" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] opacity-60 motion-safe:animate-pulse [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] opacity-80 motion-safe:animate-pulse [animation-delay:240ms]" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-3 rounded-xl border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--color-secondary)]" role="status">
              {error}
            </div>
          )}

          <form onSubmit={sendMessage} className="border-t border-[var(--color-border)]/70 bg-[var(--color-bg-base)]/35 p-2.5">
            <label htmlFor="zephyr-ai-chat-input" className="sr-only">输入给 Zephyr AI 的问题</label>
            <div className="flex items-end gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-base)]/75 p-1.5">
              <textarea
                id="zephyr-ai-chat-input"
                ref={inputRef}
                value={input}
                rows={1}
                disabled={isLoading}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isLoading ? 'AI 正在回复，请稍候…' : '问问这本技术札记…'}
                className="max-h-24 min-h-8 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-6 text-[var(--color-primary)] outline-none placeholder:text-[var(--color-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-describedby="zephyr-ai-chat-hint"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand)] text-[var(--color-bg-base)] shadow-md shadow-[var(--color-brand)]/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 motion-safe:hover:-translate-y-0.5"
                aria-label={isLoading ? 'AI 正在回复，暂不可发送' : '发送消息'}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
            <p id="zephyr-ai-chat-hint" className="m-0 mt-1.5 text-[10px] font-mono tracking-wider text-[var(--color-tertiary)]/80">
              Enter 发送 · Shift+Enter 换行
            </p>
          </form>
        </section>
      )}

      {!isOpen && (
        <button
          type="button"
          className="group flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-glass-border)] bg-[var(--color-brand)] text-[var(--color-bg-base)] shadow-lg shadow-[var(--color-brand)]/20 transition-all hover:brightness-110 motion-safe:hover:-translate-y-0.5 sm:h-16 sm:w-16"
          aria-label="打开 Zephyr AI 聊天框"
          aria-expanded={isOpen}
          aria-controls="zephyr-ai-chat-title"
          onClick={() => setIsOpen(true)}
        >
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-[var(--color-bg-base)] bg-[var(--color-bg-base)] shadow-sm" aria-hidden="true" />
          <svg className="h-7 w-7 transition-transform duration-500 group-hover:scale-105" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3c4.4 0 8 2.9 8 6.5S16.4 16 12 16a9.7 9.7 0 0 1-2.3-.3L5 19l1.4-4.1A6.1 6.1 0 0 1 4 9.5C4 5.9 7.6 3 12 3Z" />
            <path d="M9 9.5h.01" />
            <path d="M12 9.5h.01" />
            <path d="M15 9.5h.01" />
          </svg>
        </button>
      )}

      <style>{`
        @keyframes zephyrChatIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .zephyr-chat-panel {
          max-width: min(640px, calc(100vw - 2rem));
          overflow: hidden;
        }

        @media (min-width: 640px) {
          .zephyr-chat-panel {
            min-width: 360px;
            overflow: auto;
            resize: horizontal;
          }

          .zephyr-chat-panel > * {
            min-width: 0;
          }
        }

        @media (max-width: 639px) {
          .zephyr-chat-panel {
            left: 1.25rem !important;
            right: auto;
            top: auto !important;
            bottom: 5rem !important;
            max-width: calc(100vw - 2.5rem);
            resize: none;
          }
        }

        .zephyr-chat-dragging,
        .zephyr-chat-dragging * {
          user-select: none;
          cursor: grabbing !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .motion-safe\\:animate-\[zephyrChatIn_0\.35s_ease-out\] {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
