import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getShippingRates, type ShippingRate } from "@/lib/api";
import { useCart } from "@/lib/cart-context";
import { manus } from "@/lib/manus-client";
import { Truck, Loader2 } from "lucide-react";

// Quick shipping estimate shown in the cart. The final price is always
// recalculated on the server at checkout; this is only an estimate.
const ShippingEstimator = () => {
  const { items } = useCart();
  const [postalCode, setPostalCode] = useState("");
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const estimate = async () => {
    if (postalCode.trim().length < 4 || items.length === 0) return;
    setLoading(true);
    try {
      const productIds = items.map((item) => item.productId);
      const { data: products } = await manus
        .from('products')
        .select('id, weight_kg, length_cm, width_cm, height_cm')
        .in('id', productIds);
      let weight = 0;
      let volume = 0;
      let anyWeight = false;
      for (const item of items) {
        const product = (products || []).find((p: any) => p.id === item.productId);
        const productWeight = Number(product?.weight_kg || 0);
        if (productWeight > 0) {
          anyWeight = true;
          weight += productWeight * item.quantity;
        }
        volume += Number(product?.length_cm || 0) * Number(product?.width_cm || 0) * Number(product?.height_cm || 0) * item.quantity;
      }
      // Approximate the smallest standard box that fits and add packaging weight.
      const boxes = [
        { l: 25, w: 20, h: 12 },
        { l: 35, w: 28, h: 20 },
        { l: 45, w: 35, h: 30 },
      ];
      const box = boxes.find((b) => b.l * b.w * b.h >= volume) || boxes[boxes.length - 1];
      const billable = Math.max(anyWeight ? weight + 0.3 : 0.5, (box.l * box.w * box.h) / 5000);
      const quoted = await getShippingRates(
        "1739",
        postalCode.trim(),
        Math.max(billable, 0.1),
        { length: box.l, width: box.w, height: box.h },
        { postalCode, country: "South Africa", type: "residential" },
      );
      setRates(quoted.slice(0, 3));
      setChecked(true);
    } catch {
      setRates([]);
      setChecked(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-primary" />
        Estimate shipping
      </div>
      <div className="flex gap-2">
        <Input
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          placeholder="Postal code"
          inputMode="numeric"
          maxLength={10}
        />
        <Button type="button" size="sm" variant="outline" onClick={estimate} disabled={loading || postalCode.trim().length < 4 || items.length === 0}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
        </Button>
      </div>
      {checked && (
        <div className="text-xs space-y-1">
          {rates.length === 0 ? (
            <p className="text-muted-foreground">No estimate available — exact options are shown at checkout.</p>
          ) : (
            rates.map((rate) => (
              <div key={`${rate.provider}:${rate.service}`} className="flex justify-between text-muted-foreground">
                <span>{rate.service}</span>
                <span className="font-medium text-foreground">R{rate.price.toFixed(2)} · {rate.estimatedDays}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ShippingEstimator;
