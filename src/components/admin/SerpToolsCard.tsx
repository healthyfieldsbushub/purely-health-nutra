import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Search, TrendingUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { manus } from "@/lib/manus-client";

const API_BASE = import.meta.env.VITE_API_BASE || "";

interface KeywordResult {
  seed: string;
  suggestions: string[];
  related: string[];
  source: string;
}

interface RankResult {
  keyword: string;
  last_rank: number | null;
  measured: boolean;
  note: string;
  last_checked_at: string;
  total_results: number;
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}/api/functions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  const data = result.data ?? result;
  if (!response.ok || result.error || (data && data.error)) throw new Error(result.error || data.error || `${name} failed`);
  return data as T;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export function SerpToolsCard() {
  const queryClient = useQueryClient();
  const [seed, setSeed] = useState("");
  const [research, setResearch] = useState<KeywordResult | null>(null);
  const [rankKeyword, setRankKeyword] = useState("");
  const [rank, setRank] = useState<RankResult | null>(null);
  const [busy, setBusy] = useState<"research" | "rank" | "save" | null>(null);

  const doResearch = async () => {
    if (!seed.trim()) return;
    setBusy("research");
    try {
      const result = await callFunction<Partial<KeywordResult>>("seo-keywords", { seed });
      setResearch({
        seed: String(result.seed || seed),
        suggestions: asStringArray(result.suggestions),
        related: asStringArray(result.related),
        source: String(result.source || "SerpAPI"),
      });
    } catch (error: any) {
      toast.error(error.message || "Keyword research failed");
    } finally {
      setBusy(null);
    }
  };

  const doRankCheck = async (keyword: string) => {
    if (!keyword.trim()) return;
    setBusy("rank");
    try {
      const result = await callFunction<RankResult>("seo-rank-check", { keyword });
      setRank(result);
      setRankKeyword(keyword);
      toast.success(result.measured ? `Measured: #${result.last_rank} on Google ZA` : "Measured: not in Google top 100 (ZA)");
    } catch (error: any) {
      toast.error(error.message || "Rank check failed");
    } finally {
      setBusy(null);
    }
  };

  const saveKeyword = async (keyword: string) => {
    setBusy("save");
    try {
      const { error } = await manus.from("seo_keywords").insert({
        id: `kw-${keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
        keyword,
        source: "admin-saved",
        created_at: new Date().toISOString(),
      });
      if (error && !String(error.message || "").includes("duplicate")) throw error;
      toast.success(`"${keyword}" saved to the keyword bank (used by the AI chatbot).`);
      queryClient.invalidateQueries({ queryKey: ["seo-keywords"] });
    } catch (error: any) {
      toast.error(error.message || "Could not save keyword");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Keyword Research & Measured Google Rankings
        </CardTitle>
        <CardDescription>
          Live Google data via SerpAPI (South Africa). Rankings shown are measured positions from real Google results — never estimates. Saved keywords feed the customer AI chatbot's keyword bank.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-medium">Keyword research</Label>
          <div className="flex gap-2">
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doResearch()}
              placeholder="e.g. dragon fruit cuttings south africa"
            />
            <Button onClick={doResearch} disabled={busy === "research" || !seed.trim()}>
              {busy === "research" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Research
            </Button>
          </div>
          {research && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold mb-2 text-muted-foreground">GOOGLE AUTOCOMPLETE SUGGESTIONS ({research.suggestions.length})</p>
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {research.suggestions.map((s) => (
                    <Badge key={s} variant="secondary" className="cursor-pointer font-normal" onClick={() => doRankCheck(s)}>
                      {s}
                    </Badge>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Click any suggestion to check its real Google ranking.</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold mb-2 text-muted-foreground">RELATED SEARCHES ({research.related.length})</p>
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {research.related.map((s) => (
                    <Badge key={s} variant="outline" className="cursor-pointer font-normal" onClick={() => doRankCheck(s)}>
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-medium">Measured rank check (Google ZA, top 100)</Label>
          <div className="flex gap-2">
            <Input
              value={rankKeyword}
              onChange={(e) => setRankKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doRankCheck(rankKeyword)}
              placeholder="e.g. buy dragon fruit cuttings"
            />
            <Button onClick={() => doRankCheck(rankKeyword)} disabled={busy === "rank" || !rankKeyword.trim()}>
              {busy === "rank" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Check Rank
            </Button>
          </div>
          {rank && (
            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={rank.measured ? "default" : "secondary"}>
                  {rank.measured ? `#${rank.last_rank}` : "Not in top 100"}
                </Badge>
                <span className="text-sm font-medium">{rank.keyword}</span>
              </div>
              <p className="text-xs text-muted-foreground">{rank.note}</p>
              <p className="text-[10px] text-muted-foreground">
                Checked {new Date(rank.last_checked_at).toLocaleString()} · {rank.total_results.toLocaleString()} results scanned · stored in seo_keywords
              </p>
              <Button variant="outline" size="sm" onClick={() => saveKeyword(rank.keyword)} disabled={busy === "save"}>
                <Save className="h-3 w-3" /> Save keyword
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
