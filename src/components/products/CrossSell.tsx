import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, ShoppingBag } from "lucide-react";
import { manus } from "@/lib/manus-client";
import { useCart } from "@/lib/cart-context";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/hooks/use-currency";

interface CrossSellProps {
  /** Product ids already in the cart — never recommended again. */
  excludeIds: string[];
  /** Category ids in the cart used as recommendation seeds. */
  seedCategoryIds: string[];
  limit?: number;
  compact?: boolean;
}

const PLANTS_CATEGORY = "cat-84b1fdbe-fa54-4d7b-ac0d-7f72a5ed1c1b";
// Gut-health companions promoted alongside nursery stock.
const COMPANION_CATEGORIES = [
  "cat-bce9cb08-30a0-4aba-a917-6011d556e3e3", // Fermentation Cultures & Equipment
  "cat-39277e2c-794e-477c-9357-d64416630861", // Live Algae Cultures & Projects
];

interface Suggestion {
  id: string;
  name: string;
  slug: string;
  sku: string;
  price_zar: number;
  primary_image_url: string | null;
  category_id: string;
  subcategory: string;
  is_featured: boolean;
}

/**
 * Dynamic upsell / cross-sell widget. Ranks catalogue products against the
 * current cart: same-category first, featured products next, then gut-health
 * companion categories, so customers see relevant add-ons in the cart drawer
 * and at checkout.
 */
export function CrossSell({ excludeIds, seedCategoryIds, limit = 4, compact = false }: CrossSellProps) {
  const { addItem } = useCart();
  const { formatPrice } = useCurrency();

  const { data: products, isLoading } = useQuery({
    queryKey: ["cross-sell-catalogue"],
    queryFn: async (): Promise<Suggestion[]> => {
      const { data, error } = await manus
        .from("products")
        .select("id, name, slug, sku, price_zar, primary_image_url, category_id, subcategory, is_featured")
        .eq("is_active", true);
      if (error) return [];
      return (data || []) as Suggestion[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const suggestions = useMemo(() => {
    if (!products) return [];
    const excluded = new Set(excludeIds);
    const seeds = new Set(seedCategoryIds);
    // Cross-promote fermentation and algae cultures with nursery stock.
    const companionBoost = seedCategoryIds.includes(PLANTS_CATEGORY) ? COMPANION_CATEGORIES : [];
    const scored = products
      .filter(p => !excluded.has(p.id) && Number(p.price_zar) > 0)
      .map(p => {
        let score = 0;
        if (seeds.has(p.category_id)) score += 4;
        if (companionBoost.includes(p.category_id)) score += 3;
        if (p.is_featured) score += 2;
        return { p, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || a.p.price_zar - b.p.price_zar);
    return scored.slice(0, limit).map(s => s.p);
  }, [products, excludeIds, seedCategoryIds, limit]);

  if (isLoading || suggestions.length === 0) return null;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {!compact && (
        <p className="text-sm font-semibold flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" />
          Frequently bought together
        </p>
      )}
      <div className={compact ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 lg:grid-cols-4 gap-3"}>
        {suggestions.map(p => (
          <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg border bg-card">
            <Link to={`/product/${p.slug}`} className="shrink-0">
              <img
                src={p.primary_image_url || "/placeholder.svg"}
                alt={p.name}
                loading="lazy"
                className={compact ? "w-12 h-12 object-cover rounded-md" : "w-14 h-14 object-cover rounded-md"}
              />
            </Link>
            <div className="flex-1 min-w-0">
              <Link to={`/product/${p.slug}`} className="text-xs font-medium line-clamp-2 hover:text-primary">
                {p.name}
              </Link>
              <p className="text-xs font-semibold text-primary">{formatPrice(Number(p.price_zar))}</p>
            </div>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              aria-label={`Add ${p.name} to cart`}
              onClick={() => {
                addItem({
                  id: p.id,
                  name: p.name,
                  price: Number(p.price_zar),
                  image: p.primary_image_url || "/placeholder.svg",
                  sku: p.sku,
                  categoryId: p.category_id,
                });
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
