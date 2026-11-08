import { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { CartSidebar } from '@/components/cart/CartSidebar';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';

export function PageShell({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <CartSidebar />
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {children}
      </main>
    </div>
  );
}
