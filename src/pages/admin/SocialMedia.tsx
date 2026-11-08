import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { manus } from "@/lib/manus-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Copy, ExternalLink, Share2, Loader2 } from "lucide-react";

const PLATFORMS = [
  { value: "facebook", label: "Facebook Page", slots: 12 },
  { value: "instagram", label: "Instagram", slots: 10 },
  { value: "tiktok", label: "TikTok", slots: 10 },
  { value: "threads", label: "Threads", slots: 10 },
  { value: "linkedin", label: "LinkedIn Page", slots: 5 },
  { value: "pinterest", label: "Pinterest", slots: 5 },
  { value: "youtube", label: "YouTube Channel", slots: 5 },
  { value: "x", label: "X / Twitter", slots: 5 },
  { value: "reddit", label: "Reddit", slots: 5 },
  { value: "blogger", label: "Blogger", slots: 5 },
  { value: "snapchat", label: "Snapchat", slots: 5 },
  { value: "telegram", label: "Telegram", slots: 5 },
  { value: "whatsapp", label: "WhatsApp", slots: 5 },
  { value: "messenger", label: "Facebook Messenger", slots: 3 },
  { value: "google_chat", label: "Google Chat", slots: 3 },
  { value: "other", label: "Other platform", slots: 10 },
];

interface SocialAccount {
  id: string; platform: string; account_name: string; url: string;
  is_active: boolean; is_default?: boolean; created_at?: string;
}

// The company's official Facebook pages and WhatsApp line.
const COMPANY_PAGES = [
  { account_name: "DFSA Members Network", url: "https://www.facebook.com/DFSAMembersNetwork" },
  { account_name: "Dragon Fruit Worldwide South Africa Plant Supply", url: "https://www.facebook.com/DragonFruitPlantsSouthAfrica" },
  { account_name: "ProAgriSA Wonderful Dragon Fruit Botswana", url: "https://www.facebook.com/DragonFruitBotswana" },
  { account_name: "ProAgriSA Wonderful Dragon Fruit DFSA", url: "https://www.facebook.com/WonderfulDragonFruitDFSA" },
  { account_name: "ProAgriSA Wonderful Dragon Fruit Malawi", url: "https://www.facebook.com/DragonFruitMalawi" },
  { account_name: "ProAgriSA Wonderful Dragon Fruit Mozambique", url: "https://www.facebook.com/DragonFruitMozambique" },
  { account_name: "ProAgriSA Wonderful Dragon Fruit Namibia", url: "https://www.facebook.com/DragonFruitNamibia" },
  { account_name: "ProAgriSA Wonderful Dragon Fruit Zimbabwe", url: "https://www.facebook.com/DragonFruitZimbabwe" },
  { account_name: "Max van Heerden (Cornelius DFSA) — personal profile", url: "https://www.facebook.com/MaxVanHeerdenDFSA" },
];
const COMPANY_WHATSAPP = { account_name: "WhatsApp Business — +27 73 600 3365", url: "https://wa.me/27736003365" };

