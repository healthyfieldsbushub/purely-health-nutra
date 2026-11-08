import { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { CartSidebar } from "@/components/cart/CartSidebar";
import { SEOHead } from "@/components/seo/SEOHead";

interface LegalPageProps {
  title: string;
  description: string;
  slug: string;
  updated?: string;
  children: ReactNode;
}

export function LegalPage({ title, description, slug, updated = "5 August 2026", children }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`${title} | Purely Health Nutra`}
        description={description}
        canonical={`https://purelyhealthnutra.company/legal/${slug}`}
      />
      <Header />
      <CartSidebar />
      <main className="container mx-auto px-4 pt-28 pb-16 max-w-3xl">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {updated}</p>
        <div className="space-y-6 text-muted-foreground leading-relaxed [&_h2]:text-foreground [&_h2]:font-semibold [&_h2]:text-xl [&_h2]:mt-10 [&_h2]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_a]:underline [&_a]:text-foreground">
          {children}
        </div>
        <p className="mt-12 text-xs text-muted-foreground">
          This page contains placeholder content maintained by Purely Health Nutra and is not legal advice.
          Please have it reviewed by a qualified attorney before relying on it.
        </p>
      </main>
    </div>
  );
}

export default LegalPage;
