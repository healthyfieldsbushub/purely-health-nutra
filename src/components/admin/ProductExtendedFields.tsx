import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Loader2, Copy, Share2, X } from "lucide-react";
import { toast } from "sonner";

export interface ExtFields {
  // General / descriptive
  subcategory?: string; manufacturer?: string; supplier?: string; product_type?: string;
  product_condition?: string; visibility?: string; highlights?: string; benefits?: string;
  features?: string; specifications_text?: string; applications?: string; origin_country?: string;
  availability_countries?: string; target_customer?: string; target_industry?: string;
  intended_use?: string; instructions?: string; warnings?: string; faqs_text?: string;
  related_products?: string; attachments?: string;
  // Search info
  primary_keyword?: string; secondary_keywords?: string; longtail_keywords?: string;
  related_phrases?: string; synonyms?: string; alternative_names?: string;
  customer_questions?: string; search_tags?: string; hashtags?: string;
  industry_terms?: string; geo_keywords?: string; country_keywords?: string;
  city_keywords?: string; identification_terms?: string; classification?: string;
  use_cases?: string; problem_keywords?: string; search_intent?: string; audience_keywords?: string;
  // SEO
  canonical_url?: string; og_title?: string; og_description?: string; og_image?: string;
  twitter_title?: string; twitter_description?: string; twitter_image?: string;
  internal_links?: string; related_product_links?: string;
  // GEO / AI search
  geo_title?: string; geo_summary?: string; entity_description?: string;
  knowledge_summary?: string; ai_questions?: string; natural_phrases?: string;
  conversational_questions?: string; geo_attributes_text?: string; geographic_relevance?: string;
  target_countries?: string; target_regions?: string; expertise_info?: string; authoritative_info?: string;
  // Pricing / inventory extras
  sale_price?: string; tax_config?: string; low_stock_threshold?: string;
  variants_text?: string; parcels_count?: string; shipping_class?: string; handling_requirements?: string;
}

interface FieldDef {
  key: keyof ExtFields;
  label: string;
  hint?: string;
  type?: "text" | "textarea" | "tags";
}

const TEXT = (key: keyof ExtFields, label: string, hint?: string): FieldDef => ({ key, label, hint, type: "text" });
const AREA = (key: keyof ExtFields, label: string, hint?: string): FieldDef => ({ key, label, hint, type: "textarea" });
const TAGS = (key: keyof ExtFields, label: string, hint?: string): FieldDef => ({ key, label, hint, type: "tags" });