export default function AdminSocialMedia() {
  const queryClient = useQueryClient();
  const [newAccount, setNewAccount] = useState({ platform: "facebook", account_name: "", url: "" });

  const { data: accounts = [] } = useQuery({
    queryKey: ["social-accounts"],
    queryFn: async () => {
      const { data, error } = await manus.from("social_accounts").select("*");
      if (error) throw error;
      return (data || []) as SocialAccount[];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["social-publish-log"],
    queryFn: async () => {
      const { data, error } = await manus.from("social_publish_log").select("*");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const addAccount = async () => {
    if (!newAccount.account_name.trim() || !newAccount.url.trim()) {
      toast.error("Account name and URL are required");
      return;
    }
    const count = accounts.filter(a => a.platform === newAccount.platform).length;
    const limit = PLATFORMS.find(p => p.value === newAccount.platform)?.slots ?? 5;
    if (count >= limit) { toast.error(`Maximum ${limit} accounts for this platform`); return; }
    const { error } = await manus.from("social_accounts").insert({
      platform: newAccount.platform,
      account_name: newAccount.account_name.trim(),
      url: newAccount.url.trim(),
      is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    setNewAccount({ platform: "facebook", account_name: "", url: "" });
    queryClient.invalidateQueries({ queryKey: ["social-accounts"] });
    toast.success("Account saved");
  };

  const toggleActive = async (account: SocialAccount) => {
    const { error } = await manus.from("social_accounts").update({ is_active: !account.is_active }).eq("id", account.id);
    if (!error) queryClient.invalidateQueries({ queryKey: ["social-accounts"] });
  };

  const removeAccount = async (id: string) => {
    const { error } = await manus.from("social_accounts").delete().eq("id", id);
    if (!error) { queryClient.invalidateQueries({ queryKey: ["social-accounts"] }); toast.success("Account removed"); }
  };

  const saveCompanyPages = async () => {
    const wanted = [...COMPANY_PAGES.map(p => ({ ...p, platform: "facebook" })), { ...COMPANY_WHATSAPP, platform: "whatsapp" }];
    const existingUrls = new Set(accounts.map(a => a.url));
    const toAdd = wanted.filter(p => !existingUrls.has(p.url));
    if (!toAdd.length) { toast.info("All company pages are already saved"); return; }
    const { error } = await manus.from("social_accounts").insert(
      toAdd.map(p => ({ ...p, is_active: true })),
    );
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["social-accounts"] });
    toast.success(`${toAdd.length} company page(s) saved`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Social Media Settings</h1>
        <p className="text-sm text-muted-foreground">Save your social media page URLs. Publishing happens through each platform's share interface or official API — content is prepared for you with NVIDIA AI, and nothing is posted automatically without your action.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Add account</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[200px_1fr_2fr_auto] items-end">
          <div className="space-y-1">
            <Label className="text-xs">Platform</Label>
            <Select value={newAccount.platform} onValueChange={(v) => setNewAccount({ ...newAccount, platform: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label} (max {p.slots})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account name</Label>
            <Input value={newAccount.account_name} onChange={(e) => setNewAccount({ ...newAccount, account_name: e.target.value })} placeholder="e.g. Purely Health Nutra main page" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Page URL</Label>
            <Input value={newAccount.url} onChange={(e) => setNewAccount({ ...newAccount, url: e.target.value })} placeholder="https://facebook.com/yourpage" />
          </div>
          <Button onClick={addAccount}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Our Facebook pages &amp; WhatsApp</CardTitle>
          <Button size="sm" variant="outline" onClick={saveCompanyPages}><Plus className="h-3 w-3 mr-1" />Save all to accounts</Button>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {COMPANY_PAGES.map(page => (
            <a key={page.url} href={page.url} target="_blank" rel="noreferrer" className="text-xs border rounded p-2 hover:bg-muted/50 flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>
              <span className="truncate">{page.account_name}</span>
            </a>
          ))}
          <a href={COMPANY_WHATSAPP.url} target="_blank" rel="noreferrer" className="text-xs border rounded p-2 hover:bg-muted/50 flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.5 14.1c-.2.7-1.2 1.3-2 1.4-.5.1-1.2.2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.6c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1.1 2.2 1.4 2.5 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2.1 1c.3.2.5.2.6.4 0 .1 0 .7-.1 1.4Z"/></svg>
            <span className="truncate">{COMPANY_WHATSAPP.account_name}</span>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Saved accounts ({accounts.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map(account => (
                <TableRow key={account.id}>
                  <TableCell className="text-xs">{PLATFORMS.find(p => p.value === account.platform)?.label ?? account.platform}</TableCell>
                  <TableCell className="text-xs font-medium">{account.account_name}</TableCell>
                  <TableCell className="text-xs"><a className="underline" href={account.url} target="_blank" rel="noreferrer">{account.url}</a></TableCell>
                  <TableCell><Switch checked={account.is_active} onCheckedChange={() => toggleActive(account)} /></TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => removeAccount(account.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {!accounts.length && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No accounts saved yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Publishing history ({history.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Platform</TableHead><TableHead>Account</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {history.slice(0, 30).map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs">{new Date(entry.published_at).toLocaleString("en-ZA")}</TableCell>
                  <TableCell className="text-xs">{entry.product_name}</TableCell>
                  <TableCell className="text-xs">{entry.platform}</TableCell>
                  <TableCell className="text-xs">{entry.account_name}</TableCell>
                  <TableCell className="text-xs">{entry.status === "error" ? <Badge variant="destructive">error</Badge> : <Badge variant="secondary">{entry.status}</Badge>}</TableCell>
                </TableRow>
              ))}
              {!history.length && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Nothing published yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Per-product publishing dialog, used from the products list.
export function SocialPublishDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (v: boolean) => void; product: any }) {
  const queryClient = useQueryClient();
  const productUrl = product?.slug ? `https://www.purelyhealthnutra.company/product/${product.slug}` : "https://www.purelyhealthnutra.company/products";
  const { data: accounts = [] } = useQuery({
    queryKey: ["social-accounts"],
    queryFn: async () => { const { data } = await manus.from("social_accounts").select("*"); return (data || []).filter((a: SocialAccount) => a.is_active !== false) as SocialAccount[]; },
    enabled: open,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const generatePosts = async () => {
    if (!selected.size) { toast.error("Select at least one account"); return; }
    setIsGenerating(true);
    setGenerated([]);
    try {
      const results: any[] = [];
      for (const account of accounts.filter(a => selected.has(a.id))) {
        const r = await fetch("/api/functions/social-generate-post", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform: account.platform, product, accountName: account.account_name }),
        });
        const j = await r.json();
        const data = j.data ?? j;
        results.push({ ...data, account_name: account.account_name, account_id: account.id, error: data.error || null });
      }
      setGenerated(results);
    } catch (error: any) {
      toast.error(error.message || "Generation failed");
    } finally { setIsGenerating(false); }
  };

  const markPublished = async (entry: any, status: string, postUrl?: string) => {
    await fetch("/api/functions/social-log-publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id, productName: product.name, platform: entry.platform, accountName: entry.account_name, content: entry.content, status, postUrl: postUrl || "" }),
    });
    queryClient.invalidateQueries({ queryKey: ["social-publish-log"] });
    toast.success(status === "error" ? "Logged as failed" : "Logged as published");
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied — paste it into the platform");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Publish "{product?.name}" to social media</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {accounts.map(account => (
              <label key={account.id} className="flex items-center gap-2 text-xs border rounded p-2 cursor-pointer">
                <input type="checkbox" checked={selected.has(account.id)} onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(account.id); else next.delete(account.id);
                  setSelected(next);
                }} />
                <span className="font-medium">{PLATFORMS.find(p => p.value === account.platform)?.label ?? account.platform}</span>
                <span className="text-muted-foreground truncate">{account.account_name}</span>
              </label>
            ))}
            {!accounts.length && <p className="text-sm text-muted-foreground col-span-2">No active accounts — add them under Social Media Settings first.</p>}
          </div>
          <Button onClick={generatePosts} disabled={isGenerating || !selected.size}>
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Share2 className="h-4 w-4 mr-1" />}
            Generate posts with NVIDIA AI
          </Button>
          {generated.map((entry, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{entry.label ?? entry.platform} — {entry.account_name}</span>
                {entry.error ? <Badge variant="destructive">error</Badge> : <Badge variant="secondary">ready</Badge>}
              </div>
              {entry.error ? (
                <p className="text-xs text-destructive">{entry.error}</p>
              ) : (
                <>
                  <Textarea readOnly value={entry.content} rows={5} className="text-xs" />
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => copy(entry.content)}><Copy className="h-3 w-3 mr-1" />Copy caption</Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(productUrl)}&quote=${encodeURIComponent(`${entry.content}`)}`} target="_blank" rel="noreferrer">
                        <svg className="h-3 w-3 mr-1" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>Share to Facebook
                      </a>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={`https://wa.me/27736003365?text=${encodeURIComponent(`${entry.content}\n${productUrl}`)}`} target="_blank" rel="noreferrer">
                        <svg className="h-3 w-3 mr-1 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.5 14.1c-.2.7-1.2 1.3-2 1.4-.5.1-1.2.2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.6c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1.1 2.2 1.4 2.5 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2.1 1c.3.2.5.2.6.4 0 .1 0 .7-.1 1.4Z"/></svg>Share on WhatsApp
                      </a>
                    </Button>
                    {entry.share_url && <Button size="sm" variant="outline" asChild><a href={entry.share_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Open share page</a></Button>}
                    {entry.image_url && <Button size="sm" variant="outline" asChild><a href={entry.image_url} target="_blank" rel="noreferrer">Product image</a></Button>}
                    <Button size="sm" onClick={() => markPublished(entry, "published")}>Mark as published</Button>
                    <Button size="sm" variant="ghost" onClick={() => markPublished(entry, "error", undefined)}>Log failure</Button>
                  </div>
                </>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Publishing opens each platform's official share/upload page with the content prepared. You complete the final post — the platform confirms publication, not the website.</p>
        </div>
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
