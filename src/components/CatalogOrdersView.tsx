import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShoppingBag,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { BotOrderRecord, OrderStatus, ProductRecord } from '../types/bot.ts';
import { formatJalaliDateTime, formatPriceToman, toPersianDigits } from '../utils/jalali.ts';

interface CatalogOrdersViewProps {
  token: string | null;
  botId: string | null;
  products: ProductRecord[];
  orders: BotOrderRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onPreviewProductsChange?: (next: ProductRecord[]) => void;
}

const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; textColor: string; icon: React.ReactNode }
> = {
  pending: {
    label: 'در انتظار تایید',
    textColor: 'text-amber-700',
    icon: <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
  },
  confirmed: {
    label: 'تایید و پردازش',
    textColor: 'text-emerald-700',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />,
  },
  cancelled: {
    label: 'لغوشده',
    textColor: 'text-red-700',
    icon: <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />,
  },
};

export function CatalogOrdersView({
  token,
  botId,
  products,
  orders,
  loading,
  onRefresh,
  onPreviewProductsChange,
}: CatalogOrdersViewProps) {
  const [subTab, setSubTab] = useState<'products' | 'orders'>('products');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all');

  // Product Form Drawer State
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('10');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category?.trim()) set.add(p.category.trim());
    }
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'all' && (p.category || '').trim() !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    });
  }, [products, query, categoryFilter]);

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_phone || '').toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.items.some((i) => i.title.toLowerCase().includes(q))
      );
    });
  }, [orders, query, orderStatusFilter]);

  function openNewProductForm() {
    setEditingProductId(null);
    setTitle('');
    setCategory('');
    setPrice('');
    setStock('10');
    setImageUrl('');
    setDescription('');
    setIsActive(true);
    setError(null);
    setFormOpen(true);
  }

  function openEditProductForm(product: ProductRecord) {
    setEditingProductId(product.id);
    setTitle(product.title);
    setCategory(product.category || '');
    setPrice(String(product.price || 0));
    setStock(String(product.stock ?? 0));
    setImageUrl(product.image_url || '');
    setDescription(product.description || '');
    setIsActive(product.is_active !== false);
    setError(null);
    setFormOpen(true);
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('عنوان محصول یا خدمت الزامی است.');
      return;
    }

    const numericPrice = Math.max(0, Math.round(Number(price) || 0));
    const numericStock = Math.max(0, Math.round(Number(stock) || 0));

    if (!token || !botId) {
      if (onPreviewProductsChange) {
        if (editingProductId) {
          onPreviewProductsChange(
            products.map((p) =>
              p.id === editingProductId
                ? {
                    ...p,
                    title: title.trim(),
                    category: category.trim() || null,
                    price: numericPrice,
                    stock: numericStock,
                    image_url: imageUrl.trim() || null,
                    description: description.trim() || null,
                    is_active: isActive,
                  }
                : p
            )
          );
        } else {
          const previewItem: ProductRecord = {
            id: `prod_${Date.now().toString(36)}`,
            bot_id: 'simulator-bot',
            title: title.trim(),
            category: category.trim() || null,
            price: numericPrice,
            stock: numericStock,
            image_url: imageUrl.trim() || null,
            description: description.trim() || null,
            is_active: isActive,
            date_created: new Date().toISOString(),
          };
          onPreviewProductsChange([previewItem, ...products]);
        }
        setFormOpen(false);
      }
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingProductId) {
        await api.updateProduct(token, botId, editingProductId, {
          title: title.trim(),
          category: category.trim() || null,
          price: numericPrice,
          stock: numericStock,
          image_url: imageUrl.trim() || null,
          description: description.trim() || null,
          is_active: isActive,
        });
      } else {
        await api.createProduct(token, botId, {
          title: title.trim(),
          category: category.trim() || null,
          price: numericPrice,
          stock: numericStock,
          image_url: imageUrl.trim() || null,
          description: description.trim() || null,
          is_active: isActive,
        });
      }
      setFormOpen(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره محصول ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!token || !botId) {
      if (onPreviewProductsChange) {
        onPreviewProductsChange(products.filter((p) => p.id !== productId));
      }
      return;
    }
    setBusyId(productId);
    setError(null);
    try {
      await api.deleteProduct(token, botId, productId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف محصول ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleChangeOrderStatus(orderId: string, status: OrderStatus) {
    if (!token || !botId) return;
    setBusyId(orderId);
    setError(null);
    try {
      await api.updateOrder(token, botId, orderId, { status });
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تغییر وضعیت سفارش ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteOrder(orderId: string) {
    if (!token || !botId) return;
    setBusyId(orderId);
    setError(null);
    try {
      await api.deleteOrder(token, botId, orderId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف سفارش ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  }

  function exportOrdersCsv() {
    const headers = [
      'کد سفارش',
      'نام مشتری',
      'شماره تماس',
      'اقلام سفارش',
      'جمع کل (تومان)',
      'وضعیت',
      'تاریخ ثبت',
    ];
    const rows = filteredOrders.map((o) => [
      o.id.slice(0, 8),
      o.customer_name || o.bale_user_id || '—',
      o.customer_phone || '—',
      o.items.map((i) => `${i.title} (${i.quantity})`).join(' | '),
      String(o.total_amount || 0),
      ORDER_STATUS_META[o.status]?.label || o.status,
      formatJalaliDateTime(o.date_created),
    ]);

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bale-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalRevenue = useMemo(
    () =>
      orders
        .filter((o) => o.status !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0),
    [orders]
  );

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">کاتالوگ محصولات و سفارش‌ها</h2>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              {toPersianDigits(products.length)} محصول در <code className="font-mono">products</code> ·{' '}
              {toPersianDigits(orders.length)} سفارش در <code className="font-mono">bot_orders</code> ·{' '}
              فروش تایید/درانتظار: {formatPriceToman(totalRevenue)}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSubTab('products')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === 'products'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Package className="w-3.5 h-3.5 text-emerald-700" />
                <span>محصولات و خدمات ({toPersianDigits(products.length)})</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('orders')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  subTab === 'orders'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5 text-emerald-700" />
                <span>سفارش‌ها ({toPersianDigits(orders.length)})</span>
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  subTab === 'products' ? 'جستجوی محصول یا دسته...' : 'جستجوی مشتری یا کد سفارش...'
                }
                className="pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 w-56"
              />
            </div>

            {subTab === 'products' ? (
              <button
                type="button"
                onClick={openNewProductForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>افزودن محصول</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={exportOrdersCsv}
                disabled={filteredOrders.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>خروجی اکسل سفارش‌ها</span>
              </button>
            )}

            {token && (
              <button
                type="button"
                onClick={() => onRefresh()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>بروزرسانی</span>
              </button>
            )}
          </div>
        </div>

        {subTab === 'products' && categories.length > 0 && (
          <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100 flex-wrap">
            <span className="text-xs text-slate-500 ml-2">فیلتر دسته:</span>
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                categoryFilter === 'all'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              همه
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {subTab === 'orders' && (
          <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100 flex-wrap">
            <span className="text-xs text-slate-500 ml-2">فیلتر وضعیت:</span>
            {(
              [
                { id: 'all', label: 'همه سفارش‌ها' },
                { id: 'pending', label: 'در انتظار تایید' },
                { id: 'confirmed', label: 'تایید و پردازش' },
                { id: 'cancelled', label: 'لغوشده' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setOrderStatusFilter(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  orderStatusFilter === item.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900">
          {error}
        </div>
      )}

      {/* Create / Edit Product Form */}
      {formOpen && subTab === 'products' && (
        <form
          onSubmit={handleSaveProduct}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              {editingProductId ? 'ویرایش محصول / خدمت' : 'ثبت محصول یا خدمت جدید'}
            </h3>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                عنوان محصول / خدمت
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثلاً پکیج مشاوره اختصاصی"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">دسته‌بندی</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="مثلاً اشتراک‌ها، پوشاک..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                قیمت (تومان)
              </label>
              <input
                type="number"
                min={0}
                required
                dir="ltr"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="450000"
                className="w-full px-3 py-2 text-xs text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">موجودی</label>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2 text-xs text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                لینک مستقیم تصویر (اختیاری - برای نمایش در `sendPhoto` بله)
              </label>
              <input
                type="url"
                dir="ltr"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/product.jpg"
                className="w-full px-3 py-2 text-xs text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                توضیحات کوتاه محصول
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="توضیحات نمایشی زیر عکس محصول در بله..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>محصول فعال و قابل سفارش در ربات بله باشد</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'در حال ذخیره...' : 'ذخیره محصول'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Content Grid / Table */}
      {subTab === 'products' ? (
        loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900">هنوز محصولی ثبت نشده است</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
              محصولات و خدمات خود را اینجا ثبت کنید تا گره «مرورگر کاتالوگ» در ربات بله و شبیه‌ساز، آن‌ها را همراه با قیمت، عکس و سبد خرید به کاربران نمایش دهد.
            </p>
            <button
              type="button"
              onClick={openNewProductForm}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ثبت اولین محصول</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProducts.map((product) => (
              <article
                key={product.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <div className="h-40 bg-slate-100 border-b border-slate-100 relative flex items-center justify-center overflow-hidden">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-slate-400">
                        <ShoppingBag className="w-7 h-7" />
                        <span className="text-[11px]">بدون تصویر</span>
                      </div>
                    )}
                  </div>

                  <div className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{product.category || 'عمومی'}</span>
                      <span>·</span>
                      <span className={product.is_active ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                        {product.is_active ? 'فعال' : 'غیرفعال'}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900 truncate">{product.title}</h3>

                    {product.description && (
                      <p className="text-xs text-slate-600 line-clamp-2 leading-5">
                        {product.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
                  <div className="tabular-nums">
                    <div className="text-xs font-bold text-slate-900">
                      {formatPriceToman(product.price)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      موجودی: {toPersianDigits(product.stock)} عدد
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditProductForm(product)}
                      className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-white rounded-lg cursor-pointer"
                      title="ویرایش محصول"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === product.id}
                      onClick={() => handleDeleteProduct(product.id)}
                      className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-white rounded-lg cursor-pointer disabled:opacity-40"
                      title="حذف محصول"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900">هنوز سفارشی ثبت نشده است</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
                هنگامی که مشتریان در پیام‌رسان بله از طریق مرورگر کاتالوگ سبد خرید خود را نهایی کنند، جزئیات سفارش اینجا ثبت می‌شود.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4 whitespace-nowrap">مشتری</th>
                    <th className="py-3 px-4 whitespace-nowrap">اقلام سفارش</th>
                    <th className="py-3 px-4 whitespace-nowrap">مبلغ کل</th>
                    <th className="py-3 px-4 whitespace-nowrap">وضعیت سفارش</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاریخ ثبت</th>
                    <th className="py-3 px-4 whitespace-nowrap">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredOrders.map((order) => {
                    const statusMeta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.pending;
                    return (
                      <tr key={order.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {order.customer_name || `کاربر ${order.bale_user_id || ''}`}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {order.customer_phone || order.bale_user_id || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 max-w-xs">
                          <div className="truncate">
                            {order.items
                              .map((i) => `${i.title} × ${toPersianDigits(i.quantity)}`)
                              .join('، ')}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatPriceToman(order.total_amount)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {statusMeta.icon}
                            <select
                              disabled={!token || busyId === order.id}
                              value={order.status}
                              onChange={(e) =>
                                handleChangeOrderStatus(order.id, e.target.value as OrderStatus)
                              }
                              className={`px-2 py-1 text-xs font-medium bg-white border border-slate-200 rounded-md focus:outline-none focus:border-emerald-600 ${statusMeta.textColor}`}
                            >
                              <option value="pending">در انتظار تایید</option>
                              <option value="confirmed">تایید و پردازش</option>
                              <option value="cancelled">لغوشده</option>
                            </select>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                          {formatJalaliDateTime(order.date_created)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            disabled={!token || busyId === order.id}
                            onClick={() => handleDeleteOrder(order.id)}
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg cursor-pointer disabled:opacity-40"
                            title="حذف سفارش"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
