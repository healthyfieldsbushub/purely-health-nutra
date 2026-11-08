import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { manus } from '@/lib/manus-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Sparkles, Loader2, DollarSign, Package, Upload, Search, Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { MultiImageUpload } from '@/components/admin/MultiImageUpload';
import { useCategories } from '@/hooks/use-products';
import { ProductExtendedFields, type ExtFields } from '@/components/admin/ProductExtendedFields';
import { SocialPublishDialog } from '@/pages/admin/SocialMedia';

interface ProductForm {
  name: string;
  sku: string;
  slug: string;
  short_description: string;
  description: string;
  category_id: string | null;
  brand: string;
  tags: string;
  price_zar: string;
  compare_at_price_zar: string;
  allow_backorder: boolean;
  stock_quantity: string;
  weight_kg: string;
  packaging_weight_kg: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  packed_length_cm: string;
  packed_width_cm: string;
  packed_height_cm: string;
  parcel_count: string;
  meta_title: string;
  meta_description: string;
  primary_image_url: string;
  images: string[];
  is_active: boolean;
  is_featured: boolean;
  promo_price_zar: string;
  promo_starts_at: string;
  promo_ends_at: string;
  hide_after_promo: boolean;
  ext: ExtFields;
}

const emptyForm: ProductForm = {
  name: '',
  sku: '',
  slug: '',
  short_description: '',
  description: '',
  category_id: null,
  brand: 'Purely Health Nutra',
  tags: '',
  price_zar: '',
  compare_at_price_zar: '',
  allow_backorder: true,
  stock_quantity: '0',
  weight_kg: '',
  packaging_weight_kg: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  packed_length_cm: '',
  packed_width_cm: '',
  packed_height_cm: '',
  parcel_count: '',
  meta_title: '',
  meta_description: '',
  primary_image_url: '',
  images: [],
  is_active: true,
  is_featured: false,
  promo_price_zar: '',
  promo_starts_at: '',
  promo_ends_at: '',
  hide_after_promo: false,
  ext: {},
};

