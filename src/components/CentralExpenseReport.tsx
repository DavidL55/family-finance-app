import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, ReceiptText, CreditCard, Calendar, Tag, Edit2, Trash2, Plus, Home, Zap, Phone, Shield, ShoppingCart, Coffee, Car, Heart, Settings } from 'lucide-react';
import EditClusterModal, { ExpenseCluster } from './EditClusterModal';
import { useNotification } from '../contexts/NotificationContext';

type ExpenseType = 'fixed' | 'variable';

interface Expense {
  id: string;
  type: ExpenseType;
  category: string;
  provider: string;
  amount: number;
  paymentMethod: string;
  date: string;
}

const mockExpenses: Expense[] = [
  { id: '1', type: 'fixed', category: 'חשבונות בית', provider: 'חברת חשמל', amount: 450, paymentMethod: 'ויזה דוד', date: '15/05/2024' },
  { id: '2', type: 'fixed', category: 'חשבונות בית', provider: 'תאגיד המים', amount: 120, paymentMethod: 'ויזה דוד', date: '10/05/2024' },
  { id: '3', type: 'fixed', category: 'תקשורת', provider: 'סלקום', amount: 150, paymentMethod: 'ויזה שרה', date: '02/05/2024' },
  { id: '4', type: 'fixed', category: 'תקשורת', provider: 'הוט', amount: 200, paymentMethod: 'ויזה דוד', date: '05/05/2024' },
  { id: '9', type: 'fixed', category: 'ביטוחים', provider: 'הראל ביטוח רכב', amount: 350, paymentMethod: 'הוראת קבע', date: '01/05/2024' },
  { id: '5', type: 'variable', category: 'קניות סופר', provider: 'רמי לוי', amount: 850, paymentMethod: 'ויזה שרה', date: '12/05/2024' },
  { id: '6', type: 'variable', category: 'קניות סופר', provider: 'שופרסל', amount: 320, paymentMethod: 'מזומן', date: '18/05/2024' },
  { id: '7', type: 'variable', category: 'פנאי ומסעדות', provider: 'מסעדת הפיל', amount: 400, paymentMethod: 'ויזה דוד', date: '20/05/2024' },
  { id: '8', type: 'variable', category: 'פנאי ומסעדות', provider: 'קולנוע', amount: 150, paymentMethod: 'ויזה שרה', date: '22/05/2024' },
  { id: '10', type: 'variable', category: 'רכב ותחבורה', provider: 'פז', amount: 250, paymentMethod: 'ויזה דוד', date: '14/05/2024' },
];

const defaultClusters: ExpenseCluster[] = [
  { id: 'c1', name: 'חשבונות בית', type: 'fixed', iconName: 'Home', keywords: ['חשמל', 'מים', 'ארנונה'] },
  { id: 'c2', name: 'תקשורת', type: 'fixed', iconName: 'Phone', keywords: ['סלקום', 'הוט', 'אינטרנט'] },
  { id: 'c3', name: 'ביטוחים', type: 'fixed', iconName: 'Shield', keywords: ['הראל', 'ביטוח'] },
  { id: 'c4', name: 'קניות סופר', type: 'variable', iconName: 'ShoppingCart', keywords: ['רמי לוי', 'שופרסל'] },
  { id: 'c5', name: 'פנאי ומסעדות', type: 'variable', iconName: 'Coffee', keywords: ['מסעדה', 'קולנוע'] },
  { id: 'c6', name: 'רכב ותחבורה', type: 'variable', iconName: 'Car', keywords: ['פז', 'דלק', 'מוסך'] },
];

const ICON_MAP: Record<string, any> = {
  Home, Zap, Phone, Shield, ShoppingCart, Coffee, Car, Heart, Tag, Settings
};

const calculateTotal = (expenses: Expense[]) => expenses.reduce((sum, exp) => sum + exp.amount, 0);

