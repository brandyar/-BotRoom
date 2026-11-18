import React from 'react';
import { Check, Layers, X } from 'lucide-react';
import { FLOW_TEMPLATES, type FlowTemplateItem } from '../data/flowTemplates.ts';
import { toPersianDigits } from '../utils/jalali.ts';

interface TemplateGalleryModalProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: FlowTemplateItem) => void;
}

export function TemplateGalleryModal({
  open,
  onClose,
  onSelectTemplate,
}: TemplateGalleryModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">گالری قالب‌های آماده بله‌ساز</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              یک سناریوی آماده را انتخاب کنید تا گره‌ها و اتصالات به‌صورت کامل در بوم بارگذاری شوند.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {FLOW_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 hover:border-emerald-600/60 transition-colors"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-emerald-800">{tpl.category}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {toPersianDigits(tpl.flow.nodes.length)} گره
                  </span>
                </div>

                <h4 className="text-sm font-bold text-slate-900">{tpl.title}</h4>
                <p className="text-xs text-slate-600 leading-6">{tpl.description}</p>

                <div className="pt-2 border-t border-slate-100 space-y-1">
                  {tpl.highlights.map((item) => (
                    <div key={item} className="flex items-center gap-1.5 text-xs text-slate-700">
                      <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onSelectTemplate(tpl);
                  onClose();
                }}
                className="w-full py-2 px-4 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>اعمال این قالب در جریان</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