const GROUPS: { id: string; label: string; fields: FieldDef[] }[] = [
  {
    id: "general", label: "Product Info",
    fields: [
      TEXT("subcategory", "Subcategory", "Narrower grouping inside the category, e.g. 'Water kefir'"),
      TEXT("manufacturer", "Manufacturer", "Who makes this product (may differ from the brand)"),
      TEXT("supplier", "Supplier", "Where this product is sourced from"),
      TEXT("product_type", "Product type", "e.g. Live culture, Powder, Cutting, Equipment"),
      TEXT("product_condition", "Product condition", "New, used, refurbished — default: New"),
      AREA("highlights", "Product highlights", "One highlight per line — shown as bullet points"),
      AREA("benefits", "Main product benefits", "Only factual, verifiable benefits — no medical claims"),
      AREA("features", "Product features", "One feature per line"),
      AREA("specifications_text", "Product specifications", "One per line as 'Label: Value' — only facts you supply"),
      AREA("applications", "Applications and uses", "What the product is used for"),
      TEXT("origin_country", "Origin / country of manufacture"),
      TEXT("availability_countries", "Countries of availability", "Comma-separated, e.g. South Africa, Namibia"),
      TEXT("target_customer", "Target customer", "Who this product is for"),
      TEXT("target_industry", "Target industry"),
      TEXT("intended_use", "Intended use"),
      AREA("instructions", "Product instructions", "How to use / plant / store the product"),
      AREA("warnings", "Warnings and safety information", "Only where applicable"),
      AREA("faqs_text", "Frequently asked questions", "One per line as 'Question? Answer.'"),
      TEXT("related_products", "Related products", "Comma-separated product names or slugs"),
      TEXT("attachments", "Attachments / downloadable documents", "Comma-separated file URLs"),
    ],
  },
  {
    id: "search", label: "Search & Tags",
    fields: [
      TAGS("primary_keyword", "Primary SEO keyword", "The main search term this product should rank for"),
      TAGS("secondary_keywords", "Secondary SEO keywords", "Comma-separated"),
      TAGS("longtail_keywords", "Long-tail keywords", "e.g. 'buy milk kefir grains in Gauteng'"),
      TAGS("related_phrases", "Related search phrases"),
      TAGS("synonyms", "Synonyms", "Other words customers use for this product"),
      TAGS("alternative_names", "Alternative product names"),
      TAGS("customer_questions", "Customer search questions", "Questions customers type into search"),
      TAGS("search_tags", "Search tags"),
      TAGS("hashtags", "Hashtags", "Also used for social media sharing — keep relevant"),
      TAGS("industry_terms", "Industry-specific terminology"),
      TAGS("geo_keywords", "Geographic keywords"),
      TAGS("country_keywords", "Country-specific keywords"),
      TAGS("city_keywords", "City and regional keywords", "e.g. Johannesburg, Gauteng, Cape Town"),
      TAGS("identification_terms", "Product identification terms", "Names, codes or terms that identify this product"),
      TEXT("classification", "Product classification"),
      TAGS("use_cases", "Product use cases"),
      TAGS("problem_keywords", "Customer problem / solution keywords", "Problems this product solves"),
      TEXT("search_intent", "Search intent", "e.g. buy, learn, compare"),
      TAGS("audience_keywords", "Target audience keywords"),
    ],
  },
  {
    id: "seo", label: "SEO",
    fields: [
      TEXT("canonical_url", "Canonical URL", "Leave empty to use the product's own page URL"),
      TEXT("og_title", "Open Graph title", "Title shown when shared on Facebook/WhatsApp"),
      AREA("og_description", "Open Graph description"),
      TEXT("og_image", "Open Graph image URL"),
      TEXT("twitter_title", "Twitter/X card title"),
      AREA("twitter_description", "Twitter/X card description"),
      TEXT("twitter_image", "Twitter/X card image URL"),
      TEXT("internal_links", "Internal linking suggestions", "Comma-separated page or product URLs to link to"),
      TEXT("related_product_links", "Related product links", "Comma-separated product URLs"),
    ],
  },
  {
    id: "geo", label: "GEO / AI Search",
    fields: [
      TEXT("geo_title", "AI search title", "How AI answer engines should title this product"),
      AREA("geo_summary", "AI search summary", "2–3 sentence factual summary AI engines can quote"),
      AREA("entity_description", "Product entity description", "Encyclopedic description of what this product IS"),
      AREA("knowledge_summary", "Product knowledge summary", "Full factual knowledge block about this product"),
      TAGS("ai_questions", "AI search questions", "Questions this product page should answer"),
      TAGS("natural_phrases", "Natural-language search phrases", "How people ask verbally"),
      TAGS("conversational_questions", "Conversational search questions"),
      AREA("geo_attributes_text", "Product facts and attributes", "One per line as 'Label: Value' — factual attributes only"),
      TEXT("geographic_relevance", "Geographic relevance", "Where this product is relevant"),
      TAGS("target_countries", "Target countries"),
      TAGS("target_regions", "Target regions", "e.g. Gauteng, Western Cape"),
      AREA("expertise_info", "Product expertise information", "Your specialist knowledge about this product"),
      AREA("authoritative_info", "Authoritative product information", "Verified facts, certifications, sources"),
    ],
  },
  {
    id: "inventory", label: "Pricing & Inventory",
    fields: [
      TEXT("sale_price", "Sale price (ZAR)", "Discounted selling price, optional"),
      TEXT("tax_config", "Tax configuration", "e.g. 'VAT inclusive 15%' or 'VAT exempt'"),
      TEXT("low_stock_threshold", "Low-stock notification threshold", "Alert when stock falls to this level, default 5"),
      AREA("variants_text", "Product variants", "One variant per line as 'Name | SKU | Price | Stock | Weight kg | LxWxH cm'"),
      TEXT("parcels_count", "Number of parcels", "How many parcels this product ships as, default 1"),
      TEXT("shipping_class", "Shipping class", "e.g. Standard, Fragile, Frozen"),
      TEXT("handling_requirements", "Special handling requirements", "e.g. keep cold, fragile"),
    ],
  },
];

