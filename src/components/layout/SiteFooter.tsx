import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";

const shopLinks = [
  { to: "/products", label: "Shop All" },
  { to: "/products?category=fermentation-cultures-equipment", label: "Fermented Foods" },
  { to: "/products?category=organic-soil-pond-plant-health", label: "EM1 & Farming" },
  { to: "/products?category=live-algae-cultures-projects", label: "Algae Cultures" },
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

// Our Facebook business pages — ProAgriSA Wonderful Dragon Fruit network.
const facebookPages = [
  { label: "DFSA Members Network", to: "https://www.facebook.com/DFSAMembersNetwork" },
  { label: "Dragon Fruit Worldwide SA Plant Supply", to: "https://www.facebook.com/DragonFruitPlantsSouthAfrica" },
  { label: "ProAgriSA Dragon Fruit Botswana", to: "https://www.facebook.com/DragonFruitBotswana" },
  { label: "ProAgriSA Wonderful Dragon Fruit DFSA", to: "https://www.facebook.com/WonderfulDragonFruitDFSA" },
  { label: "ProAgriSA Dragon Fruit Malawi", to: "https://www.facebook.com/DragonFruitMalawi" },
  { label: "ProAgriSA Dragon Fruit Mozambique", to: "https://www.facebook.com/DragonFruitMozambique" },
  { label: "ProAgriSA Dragon Fruit Namibia", to: "https://www.facebook.com/DragonFruitNamibia" },
  { label: "ProAgriSA Dragon Fruit Zimbabwe", to: "https://www.facebook.com/DragonFruitZimbabwe" },
];
const WHATSAPP_URL = "https://wa.me/27736003365";

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
              <li><span className="text-white/40">WhatsApp orders &amp; enquiries:</span> <a href="https://wa.me/27736003365" className="hover:text-white">+27 73 600 3365</a></li>
              <li><span className="text-white/40">Head office / after-hours:</span> <a href="tel:+27834474639" className="hover:text-white">+27 83 447 4639</a></li>
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

        <div className="border-t border-white/10 mt-12 pt-8">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h4 className="font-semibold mb-4 text-[#4ADE80]">Follow Us on Facebook</h4>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-white/60 text-sm">
                {facebookPages.map((page) => (
                  <li key={page.to}>
                    <a href={page.to} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-2">
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"/></svg>
                      {page.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-[#4ADE80]">Chat With Us on WhatsApp</h4>
              <p className="text-sm text-white/60 mb-3">International shipping quotes, bulk orders and product questions — we reply fast.</p>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe5a] text-[#0B3D2E] font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.5 14.1c-.2.7-1.2 1.3-2 1.4-.5.1-1.2.2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.6c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1.1 2.2 1.4 2.5 1.5.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2.1 1c.3.2.5.2.6.4 0 .1 0 .7-.1 1.4Z"/></svg>
                  WhatsApp +27 73 600 3365
              </a>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-white/40 text-sm">
          <span>© {new Date().getFullYear()} Purely Health Nutra. All rights reserved.</span>
          <Link to={isAdmin ? "/admin" : "/login?redirect=/admin"} className="text-[#4ADE80] hover:text-white transition-colors text-xs font-medium">
            {isAdmin ? "Admin Dashboard" : "Admin Login"}
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
