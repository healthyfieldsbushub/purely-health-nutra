import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Cookie, X } from "lucide-react";

const STORAGE_KEY = "cookie_consent";

export function CookieConsent() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* storage blocked */
    }
  }, []);

  const decide = (choice: "accepted" | "declined") => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* storage blocked */
    }
    setVisible(false);
  };

  if (!visible || location.pathname.startsWith("/admin")) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4"
    >
      <div className="mx-auto max-w-4xl rounded-xl border bg-card text-card-foreground shadow-lg p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <Cookie className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground flex-1">
          We use cookies to run this site, remember your cart and understand how the site is used.
          Read our{" "}
          <Link to="/legal/cookie-policy" className="underline font-medium text-foreground">
            Cookie Policy
          </Link>
          .
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => decide("declined")}>
            Decline
          </Button>
          <Button size="sm" onClick={() => decide("accepted")}>
            Accept
          </Button>
          <button
            type="button"
            aria-label="Dismiss cookie notice"
            onClick={() => decide("declined")}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CookieConsent;
