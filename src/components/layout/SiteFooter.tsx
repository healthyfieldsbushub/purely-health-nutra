import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";

const shopLinks = [
  { to: "/products", label: "Shop All" },
  { to: "/products?category=fermented-foods", label: "Fermented Foods" },
  { to: "/products?category=bio-fertilizers", label: "EM1 & Farming" },
  { to: "/products?category=algae-superfoods", label: "Algae Cultures" },
  { to: "/blog", label: "Blog & Recipes" },
];

const companyLinks = [
  { to: "/about", label: "About Us" },
  { to: "/contact", label: "Contact" },
  { to: "/consultations", label: "Consultations" },
  { to: "/directory", label: "Business Directory" },
  { to: "/track-order", label: "Track Order" },
];

export const legalLinks = [
  { to: "/legal/privacy-policy", label: "Privacy Policy" },
  { to: "/legal/terms-of-service", label: "Terms of Service" },
  { to: "/legal/cookie-policy", label: "Cookie Policy" },
  { to: "/legal/community-guidelines", label: "Community Guidelines" },
  { to: "/legal/copyright-policy", label: "Copyright Policy" },
  { to: "/legal/facebook-data-deletion", label: "Facebook Data Deletion" },
];

export function SiteFooter() {
  const { isAdmin } = useAuth();
  const location = useLocation();

  if (location.pathname.startsWith("/admin")) return null;

  return (
    <footer className="bg-[#0B3D2E] text-white">
      <div className="container mx-auto px-4 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-serif text-2xl font-bold mb-2">
              <span className="text-[#4ADE80]">Purely Health</span> Nutra
            </p>
            <p className="text-sm text-white/60 mb-4">Gauteng, South Africa</p>
            <p className="text-xs text-white/40 leading-relaxed">
              Live probiotic cultures, fermentation starters and natural health products
              for homes, clinics and farms. Nationwide &amp; worldwide shipping.
            </p>
            <ul className="mt-5 space-y-2 text-white/60 text-sm">
              <li>admin@proagrisa.co.za</li>
              <li>+27 83 447 4639</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-[#4ADE80]">Shop</h4>
            <ul className="space-y-3 text-white/60 text-sm">
              {shopLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-[#4ADE80]">Company</h4>
            <ul className="space-y-3 text-white/60 text-sm">
              {companyLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-[#4ADE80]">Legal</h4>
            <ul className="space-y-3 text-white/60 text-sm">
              {legalLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-white/40 text-sm">
          <span>© {new Date().getFullYear()} Purely Health Nutra. All rights reserved.</span>
          {isAdmin && (
            <Link to="/admin" className="text-[#4ADE80] hover:text-white transition-colors text-xs font-medium">
              Admin Dashboard
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
