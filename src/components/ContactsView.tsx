import React, { useMemo, useState } from 'react';
import {
  Download,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { BotContactRecord } from '../types/bot.ts';
import { formatJalaliDateTime, toPersianDigits } from '../utils/jalali.ts';

interface ContactsViewProps {
  token: string | null;
  botId: string | null;
  contacts: BotContactRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function ContactsView({
  token,
  botId,
  contacts,
  loading,
  onRefresh,
}: ContactsViewProps) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) {
      for (const t of c.tags || []) {
        if (t.trim()) set.add(t.trim());
      }
    }
    return Array.from(set);
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (activeTag !== 'all' && !(c.tags || []).includes(activeTag)) {
        return false;
      }
      if (!q) return true;
      const fullName = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
      return (
        fullName.includes(q) ||
        (c.bale_username || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        c.bale_user_id.toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [contacts, query, activeTag]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) || null,
    [contacts, selectedContactId]
  );

  function openContactEditor(contact: BotContactRecord) {
    setSelectedContactId(contact.id);
    setEditFirstName(contact.first_name || '');
    setEditLastName(contact.last_name || '');
    setEditPhone(contact.phone || '');
    setEditTags([...(contact.tags || [])]);
    setNewTagInput('');
    setError(null);
  }

  function addTagToDraft() {
    const cleaned = newTagInput.trim();
    if (!cleaned) return;
    if (!editTags.includes(cleaned)) {
      setEditTags((prev) => [...prev, cleaned]);
    }
    setNewTagInput('');
  }

  function removeTagFromDraft(tag: string) {
    setEditTags((prev) => prev.filter((t) => t !== tag));
  }

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !botId || !selectedContact) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateContact(token, botId, selectedContact.id, {
        first_name: editFirstName.trim() || null,
        last_name: editLastName.trim() || null,
        phone: editPhone.trim() || null,
        tags: editTags,
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ذخیره اطلاعات مشتری ناموفق بود.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contactId: string) {
    if (!token || !botId) return;
    setDeletingId(contactId);
    setError(null);
    try {
      await api.deleteContact(token, botId, contactId);
      if (selectedContactId === contactId) {
        setSelectedContactId(null);
      }
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حذف مخاطب ناموفق بود.');
    } finally {
      setDeletingId(null);
    }
  }

  function exportCsv() {
    const headers = [
      'شناسه کاربر بله',
      'نام',
      'نام خانوادگی',
      'نام کاربری',
      'شماره تماس',
      'برچسب‌ها',
      'وضعیت',
      'آخرین تعامل',
    ];
    const rows = filteredContacts.map((c) => [
      c.bale_user_id,
      c.first_name || '',
      c.last_name || '',
      c.bale_username || '',
      c.phone || '',
      (c.tags || []).join(' | '),
      c.is_blocked ? 'مسدودشده' : 'فعال',
      formatJalaliDateTime(c.last_interaction_at || c.date_created),
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
    link.download = `bale-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">مدیریت مشتریان و مخاطبین بله</h2>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              تعداد کل مخاطبین ثبت‌شده در <code className="font-mono">bot_contacts</code>:{' '}
              {toPersianDigits(filteredContacts.length)}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجو نام، موبایل، برچسب..."
                className="pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600 w-60"
              />
            </div>

            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredContacts.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>خروجی اکسل (CSV)</span>
            </button>

            {token && (
              <button
                type="button"
                onClick={() => onRefresh()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>بروزرسانی</span>
              </button>
            )}
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100 flex-wrap">
            <span className="text-xs text-slate-500 ml-2">فیلتر برچسب:</span>
            <button
              type="button"
              onClick={() => setActiveTag('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeTag === 'all'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              همه
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  activeTag === tag
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tag}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Contacts Table */}
        <div
          className={`${
            selectedContact ? 'lg:col-span-8' : 'lg:col-span-12'
          } bg-white border border-slate-200 rounded-xl overflow-hidden`}
        >
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900">مخاطبی یافت نشد</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-6">
                به‌محض اینکه کاربری با بازوی بله شما گفتگو کند یا فرمی را ثبت نماید، پروفایل او به‌صورت خودکار در لیست مشتریان ایجاد و به‌روزرسانی می‌شود.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4 whitespace-nowrap">نام مشتری</th>
                    <th className="py-3 px-4 whitespace-nowrap">شماره تماس</th>
                    <th className="py-3 px-4 whitespace-nowrap">برچسب‌ها</th>
                    <th className="py-3 px-4 whitespace-nowrap">آخرین تعامل</th>
                    <th className="py-3 px-4 whitespace-nowrap">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredContacts.map((c) => {
                    const displayName =
                      [c.first_name, c.last_name].filter(Boolean).join(' ') ||
                      c.bale_username ||
                      c.bale_user_id;
                    const isSelected = selectedContact?.id === c.id;

                    return (
                      <tr
                        key={c.id}
                        onClick={() => openContactEditor(c)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-emerald-50/40' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{displayName}</div>
                          <div className="text-[11px] text-slate-500 font-mono" dir="ltr">
                            <span className="text-right block">
                              {c.bale_username || `ID: ${c.bale_user_id}`}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {c.phone || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                          {c.tags && c.tags.length > 0 ? c.tags.join(' · ') : '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                          {formatJalaliDateTime(c.last_interaction_at || c.date_created)}
                        </td>
                        <td
                          className="py-3 px-4 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={deletingId === c.id || !token}
                            onClick={() => handleDelete(c.id)}
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg cursor-pointer disabled:opacity-40"
                            title="حذف مخاطب"
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

        {/* Selected Contact Inspector */}
        {selectedContact && (
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4 sticky top-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">پرونده مشتری</h3>
                <p className="text-[11px] font-mono text-slate-400" dir="ltr">
                  bale_user_id: {selectedContact.bale_user_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedContactId(null)}
                className="p-1 text-slate-400 hover:text-slate-800 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContact} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">نام</label>
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    نام خانوادگی
                  </label>
                  <input
                    type="text"
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">شماره تماس</label>
                <input
                  type="text"
                  dir="ltr"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="09123456789"
                  className="w-full px-3 py-2 text-xs text-left font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-medium text-slate-700">برچسب‌ها (Tags)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTagToDraft();
                      }
                    }}
                    placeholder="مثلاً VIP یا خریدار..."
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={addTagToDraft}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>افزودن</span>
                  </button>
                </div>

                {editTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {editTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => removeTagFromDraft(tag)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 rounded-md transition-colors cursor-pointer"
                        title="کلیک برای حذف برچسب"
                      >
                        <span>{tag}</span>
                        <X className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedContact.custom_fields &&
                Object.keys(selectedContact.custom_fields).length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <p className="text-xs font-medium text-slate-700">اطلاعات جمع‌آوری‌شده (CRM)</p>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 text-xs">
                      {Object.entries(selectedContact.custom_fields).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-500">{k}</span>
                          <span className="text-slate-900 font-medium truncate">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <button
                type="submit"
                disabled={saving || !token}
                className="w-full py-2 px-4 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'در حال ذخیره...' : 'ذخیره تغییرات پروفایل'}</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
