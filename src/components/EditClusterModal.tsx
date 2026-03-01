import React, { useState, useEffect } from 'react';
import { X, Save, Tag, Settings, Home, Zap, Phone, Shield, ShoppingCart, Coffee, Car, Heart, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ExpenseCluster {
  id: string;
  name: string;
  type: 'fixed' | 'variable';
  iconName: string;
  keywords: string[];
}

interface EditClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (cluster: ExpenseCluster) => void;
  clusterToEdit?: ExpenseCluster | null;
  defaultType?: 'fixed' | 'variable';
}

const AVAILABLE_ICONS = [
  { name: 'Home', icon: Home },
  { name: 'Zap', icon: Zap },
  { name: 'Phone', icon: Phone },
  { name: 'Shield', icon: Shield },
  { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'Coffee', icon: Coffee },
  { name: 'Car', icon: Car },
  { name: 'Heart', icon: Heart },
  { name: 'Tag', icon: Tag },
  { name: 'Settings', icon: Settings },
];

export default function EditClusterModal({ isOpen, onClose, onSave, clusterToEdit, defaultType = 'fixed' }: EditClusterModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'fixed' | 'variable'>(defaultType);
  const [iconName, setIconName] = useState('Tag');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);

  useEffect(() => {
    if (clusterToEdit) {
      setName(clusterToEdit.name);
      setType(clusterToEdit.type);
      setIconName(clusterToEdit.iconName);
      setKeywords(clusterToEdit.keywords);
      setKeywordInput('');
    } else {
      setName('');
      setType(defaultType);
      setIconName('Tag');
      setKeywords([]);
      setKeywordInput('');
    }
  }, [clusterToEdit, defaultType, isOpen]);

  const handleAddKeyword = () => {
    if (keywordInput.trim() && !keywords.includes(keywordInput.trim())) {
      setKeywords([...keywords, keywordInput.trim()]);
      setKeywordInput('');
    }
  };

  const handleRemoveKeyword = (kwToRemove: string) => {
    setKeywords(keywords.filter(kw => kw !== kwToRemove));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    
    onSave({
      id: clusterToEdit?.id || Date.now().toString(),
      name: name.trim(),
      type,
      iconName,
      keywords
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        dir="rtl"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                <Settings className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg">
                {clusterToEdit ? 'עריכת אשכול' : 'הוספת אשכול חדש'}
              </h3>
            </div>
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">שם האשכול</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="לדוגמה: קניות סופר"
                className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">סוג הוצאה</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="clusterType" 
                    value="fixed"
                    checked={type === 'fixed'}
                    onChange={() => setType('fixed')}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <span className="text-slate-700">קבועה</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="clusterType" 
                    value="variable"
                    checked={type === 'variable'}
                    onChange={() => setType('variable')}
                    className="text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <span className="text-slate-700">משתנה</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">בחר אייקון</label>
              <div className="grid grid-cols-5 gap-2">
                {AVAILABLE_ICONS.map(({ name: iName, icon: Icon }) => (
                  <button
                    key={iName}
                    onClick={() => setIconName(iName)}
                    className={`p-2 rounded-lg flex items-center justify-center transition-colors ${
                      iconName === iName 
                        ? 'bg-indigo-100 text-indigo-600 border-2 border-indigo-500' 
                        : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">מילות מפתח לשיוך אוטומטי</label>
              <div className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
                  placeholder="לדוגמה: שופרסל, רמי לוי"
                  className="flex-1 bg-white border border-slate-200 text-slate-800 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 text-sm"
                />
                <button 
                  onClick={handleAddKeyword}
                  className="bg-slate-100 text-slate-600 px-3 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {keywords.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md text-sm">
                    {kw}
                    <button onClick={() => handleRemoveKeyword(kw)} className="text-indigo-400 hover:text-indigo-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              שמור אשכול
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
