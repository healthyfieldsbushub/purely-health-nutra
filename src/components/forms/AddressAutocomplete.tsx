import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin } from "lucide-react";

interface Suggestion {
  address: string;
  placeId?: string | null;
  postalCode?: string;
  gps?: { lat: number; lng: number } | null;
}

const API_BASE = import.meta.env.VITE_API_BASE || "";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick?: (picked: { address: string; city?: string; province?: string; postalCode?: string }) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export function AddressAutocomplete({ id, value, onChange, onPick, placeholder, required, className }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const query = async (text: string) => {
    if (text.trim().length < 4) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/functions/address-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text }),
      });
      const result = await response.json().catch(() => ({}));
      const data = result.data ?? result;
      setSuggestions((data.suggestions || []).slice(0, 6));
      setOpen(true);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (text: string) => {
    onChange(text);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => query(text), 450);
  };

  const pick = (suggestion: Suggestion) => {
    onChange(suggestion.address);
    setOpen(false);
    setHighlight(-1);
    // Every pick resolves server-side via Google Geocoding into a clean
    // formatted address with the postal code and city filled in automatically.
    fetch(`${API_BASE}/api/functions/address-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: suggestion.placeId || null, address: suggestion.address }),
    })
      .then((response) => response.json().catch(() => ({})))
      .then((result) => {
        const data = result.data ?? result;
        const address = data.address || suggestion.address;
        onChange(address);
        onPick?.({ address, city: data.city || undefined, province: data.province || undefined, postalCode: data.postalCode || suggestion.postalCode || "" });
      })
      .catch(() => {
        onPick?.({ address: suggestion.address, province: undefined, postalCode: suggestion.postalCode || "" });
      });
  };

  return (
    <div ref={containerRef} className={`relative ${className || ""}`}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (suggestions.length) setOpen(true); }}
          onKeyDown={(e) => {
            if (!open || !suggestions.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)); }
            if (e.key === "Enter" && highlight >= 0) { e.preventDefault(); pick(suggestions[highlight]); }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-40 mt-1 w-full rounded-md border bg-background shadow-lg overflow-hidden">
          <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">Google address suggestions</p>
          {suggestions.map((suggestion, index) => (
            <button
              key={`${index}-${suggestion.address}`}
              type="button"
              onMouseEnter={() => setHighlight(index)}
              onClick={() => pick(suggestion)}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${index === highlight ? "bg-muted" : ""}`}
            >
              <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span className="font-medium">{suggestion.address}</span>
            </button>
          ))}
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t">Live Google address suggestions — pick one or keep typing.</p>
        </div>
      )}
    </div>
  );
}