export default function CentralExpenseReport() {
  const { addNotification } = useNotification();
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  const [clusters, setClusters] = useState<ExpenseCluster[]>(() => {
    const saved = localStorage.getItem('expense_clusters');
    return saved ? JSON.parse(saved) : defaultClusters;
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<ExpenseCluster | null>(null);
  const [modalDefaultType, setModalDefaultType] = useState<'fixed' | 'variable'>('fixed');

  useEffect(() => {
    localStorage.setItem('expense_clusters', JSON.stringify(clusters));
  }, [clusters]);

  const toggleCluster = (clusterId: string) => {
    setExpandedClusters(prev => ({
      ...prev,
      [clusterId]: !prev[clusterId]
    }));
  };

  const handleAddCluster = (type: 'fixed' | 'variable') => {
    setEditingCluster(null);
    setModalDefaultType(type);
    setIsModalOpen(true);
  };

  const handleEditCluster = (cluster: ExpenseCluster) => {
    setEditingCluster(cluster);
    setIsModalOpen(true);
  };

  const handleDeleteCluster = (cluster: ExpenseCluster, expenseCount: number) => {
    if (expenseCount > 0) {
      addNotification('error', 'לא ניתן למחוק אשכול המכיל נתונים פעילים');
      return;
    }
    setClusters(clusters.filter(c => c.id !== cluster.id));
    addNotification('success', 'האשכול נמחק בהצלחה');
  };

  const handleSaveCluster = (savedCluster: ExpenseCluster) => {
    if (editingCluster) {
      setClusters(clusters.map(c => c.id === savedCluster.id ? savedCluster : c));
      addNotification('info', 'שינויים נשמרו');
    } else {
      setClusters([...clusters, savedCluster]);
      addNotification('success', `אשכול ${savedCluster.name} נוסף בהצלחה!`);
    }
    setIsModalOpen(false);
  };

  const groupedData = useMemo(() => {
    const grouped: Record<string, { cluster: ExpenseCluster, expenses: Expense[] }> = {};
    
    clusters.forEach(c => {
      grouped[c.id] = { cluster: c, expenses: [] };
    });

    const fallbackFixed: ExpenseCluster = { id: 'fallback-fixed', name: 'אחר - קבועות', type: 'fixed', iconName: 'Tag', keywords: [] };
    const fallbackVariable: ExpenseCluster = { id: 'fallback-variable', name: 'אחר - משתנות', type: 'variable', iconName: 'Tag', keywords: [] };
    grouped['fallback-fixed'] = { cluster: fallbackFixed, expenses: [] };
    grouped['fallback-variable'] = { cluster: fallbackVariable, expenses: [] };

    mockExpenses.forEach(exp => {
      // 1. Try exact match by category name
      let matchedCluster = clusters.find(c => c.name === exp.category && c.type === exp.type);
      
      // 2. Try match by keywords in provider
      if (!matchedCluster) {
        matchedCluster = clusters.find(c => 
          c.type === exp.type && 
          c.keywords.some(kw => exp.provider.includes(kw))
        );
      }

      if (matchedCluster) {
        grouped[matchedCluster.id].expenses.push(exp);
      } else {
        if (exp.type === 'fixed') {
          grouped['fallback-fixed'].expenses.push(exp);
        } else {
          grouped['fallback-variable'].expenses.push(exp);
        }
      }
    });

    return grouped;
  }, [clusters]);
  
  const fixedTotal = useMemo(() => calculateTotal(mockExpenses.filter(e => e.type === 'fixed')), []);
  const variableTotal = useMemo(() => calculateTotal(mockExpenses.filter(e => e.type === 'variable')), []);
  const grandTotal = fixedTotal + variableTotal;

  const renderCluster = (clusterId: string, clusterData: { cluster: ExpenseCluster, expenses: Expense[] }) => {
    const { cluster, expenses } = clusterData;
    if (expenses.length === 0 && cluster.id.startsWith('fallback')) return null; // Hide empty fallbacks
    
    const isExpanded = expandedClusters[clusterId];
    const clusterTotal = calculateTotal(expenses);
    const IconComponent = ICON_MAP[cluster.iconName] || Tag;
    const isFallback = cluster.id.startsWith('fallback');

    return (
      <div key={clusterId} className="mb-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
          <div 
            className="flex items-center gap-3 flex-1 cursor-pointer"
            onClick={() => toggleCluster(clusterId)}
          >
            <div className={`p-2 rounded-lg ${isExpanded ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
            <div className="flex items-center gap-2">
              <IconComponent className="w-5 h-5 text-slate-400" />
              <span className="font-bold text-slate-800 text-lg">{cluster.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="font-bold text-lg text-slate-800" dir="ltr">
              ₪{clusterTotal.toLocaleString()}
            </div>
            {!isFallback && (
              <div className="flex items-center gap-1 border-r border-slate-200 pr-4 mr-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleEditCluster(cluster); }}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                  title="ערוך אשכול"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteCluster(cluster, expenses.length); }}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="מחק אשכול"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-slate-100 bg-slate-50 p-4">
            {expenses.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead>
                    <tr className="text-slate-500 text-sm border-b border-slate-200">
                      <th className="pb-3 font-medium">
                        <div className="flex items-center gap-2">
                          <Tag className="w-4 h-4" />
                          תיאור/ספק
                        </div>
                      </th>
                      <th className="pb-3 font-medium">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4" />
                          אופן תשלום
                        </div>
                      </th>
                      <th className="pb-3 font-medium">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          תאריך חיוב
                        </div>
                      </th>
                      <th className="pb-3 font-medium text-left">סכום</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((exp) => (
                      <tr key={exp.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 text-slate-800 font-medium">{exp.provider}</td>
                        <td className="py-3 text-slate-600 text-sm">{exp.paymentMethod}</td>
                        <td className="py-3 text-slate-600 text-sm">{exp.date}</td>
                        <td className="py-3 text-slate-800 font-bold text-left" dir="ltr">
                          ₪{exp.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm">
                אין הוצאות באשכול זה
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
          <ReceiptText className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">דוח הוצאות מרכז</h1>
          <p className="text-slate-500">פירוט היררכי של כלל ההוצאות החודשיות</p>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-4 px-2">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800">הוצאות קבועות</h2>
            <button 
              onClick={() => handleAddCluster('fixed')}
              className="flex items-center gap-1 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              הוסף אשכול חדש
            </button>
          </div>
          <span className="text-sm font-semibold text-slate-500 bg-slate-200 px-3 py-1 rounded-full">
            סה"כ ביניים: <span dir="ltr">₪{fixedTotal.toLocaleString()}</span>
          </span>
        </div>
        <div className="space-y-4">
          {(Object.values(groupedData) as { cluster: ExpenseCluster, expenses: Expense[] }[])
            .filter(data => data.cluster.type === 'fixed')
            .map(data => renderCluster(data.cluster.id, data))
          }
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4 px-2 mt-8">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800">הוצאות משתנות</h2>
            <button 
              onClick={() => handleAddCluster('variable')}
              className="flex items-center gap-1 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              הוסף אשכול חדש
            </button>
          </div>
          <span className="text-sm font-semibold text-slate-500 bg-slate-200 px-3 py-1 rounded-full">
            סה"כ ביניים: <span dir="ltr">₪{variableTotal.toLocaleString()}</span>
          </span>
        </div>
        <div className="space-y-4">
          {(Object.values(groupedData) as { cluster: ExpenseCluster, expenses: Expense[] }[])
            .filter(data => data.cluster.type === 'variable')
            .map(data => renderCluster(data.cluster.id, data))
          }
        </div>
      </section>

      <div className="mt-8 bg-slate-800 text-white rounded-2xl p-6 shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
            <ReceiptText className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold">סה"כ כללי לחודש זה</span>
        </div>
        <div className="text-3xl font-bold" dir="ltr">
          ₪{grandTotal.toLocaleString()}
        </div>
      </div>

      <EditClusterModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveCluster}
        clusterToEdit={editingCluster}
        defaultType={modalDefaultType}
      />
    </div>
  );
}
