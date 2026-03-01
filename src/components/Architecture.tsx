import React from 'react';
import { Server, Database, Smartphone, ShieldCheck, Mail, BrainCircuit, FileSearch } from 'lucide-react';

export default function Architecture() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">ארכיטקטורת המערכת</h1>
        <div className="text-sm text-slate-500 bg-white px-3 py-1 rounded-full shadow-sm border border-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          100% פרטיות
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Frontend & Mobile */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:border-blue-200 transition-colors">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4">
            <Smartphone className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Frontend & PWA</h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-4">
            אפליקציית React (Vite) + Tailwind CSS. מותאמת למובייל (Mobile-First) עם תמיכה מלאה ב-RTL (עברית). כוללת Service Workers להתקנה על מסך הבית (PWA) ותמיכה בזיהוי ביומטרי (WebAuthn).
          </p>
        </div>

        {/* Backend & Cloud */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:border-emerald-200 transition-colors">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Private Cloud & Auth</h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-4">
            התחברות מאובטחת דרך Google Auth. כל הנתונים (Firestore) והקבצים (Storage) נשמרים בסביבת הענן הפרטית של המשתמש (Google Drive / Firebase) להבטחת בעלות מלאה על המידע.
          </p>
        </div>

        {/* Ingestion Engine */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:border-amber-200 transition-colors">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center mb-4">
            <Mail className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Automated Ingestion</h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-4">
            מנוע סריקה אוטומטי (Gmail API) המאתר חשבוניות והתראות בנק. הקבצים מרוכזים בתיקייה חודשית מרכזית (למשל: Finance_2026_03).
          </p>
        </div>

        {/* Omni-Parser */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:border-purple-200 transition-colors">
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center mb-4">
            <FileSearch className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Omni-Parser</h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-4">
            מערכת חילוץ נתונים חכמה המשתמשת ב-Tesseract.js לזיהוי טקסט מתמונות (OCR), ובספריות PDF.js/XLSX לקריאת מסמכים דיגיטליים וגיליונות אלקטרוניים.
          </p>
        </div>

        {/* AI Brain */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-colors md:col-span-2 lg:col-span-2">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mb-4">
            <BrainCircuit className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Smart AI Logic (Brain)</h3>
          <p className="text-slate-600 text-sm leading-relaxed mb-4">
            מנוע בינה מלאכותית המבצע השוואה בזמן אמת בין התקציב להוצאות בפועל. המערכת מקטלגת אוטומטית הוצאות לקבועות ומשתנות, ומייצרת תובנות חכמות בעברית (למשל: "טיפ: מעבר לחברת ביטוח אחרת יכול לחסוך לך 100 ש״ח בחודש").
          </p>
        </div>
      </div>
    </div>
  );
}
