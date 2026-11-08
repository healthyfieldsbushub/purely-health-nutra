import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, AlertTriangle, ImageIcon, Search, Truck, Share2, Mail, Sparkles, Plus } from "lucide-react";

interface DashboardData {
  total: number; published: number; drafts: number; out_of_stock: number; low_stock: number;
  missing_seo: number; missing_geo: number; missing_images: number; missing_keywords: number;
  missing_shipping: number; incomplete_specs: number; duplicate_names: number;
  social_publishing: { accounts: number; active: number; total_posts: number; last_7_days: number };
  longcat_status: string; generated_at: string;
}

export default function AdminProductDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["product-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/functions/product-dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      return (j.data ?? j) as DashboardData;
    },
    refetchInterval: 60000,
  });

  const cards = data ? [
    { label: "Total products", value: data.total, icon: Package, to: "/admin/products" },
    { label: "Published", value: data.published, icon: Package, to: "/admin/products" },
    { label: "Drafts / hidden", value: data.drafts, icon: Package, to: "/admin/products" },
    { label: "Out of stock", value: data.out_of_stock, warn: data.out_of_stock > 0, icon: AlertTriangle, to: "/admin/products" },
    { label: "Low stock", value: data.low_stock, warn: data.low_stock > 0, icon: AlertTriangle, to: "/admin/products" },
    { label: "Missing SEO", value: data.missing_seo, warn: data.missing_seo > 0, icon: Search, to: "/admin/products" },
    { label: "Missing GEO", value: data.missing_geo, warn: data.missing_geo > 0, icon: Search, to: "/admin/products" },
    { label: "Missing images", value: data.missing_images, warn: data.missing_images > 0, icon: ImageIcon, to: "/admin/products" },
    { label: "Missing keywords", value: data.missing_keywords, warn: data.missing_keywords > 0, icon: Search, to: "/admin/products" },
    { label: "Missing shipping data", value: data.missing_shipping, warn: data.missing_shipping > 0, icon: Truck, to: "/admin/products" },
    { label: "Incomplete specs", value: data.incomplete_specs, warn: data.incomplete_specs > 0, icon: AlertTriangle, to: "/admin/products" },
    { label: "Duplicate names", value: data.duplicate_names, warn: data.duplicate_names > 0, icon: AlertTriangle, to: "/admin/products" },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Product Management Dashboard</h1>
          {data && <p className="text-xs text-muted-foreground">Updated {new Date(data.generated_at).toLocaleString("en-ZA")}</p>}
        </div>
        <Button asChild className="btn-sunset">
          <Link to="/admin/products"><Plus className="h-4 w-4 mr-1" />Add New Product</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(card => (
          <Link key={card.label} to={card.to}>
            <Card className={`hover:shadow-md transition-shadow ${card.warn ? "border-amber-400/60" : ""}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <card.icon className={`h-5 w-5 ${card.warn ? "text-amber-500" : "text-primary"}`} />
                <div>
                  <p className="text-2xl font-bold leading-none">{isLoading ? "…" : card.value}</p>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Share2 className="h-4 w-4" />Social media publishing</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Accounts: {data?.social_publishing.accounts ?? 0} ({data?.social_publishing.active ?? 0} active)</p>
            <p>Posts published: {data?.social_publishing.total_posts ?? 0} ({data?.social_publishing.last_7_days ?? 0} last 7 days)</p>
            <Button asChild variant="outline" size="sm"><Link to="/admin/social">Manage accounts</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" />Email integration</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Button asChild variant="outline" size="sm"><Link to="/admin/email-settings">Email settings</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />AI engine</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Provider: NVIDIA NIM (server-side)</p>
            <p>Connection: <Badge variant={data?.longcat_status === "connected" ? "default" : "destructive"}>{data?.longcat_status ?? "…"}</Badge></p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
