import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { manus } from "@/lib/manus-client";
import { Header } from "@/components/layout/Header";
import { CartSidebar } from "@/components/cart/CartSidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { WhatsAppButton } from "@/components/ui/whatsapp-button";
import { useCart, calculateRootingPrice } from "@/lib/cart-context";
import { useCurrency } from "@/hooks/use-currency";
import { motion } from "motion/react";
import { ShoppingCart, Minus, Plus, ArrowLeft, Star, Sprout, Info } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SEOHead } from "@/components/seo/SEOHead";
import { Breadcrumbs, breadcrumbJsonLd } from "@/components/seo/Breadcrumbs";

const ProductDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { formatPrice } = useCurrency();
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [includeRooting, setIncludeRooting] = useState(false);
  const [size, setSize] = useState<'standard' | 'large'>('standard');
  const [redirected, setRedirected] = useState(false);

  const { data: product, isLoading, error } = useQuery({
    queryKey: ["product", slug],
    queryFn: async () => {
      const { data, error } = await manus
        .from("products")
        .select("*, categories(name, slug)")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (error) throw error;
      return data;
    },
  });

  // If the requested slug is an old address for a renamed product, send the
  // visitor to the current page.
  const { data: redirectTarget } = useQuery({
    queryKey: ["slug-redirect", slug],
    queryFn: async () => {
      const { data, error } = await manus
        .from("slug_redirects")
        .select("product_slug")
        .eq("old_slug", slug)
        .maybeSingle();
      if (error) return null;
      return data?.product_slug || null;
    },
    enabled: !!error && !isLoading,
  });

  // Related cultivars: other active products in the same category.
  const { data: related } = useQuery({
    queryKey: ["related-products", product?.id],
    queryFn: async () => {
      const categoryId = (product as any)?.category_id;
      if (!categoryId) return [];
      const { data, error } = await manus
        .from("products")
        .select("name, slug, price_zar, primary_image_url, sku")
        .eq("category_id", categoryId)
        .eq("is_active", true)
        .neq("id", product.id)
        .limit(8);
      if (error) return [];
      return (data || []) as any[];
    },
    enabled: !!product,
  });

  if (redirectTarget && !redirected) {
    setRedirected(true);
    window.location.replace(`/product/${redirectTarget}`);
  }

  // Dragon fruit listings offer two cutting sizes plus optional rooting.
  const dragonSubcats = ['Dragon Fruit Cultivars', 'Plant Trays', 'Dragon Fruit Cuttings', 'Yellow Varieties'];
  const isCutting = dragonSubcats.includes(String((product as any)?.subcategory || ''));
  // Safe before the loading guard: product is undefined during the first render
  // of a direct page visit, so compute only when it exists.
  const unitPrice = product
    ? (isCutting && size === 'large' ? Number(product.price_zar) + 70 : Number(product.price_zar))
    : 0;
  const handleAddToCart = () => {
    if (!product) return;

    for (let i = 0; i < quantity; i++) {
      addItem({
        id: product.id,
        name: product.name,
        price: unitPrice,
        image: product.primary_image_url || "/placeholder.svg",
        sku: product.sku,
        categoryId: (product as any).category_id,
      }, includeRooting, isCutting ? size : 'standard');
    }

    const rootingText = includeRooting ? " with rooting service" : "";
    toast.success(`${product.name}${rootingText} added to cart!`);
  };

  // Calculate rooting price for display
  const rootingPricePerPlant = calculateRootingPrice(quantity);
  const totalRootingCost = includeRooting ? quantity * rootingPricePerPlant : 0;

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header />
        <CartSidebar />
        <main className="pt-24 pb-16">
          <div className="container mx-auto px-4">
            <div className="animate-pulse grid md:grid-cols-2 gap-10">
              <div className="aspect-square bg-muted rounded-2xl" />
              <div className="space-y-4">
                <div className="h-8 bg-muted rounded w-3/4" />
                <div className="h-6 bg-muted rounded w-1/4" />
                <div className="h-32 bg-muted rounded" />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen">
        <Header />
        <CartSidebar />
        <main className="pt-24 pb-16">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
            <Button onClick={() => navigate("/products")} className="btn-sunset">
              Browse Products
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const images = product.images && Array.isArray(product.images) 
    ? [product.primary_image_url, ...(product.images as string[])]
    : [product.primary_image_url || "/placeholder.svg"];

  const hasDiscount = product.compare_at_price_zar && product.compare_at_price_zar > product.price_zar;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.price_zar / product.compare_at_price_zar!) * 100)
    : 0;

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.short_description || product.description || product.name,
    image: product.primary_image_url || "https://purelyhealthnutra.company/og-image.png",
    sku: product.sku,
    brand: { "@type": "Brand", name: product.brand || "Purely Health Nutra" },
    offers: {
      "@type": "Offer",
      url: `https://purelyhealthnutra.company/product/${product.slug}`,
      priceCurrency: "ZAR",
      price: product.price_zar,
      availability: product.stock_quantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };

  const siteOrigin = "https://purelyhealthnutra.company";
  const categoryInfo = (product as any)?.categories;
  return (
    <div className="min-h-screen">
      <SEOHead
        title={product.meta_title || `${product.name} | Purely Health Nutra South Africa`}
        description={String(product.meta_description || product.short_description || product.description || product.name || '').slice(0, 158)}
        canonical={`${siteOrigin}/product/${product.slug}`}
        ogImage={product.primary_image_url || undefined}
        jsonLd={[productSchema, breadcrumbJsonLd([
          { name: 'Products', url: `${siteOrigin}/products` },
          ...(categoryInfo?.name ? [{ name: categoryInfo.name, url: `${siteOrigin}/products?category=${categoryInfo.slug}` }] : []),
          { name: product.name, url: `${siteOrigin}/product/${product.slug}` },
        ])]}
      />
      <Header />
      <CartSidebar />
      
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          <Breadcrumbs
            items={[
              { label: "Products", href: "/products" },
              ...(categoryInfo?.name ? [{ label: categoryInfo.name, href: `/products?category=${categoryInfo.slug}` }] : []),
              { label: product.name },
            ]}
          />
          {/* Back button */}
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <div className="grid lg:grid-cols-2 gap-10">
            {/* Images */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="aspect-square rounded-2xl overflow-hidden bg-muted mb-4">
                <img
                  src={images[selectedImage] || "/placeholder.svg"}
                  alt={product.name}
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {images.filter(Boolean).map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedImage(index)}
                      className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                        selectedImage === index
                          ? "border-primary"
                          : "border-transparent hover:border-primary/50"
                      }`}
                    >
                      <img
                        src={img || "/placeholder.svg"}
                        alt={`${product.name} ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Product info */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Category badge */}
              {product.categories && (
                <Badge variant="secondary" className="mb-2">
                  {(product.categories as any).name}
                </Badge>
              )}

              {/* Title */}
              <h1 className="font-display text-3xl md:text-4xl font-bold">
                {product.name}
              </h1>

              {/* Price */}
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold text-gradient-sunset">
                  {formatPrice(product.price_zar)}
                </span>
                {hasDiscount && (
                  <>
                    <span className="text-xl text-muted-foreground line-through">
                      {formatPrice(product.compare_at_price_zar!)}
                    </span>
                    <Badge variant="destructive">-{discountPercent}%</Badge>
                  </>
                )}
              </div>

              {/* Rating (placeholder) */}
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`h-5 w-5 ${
                        i < 4 ? "text-yellow-400 fill-yellow-400" : "text-muted"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">(12 reviews)</span>
              </div>

              {/* Short description */}
              {product.short_description && (
                <p className="text-lg text-muted-foreground">
                  {product.short_description}
                </p>
              )}

              {/* Stock status */}
              <div className="flex items-center gap-2">
                {product.stock_quantity > 0 ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-green-600 font-medium">
                      In Stock ({product.stock_quantity} available)
                    </span>
                  </>
                ) : product.allow_backorder ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span className="text-yellow-600 font-medium">Available for backorder</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-red-600 font-medium">Out of Stock</span>
                  </>
                )}
              </div>

              {/* Quantity selector */}
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="font-medium">Quantity:</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <input
                      type="number"
                      min="1"
                      max={product.stock_quantity || 9999}
                      value={quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setQuantity(Math.min(Math.max(1, val), product.stock_quantity || 9999));
                      }}
                      className="w-20 text-center font-semibold border rounded-md px-2 py-1 bg-background"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setQuantity(Math.min(product.stock_quantity || 9999, quantity + 1))}
                      disabled={quantity >= (product.stock_quantity || 9999)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {/* Quick quantity buttons for bulk orders */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-muted-foreground">Quick select:</span>
                  {[10, 50, 150, 300, 600].map((qty) => (
                    <Button
                      key={qty}
                      variant={quantity === qty ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setQuantity(qty)}
                    >
                      {qty}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Cutting Size Option */}
              {isCutting && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20">
                  <Label className="font-semibold">Cutting Size</Label>
                  <p className="text-sm text-muted-foreground mt-1 mb-3">
                    Choose the cutting length for each plant. Shipping weight is calculated from your choice.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSize('standard')}
                      className={`text-left p-3 rounded-lg border transition-colors ${size === 'standard' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                    >
                      <span className="block font-semibold text-sm">20cm &ndash; 30cm cutting</span>
                      <span className="block text-xs text-muted-foreground mt-1">Typically 150g &ndash; 300g per cutting</span>
                      <span className="block text-sm font-medium text-primary mt-1">{formatPrice(product.price_zar)} per cutting</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSize('large')}
                      className={`text-left p-3 rounded-lg border transition-colors ${size === 'large' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                    >
                      <span className="block font-semibold text-sm">40cm cutting (+R70)</span>
                      <span className="block text-xs text-muted-foreground mt-1">Typically 350g &ndash; 700g per cutting</span>
                      <span className="block text-sm font-medium text-primary mt-1">{formatPrice(Number(product.price_zar) + 70)} per cutting</span>
                    </button>
                  </div>
                </div>
              )}
              {/* International shipping note */}
              <p className="text-sm text-muted-foreground">
                We ship internationally &mdash; WhatsApp <a href="https://wa.me/27834474639" className="font-medium text-primary underline">+27 83 447 4639</a> for an export quote.
              </p>
              {/* Rooting Service Option */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Sprout className="h-6 w-6 text-primary mt-0.5" />
                    <div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="rooting-service" className="font-semibold cursor-pointer">
                          Add Professional Rooting Service
                        </Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-sm">
                              Our expert team will professionally root your cuttings with 95%+ success rate.
                              <br /><br />
                              <strong>Pricing:</strong><br />
                              • 1-10 plants: R30/plant<br />
                              • 150+ plants: R5/plant<br />
                              • 600+ plants: R2.50/plant
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        95% success rate guaranteed • Ready-to-plant rooted cuttings
                      </p>
                      {includeRooting && (
                        <p className="text-sm font-medium text-primary mt-2">
                          +{formatPrice(rootingPricePerPlant)}/plant × {quantity} = {formatPrice(totalRootingCost)}
                        </p>
                      )}
                    </div>
                  </div>
                  <Switch
                    id="rooting-service"
                    checked={includeRooting}
                    onCheckedChange={setIncludeRooting}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              {/* Add to cart button */}
              <div className="flex gap-3">
                <Button
                  onClick={handleAddToCart}
                  disabled={product.stock_quantity <= 0 && !product.allow_backorder}
                  className="flex-1 btn-sunset text-lg py-6"
                >
                  <ShoppingCart className="h-5 w-5 mr-2" />
                  Add to Cart - {formatPrice((unitPrice * quantity) + totalRootingCost)}
                </Button>
                <WhatsAppButton 
                  productName={product.name}
                  className="py-6 px-6"
                >
                  <span className="hidden sm:inline">Enquire</span>
                </WhatsAppButton>
              </div>

              {/* Divider before description */}
              <div className="border-t" />

              {/* Full description */}
              {product.description && (
                <div className="pt-6 border-t">
                  <h3 className="font-semibold mb-3">Description</h3>
                  <div
                    className="prose prose-sm text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: product.description }}
                  />
                </div>
              )}

              {/* SKU */}
              <p className="text-sm text-muted-foreground">
                SKU: {product.sku}
              </p>
              {/* SEO keywords, tags and hashtags — visible to customers and crawlers */}
              {(() => {
                const tags = String((product as any).keywords || '').split(',').map((t: string) => t.trim()).filter(Boolean);
                const hashtags = String((product as any).hashtags || '').split(/[\s,]+/).map((t: string) => t.trim()).filter((t: string) => t.startsWith('#'));
                if (!tags.length && !hashtags.length) return null;
                return (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {tags.slice(0, 8).map(t => (
                      <span key={t} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">{t}</span>
                    ))}
                    {hashtags.slice(0, 8).map(h => (
                      <span key={h} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{h}</span>
                    ))}
                  </div>
                );
              })()}
            </motion.div>
          </div>

          {/* Mobile sticky add-to-cart bar */}
          <div className="md:hidden sticky bottom-0 z-40 -mx-4 mt-8 border-t bg-background/95 backdrop-blur px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{product.name}</p>
                <p className="font-bold text-primary">{formatPrice(unitPrice)}</p>
              </div>
              <Button
                onClick={handleAddToCart}
                disabled={product.stock_quantity <= 0}
                className="btn-sunset flex-shrink-0"
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                {product.stock_quantity <= 0 ? 'Out of Stock' : 'Add to Cart'}
              </Button>
            </div>
          </div>

          {related && related.length > 0 && (
            <section className="mt-16 border-t pt-10">
              <h2 className="text-2xl font-bold mb-6">Related Cultivars & Products</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {related.map((r: any) => (
                  <a
                    key={r.slug}
                    href={`/product/${r.slug}`}
                    className="group border rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <div className="aspect-[4/3] bg-muted overflow-hidden">
                      <img
                        src={r.primary_image_url || "/placeholder.svg"}
                        alt={r.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium leading-snug line-clamp-2">{r.name}</p>
                      <p className="text-sm text-primary font-semibold mt-1">{formatPrice(r.price_zar)}</p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProductDetail;
