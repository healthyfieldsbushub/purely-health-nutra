import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Which dragon fruit is best for beginners?",
  "How do I start water kefir?",
  "What are your shipping options?",
  "How long does order processing take?",
];

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function sendChatMessage(message: string, history: ChatEntry[]) {
  const response = await fetch(`${API_BASE}/api/functions/chat-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || "Chat is temporarily unavailable. Please try again.");
  return result.data ?? result;
}

export const ChatWidget = () => {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([
    {
      role: "assistant",
      content: "Hi! I'm the Purely Health Nutra assistant. Ask me about our dragon fruit cultivars, live gut-health cultures, growing tips, shipping or ordering.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, open]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const next = [...entries, { role: "user" as const, content: trimmed }];
    setEntries(next);
    setInput("");
    setLoading(true);
    try {
      const result = await sendChatMessage(trimmed, next.slice(-8));
      setEntries((prev) => [...prev, { role: "assistant", content: result.reply || "I could not answer that just now — please try again." }]);
    } catch (error: any) {
      setEntries((prev) => [...prev, { role: "assistant", content: error.message || "Chat is temporarily unavailable. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close chat" : "Open chat"}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full btn-sunset shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[min(92vw,380px)] rounded-2xl border bg-background shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b bg-primary text-primary-foreground">
            <p className="font-semibold text-sm">Purely Health Nutra Assistant</p>
            <p className="text-xs opacity-80">Cultivars · Cultures · Growing · Shipping</p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[380px] min-h-[260px]">
            {entries.map((entry, i) => (
              <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    entry.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {entry.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
            {entries.length <= 1 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="text-xs px-3 py-1.5 rounded-full border hover:border-primary hover:text-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about products, growing, shipping…"
              className="flex-1 text-sm rounded-full border px-4 py-2 outline-none focus:ring-1 focus:ring-primary"
            />
            <Button type="submit" size="icon" className="btn-sunset rounded-full h-9 w-9" disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
};