export default function AdminProducts() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isBulkPriceOpen, setIsBulkPriceOpen] = useState(false);
  const [isBulkStockOpen, setIsBulkStockOpen] = useState(false);
  const [bulkPriceAction, setBulkPriceAction] = useState<'set' | 'increase' | 'decrease'>('set');
  const [bulkPriceValue, setBulkPriceValue] = useState('');
  const [bulkPricePercent, setBulkPricePercent] = useState(false);
  const [bulkStockAction, setBulkStockAction] = useState<'set' | 'add' | 'subtract'>('set');
  const [bulkStockValue, setBulkStockValue] = useState('');
  const [isBulkImageUploading, setIsBulkImageUploading] = useState(false);
  const [bulkImageSummary, setBulkImageSummary] = useState<{ uploaded: number; skipped: string[] } | null>(null);
  const [missingShippingOnly, setMissingShippingOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSocialOpen, setIsSocialOpen] = useState(false);
  const [socialProduct, setSocialProduct] = useState<any>(null);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState({
    category_id: '' as string,
    brand: '',
    weight_kg: '',
    length_cm: '',
    width_cm: '',
    height_cm: '',
    regenerateSku: false,
  });
  
  const { data: categories } = useCategories();

  const { data: products, isLoading } = useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => {
      const { data, error } = await manus
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: ProductForm) => {
      // Set primary image from images array if not set
      const primaryImage = data.primary_image_url || data.images[0] || null;
      const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      let slug = slugify(data.slug || data.name);
      // Keep slugs unique: add -2, -3... if another product already uses it.
      const taken = new Set((products || [])
        .filter((p: any) => p.id !== editingId)
        .map((p: any) => p.slug));
      if (taken.has(slug)) {
        let n = 2;
        while (taken.has(`${slug}-${n}`)) n += 1;
        slug = `${slug}-${n}`;
      }
      let sku = data.sku.trim();
      // Auto-generate a unique SKU when left empty.
      if (!sku) {
        let max = 0;
        for (const p of products || []) {
          const match = /^PHN-(\d+)$/.exec(String(p.sku || ''));
          if (match) max = Math.max(max, parseInt(match[1], 10));
        }
        sku = `PHN-${String(max + 1).padStart(4, '0')}`;
      }

      const payload: any = {
        name: data.name,
        sku,
        slug,
        short_description: data.short_description || null,
        description: data.description || null,
        category_id: data.category_id || null,
        brand: data.brand || null,
        tags: data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        price_zar: parseFloat(data.price_zar) || 0,
        compare_at_price_zar: data.compare_at_price_zar ? parseFloat(data.compare_at_price_zar) : null,
        allow_backorder: data.allow_backorder,
        stock_quantity: parseInt(data.stock_quantity) || 0,
        weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
        packaging_weight_kg: data.packaging_weight_kg ? parseFloat(data.packaging_weight_kg) : null,
        length_cm: data.length_cm ? parseFloat(data.length_cm) : null,
        width_cm: data.width_cm ? parseFloat(data.width_cm) : null,
        height_cm: data.height_cm ? parseFloat(data.height_cm) : null,
        packed_length_cm: data.packed_length_cm ? parseFloat(data.packed_length_cm) : null,
        packed_width_cm: data.packed_width_cm ? parseFloat(data.packed_width_cm) : null,
        packed_height_cm: data.packed_height_cm ? parseFloat(data.packed_height_cm) : null,
        parcel_count: data.parcel_count ? parseInt(data.parcel_count) : null,
        meta_title: data.meta_title || null,
        meta_description: data.meta_description || null,
        primary_image_url: primaryImage,
        images: data.images,
        is_active: data.is_active,
        is_featured: data.is_featured,
        promo_price_zar: data.promo_price_zar ? parseFloat(data.promo_price_zar) : null,
        promo_starts_at: data.promo_starts_at || null,
        promo_ends_at: data.promo_ends_at || null,
        hide_after_promo: data.hide_after_promo,
        // Extended product-management fields (search, SEO, GEO, specifics,
        // inventory extras) are saved alongside the core record — blank
        // fields are omitted so they never overwrite existing data.
        ...(Object.fromEntries(Object.entries(data.ext || {}).filter(([, v]) => typeof v === 'string' ? v.trim() !== '' : v != null))),
      };

      if (editingId) {
        // When the URL slug changes, remember the old address so existing
        // links keep working.
        const previous = (products || []).find((p: any) => p.id === editingId);
        if (previous && previous.slug && previous.slug !== slug) {
          await manus.from('slug_redirects').upsert(
            { old_slug: previous.slug, product_slug: slug },
            { onConflict: 'old_slug' }
          );
        }
        const { error } = await manus
          .from('products')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await manus
          .from('products')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      setIsOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? 'Product updated!' : 'Product created!');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const bulkPriceMutation = useMutation({
    mutationFn: async () => {
      const value = parseFloat(bulkPriceValue);
      if (isNaN(value)) throw new Error('Invalid price value');
      
      for (const productId of selectedProducts) {
        const product = products?.find(p => p.id === productId);
        if (!product) continue;
        
        let newPrice: number;
        if (bulkPriceAction === 'set') {
          newPrice = value;
        } else if (bulkPriceAction === 'increase') {
          newPrice = bulkPricePercent 
            ? product.price_zar * (1 + value / 100)
            : product.price_zar + value;
        } else {
          newPrice = bulkPricePercent 
            ? product.price_zar * (1 - value / 100)
            : product.price_zar - value;
        }
        
        newPrice = Math.max(0, Math.round(newPrice * 100) / 100);
        
        const { error } = await manus
          .from('products')
          .update({ price_zar: newPrice })
          .eq('id', productId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      setIsBulkPriceOpen(false);
      setSelectedProducts(new Set());
      setBulkPriceValue('');
      toast.success(`Updated prices for ${selectedProducts.size} products`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const bulkStockMutation = useMutation({
    mutationFn: async () => {
      const value = parseInt(bulkStockValue);
      if (isNaN(value)) throw new Error('Invalid stock value');
      
      for (const productId of selectedProducts) {
        const product = products?.find(p => p.id === productId);
        if (!product) continue;
        
        let newStock: number;
        if (bulkStockAction === 'set') {
          newStock = value;
        } else if (bulkStockAction === 'add') {
          newStock = product.stock_quantity + value;
        } else {
          newStock = product.stock_quantity - value;
        }
        
        newStock = Math.max(0, newStock);
        
        const { error } = await manus
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', productId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      setIsBulkStockOpen(false);
      setSelectedProducts(new Set());
      setBulkStockValue('');
      toast.success(`Updated stock for ${selectedProducts.size} products`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleProductSelection = (productId: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(productId)) {
      newSelected.delete(productId);
    } else {
      newSelected.add(productId);
    }
    setSelectedProducts(newSelected);
  };

  const toggleAllProducts = () => {
    if (selectedProducts.size === products?.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(products?.map(p => p.id) || []));
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await manus.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success('Product deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // One-click activate/deactivate: inactive products disappear from the shop page.
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await manus.from('products').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success(variables.is_active ? 'Product activated — now visible in the shop' : 'Product deactivated — hidden from the shop');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async (is_active: boolean) => {
      for (const productId of selectedProducts) {
        const { error } = await manus.from('products').update({ is_active }).eq('id', productId);
        if (error) throw error;
      }
    },
    onSuccess: (_data, is_active) => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      setSelectedProducts(new Set());
      toast.success(`${selectedProducts.size} product(s) ${is_active ? 'activated' : 'deactivated'}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Applies only the fields the user filled in; blank fields leave products unchanged.
  const bulkEditMutation = useMutation({
    mutationFn: async () => {
      const numeric = (value: string) => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      };
      const updates: Record<string, unknown> = {};
      if (bulkEdit.category_id) updates.category_id = bulkEdit.category_id;
      if (bulkEdit.brand.trim()) updates.brand = bulkEdit.brand.trim();
      if (bulkEdit.weight_kg.trim()) updates.weight_kg = numeric(bulkEdit.weight_kg);
      if (bulkEdit.length_cm.trim()) updates.length_cm = numeric(bulkEdit.length_cm);
      if (bulkEdit.width_cm.trim()) updates.width_cm = numeric(bulkEdit.width_cm);
      if (bulkEdit.height_cm.trim()) updates.height_cm = numeric(bulkEdit.height_cm);
      if (!Object.keys(updates).length && !bulkEdit.regenerateSku) {
        throw new Error('Fill in at least one field (or tick SKU regeneration) before applying');
      }
      let nextSkuNumber = 1;
      for (const p of products || []) {
        const match = /^PHN-(\d+)$/.exec(String(p.sku || ''));
        if (match) nextSkuNumber = Math.max(nextSkuNumber, parseInt(match[1], 10) + 1);
      }
      for (const productId of selectedProducts) {
        const payload: Record<string, unknown> = { ...updates };
        if (bulkEdit.regenerateSku) {
          payload.sku = `PHN-${String(nextSkuNumber).padStart(4, '0')}`;
          nextSkuNumber += 1;
        }
        const { error } = await manus.from('products').update(payload).eq('id', productId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      setIsBulkEditOpen(false);
      setSelectedProducts(new Set());
      setBulkEdit({ category_id: '', brand: '', weight_kg: '', length_cm: '', width_cm: '', height_cm: '', regenerateSku: false });
      toast.success(`Updated ${selectedProducts.size} product(s)`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateDescription = async () => {
    if (!form.name) {
      toast.error('Please enter a product name first');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch(
        `${""}/api/functions/admin-ai`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${""}`,
          },
          body: JSON.stringify({
            type: 'product_description',
            prompt: form.short_description || 'Create a compelling description',
            context: {
              productName: form.name,
              existingDescription: form.description,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate');
      }

      const data = await response.json();
      setForm((prev) => ({ ...prev, description: data.content }));
      toast.success('Description generated!');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEdit = (product: any) => {
    setEditingId(product.id);
    const productImages = Array.isArray(product.images) ? product.images : [];
    setForm({
      name: product.name,
      sku: product.sku,
      slug: product.slug,
      short_description: product.short_description || '',
      description: product.description || '',
      category_id: product.category_id || null,
      brand: product.brand || 'Purely Health Nutra',
      tags: Array.isArray(product.tags) ? product.tags.join(', ') : '',
      price_zar: product.price_zar?.toString() || '',
      compare_at_price_zar: product.compare_at_price_zar?.toString() || '',
      allow_backorder: product.allow_backorder ?? true,
      stock_quantity: product.stock_quantity?.toString() || '0',
      weight_kg: product.weight_kg?.toString() || '',
      packaging_weight_kg: product.packaging_weight_kg?.toString() || '',
      length_cm: product.length_cm?.toString() || '',
      width_cm: product.width_cm?.toString() || '',
      height_cm: product.height_cm?.toString() || '',
      packed_length_cm: product.packed_length_cm?.toString() || '',
      packed_width_cm: product.packed_width_cm?.toString() || '',
      packed_height_cm: product.packed_height_cm?.toString() || '',
      parcel_count: product.parcel_count?.toString() || '',
      meta_title: product.meta_title || '',
      meta_description: product.meta_description || '',
      primary_image_url: product.primary_image_url || '',
      images: productImages as string[],
      is_active: product.is_active ?? true,
      is_featured: product.is_featured ?? false,
      promo_price_zar: product.promo_price_zar?.toString() || '',
      promo_starts_at: product.promo_starts_at ? new Date(product.promo_starts_at).toISOString().slice(0, 16) : '',
      promo_ends_at: product.promo_ends_at ? new Date(product.promo_ends_at).toISOString().slice(0, 16) : '',
      hide_after_promo: product.hide_after_promo ?? false,
      ext: { ...(product.ext || {}) },
    });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.sku || !form.price_zar) {
      toast.error('Please fill in required fields');
      return;
    }
    if (form.is_active && (!form.weight_kg || !form.length_cm || !form.width_cm || !form.height_cm)) {
      toast.error('A product cannot be published without weight and dimensions. Fill them in under Shipping, or untick Published.');
      return;
    }
    saveMutation.mutate(form);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
    }).format(value);
  };

  const getCategoryName = (categoryId: string | null) => {
    if (!categoryId) return null;
    const category = categories?.find((c) => c.id === categoryId);
    return category?.name || null;
  };

  const suggestedSku = (() => {
    if (!products?.length) return 'PHN-0001';
    const prefix = 'PHN';
    let max = 0;
    for (const product of products) {
      const match = /^PHN-(\d+)$/.exec(String(product.sku || ''));
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  })();

  // (extended product management fields are rendered inside the form dialog below)

  const uploadBulkProductImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !products?.length) return;

    setIsBulkImageUploading(true);
    setBulkImageSummary(null);
    const skipped: string[] = [];
    let uploaded = 0;

    try {
      for (const file of files) {
        if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
          skipped.push(`${file.name} (image only, max 10MB)`);
          continue;
        }

        const sku = file.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
        const product = products.find((item) => String(item.sku).toLowerCase() === sku);
        if (!product) {
          skipped.push(`${file.name} (no matching SKU)`);
          continue;
        }

        const storagePath = `products/${product.sku}.jpg`;
        const { data: uploadData, error: uploadError } = await manus.storage
          .from('product-images')
          .upload(storagePath, file, { upsert: true, cacheControl: '31536000' });
        if (uploadError) throw uploadError;

        const publicUrl = uploadData?.publicUrl || manus.storage.from('product-images').getPublicUrl(storagePath).data.publicUrl;
        const existingImages = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
        const images = [publicUrl, ...existingImages.filter((url: string) => url !== publicUrl)];
        const { error: updateError } = await manus
          .from('products')
          .update({ primary_image_url: publicUrl, images, image_fingerprint: uploadData?.fingerprint || null, image_source_fingerprint: uploadData?.sourceFingerprint || null, image_processed_at: new Date().toISOString() })
          .eq('id', product.id);
        if (updateError) throw updateError;
        uploaded += 1;
      }

      setBulkImageSummary({ uploaded, skipped });
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success(`${uploaded} product image${uploaded === 1 ? '' : 's'} uploaded to Manus storage`);
    } catch (error: any) {
      toast.error(error.message || 'Bulk image upload failed');
    } finally {
      setIsBulkImageUploading(false);
    }
  };

  const hasShippingData = (product: any) =>
    product.weight_kg != null && product.weight_kg !== '' &&
    product.length_cm != null && product.length_cm !== '' &&
    product.width_cm != null && product.width_cm !== '' &&
    product.height_cm != null && product.height_cm !== '';

  const visibleProducts = (missingShippingOnly
    ? (products || []).filter((product: any) => !hasShippingData(product))
    : (products || [])
  ).filter((product: any) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [product.name, product.sku, product.slug, product.short_description, product.keywords, Array.isArray(product.tags) ? product.tags.join(' ') : product.tags, getCategoryName(product.category_id)]
      .some(field => String(field || '').toLowerCase().includes(q));
  });

  const csvEscape = (value: unknown) => {
    const text = value == null ? '' : Array.isArray(value) ? value.join('; ') : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csvColumns = ['name', 'slug', 'sku', 'short_description', 'description', 'tags', 'brand', 'category', 'price_zar', 'compare_at_price_zar', 'stock_quantity', 'allow_backorder', 'weight_kg', 'length_cm', 'width_cm', 'height_cm', 'meta_title', 'meta_description', 'images', 'primary_image_url', 'is_active'];

  const exportProductsCsv = () => {
    const lines = [csvColumns.join(',')];
    for (const product of products || []) {
      const categoryName = getCategoryName(product.category_id) || '';
      const row: Record<string, unknown> = {
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        short_description: product.short_description,
        description: product.description,
        tags: Array.isArray(product.tags) ? product.tags.join('; ') : '',
        brand: product.brand,
        category: categoryName,
        price_zar: product.price_zar,
        compare_at_price_zar: product.compare_at_price_zar,
        stock_quantity: product.stock_quantity,
        allow_backorder: product.allow_backorder ?? true,
        weight_kg: product.weight_kg,
        length_cm: product.length_cm,
        width_cm: product.width_cm,
        height_cm: product.height_cm,
        meta_title: product.meta_title,
        meta_description: product.meta_description,
        images: Array.isArray(product.images) ? product.images.join('; ') : '',
        primary_image_url: product.primary_image_url,
        is_active: product.is_active ?? true,
      };
      lines.push(csvColumns.map(column => csvEscape(row[column])).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${(products || []).length} products`);
  };

  const importProductsCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const rows: string[][] = [];
      let field = '';
      let record: string[] = [];
      let inQuotes = false;
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (inQuotes) {
          if (char === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
          } else { field += char; }
        } else if (char === '"') {
          inQuotes = true;
        } else if (char === ',') { record.push(field); field = ''; }
        else if (char === '\n') { record.push(field.replace(/\r$/, '')); field = ''; if (record.some(v => v !== '')) rows.push(record); record = []; }
        else field += char;
      }
      record.push(field.replace(/\r$/, ''));
      if (record.some(v => v !== '')) rows.push(record);
      const [header, ...dataRows] = rows;
      if (!header) throw new Error('The CSV file is empty');
      const index = (name: string) => header.findIndex(h => h.trim().toLowerCase() === name);
      const num = (value: string | undefined) => (value && value.trim() !== '' ? Number(value) : null);
      const bool = (value: string | undefined, fallback = true) => value == null || value.trim() === '' ? fallback : /^(true|yes|1)$/i.test(value.trim());
      const categoryList = categories || [];
      let created = 0;
      let updated = 0;
      for (const cells of dataRows) {
        const name = cells[index('name')]?.trim();
        if (!name) continue;
        const slug = (cells[index('slug')]?.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
        const sku = cells[index('sku')]?.trim() || `PHN-${Date.now().toString(36).toUpperCase()}`;
        const categoryName = cells[index('category')]?.trim();
        const category = categoryList.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
        const tags = cells[index('tags')]?.split(';').map(t => t.trim()).filter(Boolean) || [];
        const images = cells[index('images')]?.split(';').map(t => t.trim()).filter(Boolean) || [];
        const payload: Record<string, unknown> = {
          name,
          slug,
          sku,
          short_description: cells[index('short_description')] || null,
          description: cells[index('description')] || null,
          tags,
          brand: cells[index('brand')] || 'Purely Health Nutra',
          category_id: category?.id || null,
          price_zar: num(cells[index('price_zar')]) ?? 0,
          compare_at_price_zar: num(cells[index('compare_at_price_zar')]),
          stock_quantity: num(cells[index('stock_quantity')]) ?? 0,
          allow_backorder: bool(cells[index('allow_backorder')]),
          weight_kg: num(cells[index('weight_kg')]),
          length_cm: num(cells[index('length_cm')]),
          width_cm: num(cells[index('width_cm')]),
          height_cm: num(cells[index('height_cm')]),
          meta_title: cells[index('meta_title')] || null,
          meta_description: cells[index('meta_description')] || null,
          images,
          primary_image_url: cells[index('primary_image_url')] || images[0] || null,
          is_active: bool(cells[index('is_active')], false),
        };
        const existing = (products || []).find((p: any) => p.sku.toLowerCase() === sku.toLowerCase() || p.slug === slug);
        if (existing) {
          const { error } = await manus.from('products').update(payload).eq('id', existing.id);
          if (error) throw error;
          updated += 1;
        } else {
          const { error } = await manus.from('products').insert(payload);
          if (error) throw error;
          created += 1;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success(`Import complete: ${created} created, ${updated} updated`);
    } catch (error: any) {
      toast.error(error.message || 'CSV import failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4" /> Bulk product images</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload multiple images to the Manus folder <code className="text-xs">product-images/products/</code>.
              Name each file exactly after its SKU, for example <code className="text-xs">HF-FER-1025.jpg</code>. Manus strips metadata, adds the standard bottom-left PHN watermark, resizes oversized images without enlarging, and stores an optimized WebP fingerprint.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer hover:bg-primary/90">
            {isBulkImageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isBulkImageUploading ? 'Uploading...' : 'Choose images'}
            <input type="file" accept="image/*" multiple className="hidden" onChange={uploadBulkProductImages} disabled={isBulkImageUploading} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground mt-3">JPG, PNG, WEBP or other browser image formats; maximum 10MB per image. Manus removes embedded metadata, adds the standard PHN watermark and stores an optimized WebP. Matching images automatically become the product primary image.</p>
        {bulkImageSummary && (
          <div className="mt-3 text-sm">
            <p className="text-green-700">Uploaded: {bulkImageSummary.uploaded}</p>
            {bulkImageSummary.skipped.length > 0 && <p className="text-amber-700">Skipped: {bulkImageSummary.skipped.join(', ')}</p>}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Products</h1>
          <p className="text-muted-foreground">Manage your product catalog</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <label className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${missingShippingOnly ? 'border-amber-500 bg-amber-500/10 text-amber-700' : ''}`}>
            <input
              type="checkbox"
              checked={missingShippingOnly}
              onChange={(e) => setMissingShippingOnly(e.target.checked)}
              className="rounded"
            />
            <span>Missing shipping data</span>
          </label>
          <Button variant="outline" onClick={exportProductsCsv}>
            Export CSV
          </Button>
          <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium cursor-pointer hover:bg-muted">
            Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={(e) => { void importProductsCsv(e); }} />
          </label>
          {selectedProducts.size > 0 && (
            <>
              <Button variant="outline" onClick={() => setIsBulkEditOpen(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Bulk Edit ({selectedProducts.size})
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsBulkPriceOpen(true)}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Bulk Price ({selectedProducts.size})
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsBulkStockOpen(true)}
              >
                <Package className="h-4 w-4 mr-2" />
                Bulk Stock ({selectedProducts.size})
              </Button>
              <Button variant="outline" className="text-green-600" onClick={() => bulkStatusMutation.mutate(true)}>
                Activate ({selectedProducts.size})
              </Button>
              <Button variant="outline" className="text-amber-600" onClick={() => bulkStatusMutation.mutate(false)}>
                Deactivate ({selectedProducts.size})
              </Button>
            </>
          )}
          <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) {
              setEditingId(null);
              setForm(emptyForm);
            }
          }}>
            <DialogTrigger asChild>
              <Button className="btn-sunset">
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Product' : 'Add Product'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* General section */}
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <h3 className="font-semibold text-sm">General</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                    <p className="text-xs text-muted-foreground">The product name customers see. Required.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sku">SKU *</Label>
                    <Input
                      id="sku"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                      placeholder="e.g. HF-FER-1025"
                      required
                    />
                    <p className="text-xs text-muted-foreground">Unique stock code. Suggested: {suggestedSku || '(enter your own)'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="slug">URL Slug</Label>
                    <Input
                      id="slug"
                      value={form.slug}
                      onChange={(e) => setForm({ ...form, slug: e.target.value })}
                      placeholder="auto-generated-from-name"
                    />
                    <p className="text-xs text-muted-foreground">Web address ending, lowercase with hyphens, must be unique. Changing it later keeps a redirect from the old address.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category_id">Category</Label>
                    <Select
                      value={form.category_id || 'none'}
                      onValueChange={(value) => setForm({ ...form, category_id: value === 'none' ? null : value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Category</SelectItem>
                        {categories?.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Used for shop filters and menus.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="brand">Brand</Label>
                    <Input
                      id="brand"
                      value={form.brand}
                      onChange={(e) => setForm({ ...form, brand: e.target.value })}
                      placeholder="Purely Health Nutra"
                    />
                    <p className="text-xs text-muted-foreground">Shown on the product page and in search results.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tags">Keywords / Tags</Label>
                    <Input
                      id="tags"
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder="probiotic, gut health, kefir"
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated keywords. Customers can find the product by searching these.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="short_description">Short Description</Label>
                  <Input
                    id="short_description"
                    value={form.short_description}
                    onChange={(e) => setForm({ ...form, short_description: e.target.value })}
                    maxLength={160}
                  />
                  <p className="text-xs text-muted-foreground">
                    A one-line summary used in listings and search results. {form.short_description.length}/160 characters.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="description">Long Description</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={generateDescription}
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-1" />
                      )}
                      Generate with AI
                    </Button>
                  </div>
                  <Textarea
                    id="description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={5}
                  />
                  <p className="text-xs text-muted-foreground">The full product story shown on the product page. Supports blank lines between paragraphs.</p>
                </div>
              </div>

              {/* Pricing section */}
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <h3 className="font-semibold text-sm">Pricing</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="price_zar">Price (ZAR) *</Label>
                    <Input
                      id="price_zar"
                      type="number"
                      step="0.01"
                      value={form.price_zar}
                      onChange={(e) => setForm({ ...form, price_zar: e.target.value })}
                      required
                    />
                    <p className="text-xs text-muted-foreground">Normal selling price in Rand. Required.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="compare_at_price_zar">Sale Price (optional)</Label>
                    <Input
                      id="compare_at_price_zar"
                      type="number"
                      step="0.01"
                      value={form.compare_at_price_zar}
                      onChange={(e) => setForm({ ...form, compare_at_price_zar: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Shown as the crossed-out "was" price. Leave empty if not on sale.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stock_quantity">Stock Quantity</Label>
                    <Input
                      id="stock_quantity"
                      type="number"
                      value={form.stock_quantity}
                      onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">How many units you have. 0 shows as out of stock.</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.allow_backorder}
                    onChange={(e) => setForm({ ...form, allow_backorder: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">Allow backorders when stock is 0</span>
                </label>
              </div>

              {/* Shipping section */}
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <h3 className="font-semibold text-sm">Shipping</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="weight_kg">Weight (kg) *</Label>
                    <Input
                      id="weight_kg"
                      type="number"
                      step="0.01"
                      value={form.weight_kg}
                      onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Packed weight in kilograms. Required to publish; used for courier rates.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="length_cm">Length (cm) *</Label>
                      <Input
                        id="length_cm"
                        type="number"
                        step="0.1"
                        value={form.length_cm}
                        onChange={(e) => setForm({ ...form, length_cm: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="width_cm">Width (cm) *</Label>
                      <Input
                        id="width_cm"
                        type="number"
                        step="0.1"
                        value={form.width_cm}
                        onChange={(e) => setForm({ ...form, width_cm: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="height_cm">Height (cm) *</Label>
                      <Input
                        id="height_cm"
                        type="number"
                        step="0.1"
                        value={form.height_cm}
                        onChange={(e) => setForm({ ...form, height_cm: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="packaging_weight_kg">Packaging (kg)</Label>
                    <Input id="packaging_weight_kg" type="number" step="0.01" value={form.packaging_weight_kg} onChange={(e) => setForm({ ...form, packaging_weight_kg: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="packed_length_cm">Packed L (cm)</Label>
                    <Input id="packed_length_cm" type="number" step="0.1" value={form.packed_length_cm} onChange={(e) => setForm({ ...form, packed_length_cm: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="packed_width_cm">Packed W (cm)</Label>
                    <Input id="packed_width_cm" type="number" step="0.1" value={form.packed_width_cm} onChange={(e) => setForm({ ...form, packed_width_cm: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="packed_height_cm">Packed H (cm)</Label>
                    <Input id="packed_height_cm" type="number" step="0.1" value={form.packed_height_cm} onChange={(e) => setForm({ ...form, packed_height_cm: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="parcel_count">Parcels</Label>
                    <Input id="parcel_count" type="number" min="1" step="1" value={form.parcel_count} onChange={(e) => setForm({ ...form, parcel_count: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Optional: final packed parcel size and packaging weight for shipping quotes. Left empty, the store's standard packaging and this product's own dimensions are used. Parcels = number of boxes this product ships in.</p>
                <p className="text-xs text-muted-foreground">Packed box size in centimetres. Required to publish; used for PUDO and Courier Guy rates.</p>
              </div>

              {/* Extended product management: Product Info, Search & Tags, SEO, GEO, Inventory */}
              <ProductExtendedFields
                ext={form.ext}
                onChange={(ext) => setForm({ ...form, ext })}
                productContext={{
                  name: form.name,
                  short_description: form.short_description,
                  description: form.description,
                  price_zar: form.price_zar,
                  category_id: form.category_id,
                }}
              />
              {/* SEO section */}
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <h3 className="font-semibold text-sm">SEO</h3>
                <div className="space-y-2">
                  <Label htmlFor="meta_title">Meta Title</Label>
                  <Input
                    id="meta_title"
                    value={form.meta_title}
                    onChange={(e) => setForm({ ...form, meta_title: e.target.value })}
                    placeholder="Auto-filled from the product name"
                  />
                  <p className="text-xs text-muted-foreground">Browser tab / Google result title. Leave empty to use the product name.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="meta_description">Meta Description</Label>
                  <Textarea
                    id="meta_description"
                    value={form.meta_description}
                    onChange={(e) => setForm({ ...form, meta_description: e.target.value })}
                    rows={2}
                    maxLength={160}
                  />
                  <p className="text-xs text-muted-foreground">
                    Google result summary. Leave empty to use the short description. {form.meta_description.length}/160 characters.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Product Images</Label>
                <p className="text-xs text-muted-foreground">Upload multiple images. The first one is the main image shown everywhere; each image has its own alt-text field for accessibility and SEO.</p>
                <MultiImageUpload
                  value={form.images}
                  onChange={(urls) => {
                    setForm({ 
                      ...form, 
                      images: urls,
                      primary_image_url: urls[0] || '' 
                    });
                  }}
                  maxImages={10}
                />
              </div>

              {/* Promotion Scheduling */}
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <span>📅</span> Promotion Schedule
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Promo Price (ZAR)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.promo_price_zar}
                      onChange={(e) => setForm({ ...form, promo_price_zar: e.target.value })}
                      placeholder="Special price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Promo Starts</Label>
                    <Input
                      type="datetime-local"
                      value={form.promo_starts_at}
                      onChange={(e) => setForm({ ...form, promo_starts_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Promo Ends</Label>
                    <Input
                      type="datetime-local"
                      value={form.promo_ends_at}
                      onChange={(e) => setForm({ ...form, promo_ends_at: e.target.value })}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.hide_after_promo}
                    onChange={(e) => setForm({ ...form, hide_after_promo: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">Hide product (mark unavailable) after promo ends</span>
                </label>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded"
                  />
                  <span>Active</span>
                  <span className="text-xs text-muted-foreground">(publish to the shop)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_featured}
                    onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
                    className="rounded"
                  />
                  <span>Featured</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="btn-sunset" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Bulk Price Dialog */}
      {/* Bulk Edit Dialog: applies only the fields you fill in */}
      <Dialog open={isBulkEditOpen} onOpenChange={setIsBulkEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Edit ({selectedProducts.size} products)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Only fields you fill in are applied to every selected product. Leave a field blank to leave it unchanged.
          </p>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Category</Label>
              <Select value={bulkEdit.category_id} onValueChange={(v) => setBulkEdit(prev => ({ ...prev, category_id: v }))}>
                <SelectTrigger><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent>
                  {categories?.map((category) => (
                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Brand</Label>
              <Input value={bulkEdit.brand} onChange={(e) => setBulkEdit(prev => ({ ...prev, brand: e.target.value }))} placeholder="No change" />
            </div>
            <div className="space-y-1.5">
              <Label>Weight (kg)</Label>
              <Input type="number" step="0.01" value={bulkEdit.weight_kg} onChange={(e) => setBulkEdit(prev => ({ ...prev, weight_kg: e.target.value }))} placeholder="No change" />
            </div>
            <div className="space-y-1.5">
              <Label>Length (cm)</Label>
              <Input type="number" step="0.1" value={bulkEdit.length_cm} onChange={(e) => setBulkEdit(prev => ({ ...prev, length_cm: e.target.value }))} placeholder="No change" />
            </div>
            <div className="space-y-1.5">
              <Label>Width (cm)</Label>
              <Input type="number" step="0.1" value={bulkEdit.width_cm} onChange={(e) => setBulkEdit(prev => ({ ...prev, width_cm: e.target.value }))} placeholder="No change" />
            </div>
            <div className="space-y-1.5">
              <Label>Height (cm)</Label>
              <Input type="number" step="0.1" value={bulkEdit.height_cm} onChange={(e) => setBulkEdit(prev => ({ ...prev, height_cm: e.target.value }))} placeholder="No change" />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bulkEdit.regenerateSku}
                onChange={(e) => setBulkEdit(prev => ({ ...prev, regenerateSku: e.target.checked }))}
                className="rounded"
              />
              Regenerate SKUs (PHN-0001…) for selected products
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkEditOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkEditMutation.mutate()} disabled={bulkEditMutation.isPending}>
              {bulkEditMutation.isPending ? 'Updating…' : 'Apply to selected'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isBulkPriceOpen} onOpenChange={setIsBulkPriceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Price Update ({selectedProducts.size} products)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={bulkPriceAction} onValueChange={(v: 'set' | 'increase' | 'decrease') => setBulkPriceAction(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">Set price to</SelectItem>
                  <SelectItem value="increase">Increase by</SelectItem>
                  <SelectItem value="decrease">Decrease by</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  step="0.01"
                  value={bulkPriceValue}
                  onChange={(e) => setBulkPriceValue(e.target.value)}
                  placeholder={bulkPriceAction === 'set' ? 'New price (R)' : 'Amount'}
                />
                {bulkPriceAction !== 'set' && (
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    <Checkbox checked={bulkPricePercent} onCheckedChange={(c) => setBulkPricePercent(!!c)} />
                    <span>%</span>
                  </label>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkPriceOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkPriceMutation.mutate()} disabled={bulkPriceMutation.isPending}>
              {bulkPriceMutation.isPending ? 'Updating...' : 'Update Prices'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Stock Dialog */}
      <Dialog open={isBulkStockOpen} onOpenChange={setIsBulkStockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Stock Update ({selectedProducts.size} products)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={bulkStockAction} onValueChange={(v: 'set' | 'add' | 'subtract') => setBulkStockAction(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">Set stock to</SelectItem>
                  <SelectItem value="add">Add to stock</SelectItem>
                  <SelectItem value="subtract">Subtract from stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                value={bulkStockValue}
                onChange={(e) => setBulkStockValue(e.target.value)}
                placeholder="Enter quantity"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkStockOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkStockMutation.mutate()} disabled={bulkStockMutation.isPending}>
              {bulkStockMutation.isPending ? 'Updating...' : 'Update Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl overflow-hidden"
      >
        <div className="p-4 border-b">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by name, SKU, tag or category…"
              className="pl-9"
            />
          </div>
          {searchQuery.trim() && (
            <p className="text-xs text-muted-foreground mt-2">
              {visibleProducts.length} of {(products || []).length} products match
            </p>
          )}
        </div>
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={products?.length ? selectedProducts.size === products.length : false}
                    onCheckedChange={toggleAllProducts}
                  />
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProducts.map((product: any) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedProducts.has(product.id)}
                      onCheckedChange={() => toggleProductSelection(product.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {product.primary_image_url && (
                        <img
                          src={product.primary_image_url}
                          alt={product.name}
                          className="h-10 w-10 rounded object-cover"
                        />
                      )}
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <div className="flex gap-2 flex-wrap">
                          {product.is_featured && (
                            <span className="text-xs text-primary">Featured</span>
                          )}
                          {!hasShippingData(product) && (
                            <span className="text-xs text-amber-700 bg-amber-500/10 border border-amber-500/40 rounded-full px-2 py-0.5">
                              Missing shipping data
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                  <TableCell>
                    {getCategoryName(product.category_id) || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatCurrency(product.price_zar)}</TableCell>
                  <TableCell>
                    <span className={product.stock_quantity < 5 ? 'text-red-500 font-medium' : ''}>
                      {product.stock_quantity}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      title={product.is_active ? 'Visible in the shop — click to deactivate' : 'Hidden from the shop — click to activate'}
                      onClick={() => toggleActiveMutation.mutate({ id: product.id, is_active: !product.is_active })}
                      className={`px-2 py-1 rounded-full text-xs cursor-pointer ${
                        product.is_active
                          ? 'bg-green-500/20 text-green-500'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {product.is_active ? 'Active' : 'Draft'}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Publish to social media"
                        onClick={() => { setSocialProduct(product); setIsSocialOpen(true); }}
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(product)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm('Delete this product?')) {
                            deleteMutation.mutate(product.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </motion.div>
      <SocialPublishDialog open={isSocialOpen} onOpenChange={setIsSocialOpen} product={socialProduct} />
    </div>
  );
}