function FieldRow({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{field.label}</Label>
      {field.type === "textarea" ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="text-sm" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      )}
      {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

export function ProductExtendedFields({ ext, onChange, productContext }: {
  ext: ExtFields;
  onChange: (ext: ExtFields) => void;
  productContext: { name?: string; short_description?: string; description?: string; facts?: string; price_zar?: string; category_id?: string | null };
}) {
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<Record<string, string> | null>(null);
  const set = (key: keyof ExtFields, value: string) => onChange({ ...ext, [key]: value });

  const generate = async (scope: string) => {
    setIsGenerating(scope);
    try {
      const response = await fetch("/api/functions/generate-product-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, product: { ...productContext, ...ext } }),
      });
      const result = await response.json().catch(() => ({}));
      const data = result.data ?? result;
      if (result.error || data.error || !data.content) throw new Error(result.error || data.error || "Generation failed");
      setAiPreview(data.content);
      toast.success(`NVIDIA AI generated ${data.fields} fields — review and apply`);
    } catch (error: any) {
      toast.error(error.message || "AI generation failed");
    } finally {
      setIsGenerating(null);
    }
  };

  const applyAi = () => {
    if (!aiPreview) return;
    const next: ExtFields = { ...ext };
    const str = (v: any) => Array.isArray(v) ? v.map((x: any) => typeof x === "object" ? `${x.label || x.question || ""}: ${x.value || x.answer || ""}` : String(x)).join("\n") : String(v ?? "");
    for (const [aiKey, value] of Object.entries(aiPreview)) {
      if (aiKey === "specifications") next.specifications_text = Array.isArray(value) ? value.map((s: any) => `${s.label}: ${s.value}`).join("\n") : str(value);
      else if (aiKey === "faqs") next.faqs_text = Array.isArray(value) ? value.map((f: any) => `${f.question} ${f.answer}`).join("\n") : str(value);
      else if (aiKey === "geo_attributes") next.geo_attributes_text = Array.isArray(value) ? value.map((s: any) => `${s.label}: ${s.value}`).join("\n") : str(value);
      else if (aiKey === "highlights" || aiKey === "benefits" || aiKey === "features" || aiKey === "applications") next[aiKey as keyof ExtFields] = Array.isArray(value) ? value.join("\n") : str(value);
      else if (aiKey === "social_posts") continue; // social posts handled in the social dialog
      else if (aiKey in next) (next as any)[aiKey] = str(value);
    }
    onChange(next);
    setAiPreview(null);
    toast.success("AI content applied — review before saving");
  };

  return (
    <div className="space-y-4">
      {/* AI generation controls */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Generate with AI (NVIDIA)</span>
          <Badge variant="secondary" className="text-[10px]">server-side · no Manus AI</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All fields"], ["seo", "SEO only"], ["geo", "GEO only"], ["keywords", "Keywords & tags"], ["description", "Description only"], ["social", "Social content"],
          ].map(([scope, label]) => (
            <Button key={scope} type="button" variant="outline" size="sm" disabled={isGenerating !== null} onClick={() => generate(scope)}>
              {isGenerating === scope ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}{label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">AI (NVIDIA) uses only the facts you supply — missing information stays blank for you to fill in. Nothing is published automatically.</p>
      </div>

      {/* AI preview dialog */}
      <Dialog open={aiPreview !== null} onOpenChange={(open) => !open && setAiPreview(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>NVIDIA AI generated content — review before applying</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {aiPreview && Object.entries(aiPreview).map(([key, value]) => (
              <div key={key} className="rounded border p-2">
                <p className="text-xs font-semibold text-muted-foreground mb-1">{key}</p>
                <p className="whitespace-pre-wrap">{typeof value === "object" ? JSON.stringify(value, null, 1) : String(value)}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setAiPreview(null)}>Discard</Button>
            <Button type="button" onClick={applyAi}>Apply to form</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap h-auto">
          {GROUPS.map(g => <TabsTrigger key={g.id} value={g.id} className="text-xs">{g.label}</TabsTrigger>)}
        </TabsList>
        {GROUPS.map(g => (
          <TabsContent key={g.id} value={g.id} className="space-y-3 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {g.fields.map(field => (
                <div key={String(field.key)} className={field.type === "textarea" ? "sm:col-span-2" : ""}>
                  <FieldRow field={field} value={String(ext[field.key] ?? "")} onChange={(v) => set(field.key, v)} />
                </div>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
