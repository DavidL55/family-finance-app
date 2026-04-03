import React, { useState, useEffect } from 'react';
import { Plane, PiggyBank, ShieldAlert, Target, Sparkles, Home, Plus, X, Car, GraduationCap, Heart, Calculator, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../services/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

const categoryOptions = [
  { id: 'vacation', name: 'חופשה', icon: Plane, color: 'text-blue-600', bg: 'bg-blue-50', bar: 'bg-blue-500' },
  { id: 'home', name: 'בית ושיפוצים', icon: Home, color: 'text-amber-600', bg: 'bg-amber-50', bar: 'bg-amber-500' },
  { id: 'event', name: 'אירוע משפחתי', icon: Target, color: 'text-purple-600', bg: 'bg-purple-50', bar: 'bg-purple-500' },
  { id: 'car', name: 'רכב חדש', icon: Car, color: 'text-emerald-600', bg: 'bg-emerald-50', bar: 'bg-emerald-500' },
  { id: 'education', name: 'לימודים', icon: GraduationCap, color: 'text-indigo-600', bg: 'bg-indigo-50', bar: 'bg-indigo-500' },
  { id: 'other', name: 'אחר', icon: Heart, color: 'text-rose-600', bg: 'bg-rose-50', bar: 'bg-rose-500' },
];

const monthsList = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

const yearsList = ['2026', '2027', '2028', '2029', '2030', '2035'];

interface Goal {
  firestoreId: string;
  name: string;
  target: number;
  current: number;
  date: string;
  categoryId: string;
}

export default function FuturePlanning() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // New Goal Form State
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCurrent, setGoalCurrent] = useState('');
  const [goalMonth, setGoalMonth] = useState('דצמבר');
  const [goalYear, setGoalYear] = useState('2026');
  const [goalCategory, setGoalCategory] = useState(categoryOptions[0].id);

  // Load goals from Firestore (real-time)
  useEffect(() => {
    const q = query(collection(db, 'goals'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded: Goal[] = snapshot.docs.map(d => ({
        firestoreId: d.id,
        name: d.data().name as string,
        target: d.data().target as number,
        current: d.data().current as number,
        date: d.data().date as string,
        categoryId: (d.data().categoryId as string) || 'other',
      }));
      setGoals(loaded);
      setIsLoading(false);
    }, (err) => {
      console.error('Failed to load goals:', err);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Calculate required monthly savings for modal preview
  const calculateMonthlyRequired = () => {
    const target = parseFloat(goalTarget) || 0;
    const current = parseFloat(goalCurrent) || 0;
    const remaining = Math.max(0, target - current);
    if (remaining === 0) return 0;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIdx = now.getMonth();

    const targetYearNum = parseInt(goalYear);
    const targetMonthIdx = monthsList.indexOf(goalMonth);
    let monthsDiff = (targetYearNum - currentYear) * 12 + (targetMonthIdx - currentMonthIdx);
    if (monthsDiff <= 0) monthsDiff = 1;

    return Math.ceil(remaining / monthsDiff);
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalName || !goalTarget) return;

    setIsSaving(true);
    try {
      await addDoc(collection(db, 'goals'), {
        name: goalName,
        target: parseFloat(goalTarget),
        current: parseFloat(goalCurrent) || 0,
        date: `${goalMonth} ${goalYear}`,
        categoryId: goalCategory,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      setIsModalOpen(false);
      setGoalName('');
      setGoalTarget('');
      setGoalCurrent('');
      setGoalMonth('דצמבר');
      setGoalYear('2026');
      setGoalCategory(categoryOptions[0].id);
    } catch (err) {
      console.error('Failed to save goal:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGoal = async (firestoreId: string) => {
    try {
      await deleteDoc(doc(db, 'goals', firestoreId));
    } catch (err) {
      console.error('Failed to delete goal:', err);
    }
  };

  const monthlyRequired = calculateMonthlyRequired();
  const targetAmount = parseFloat(goalTarget) || 0;
  const currentAmount = parseFloat(goalCurrent) || 0;
  const progressPct = targetAmount > 0 ? Math.min(100, Math.round((currentAmount / targetAmount) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">תכנון עתידי והשקעות</h1>
          <p className="text-slate-500 mt-1">יעדים, חסכונות ותחזיות פיננסיות להמשך הדרך</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl shadow-sm flex items-center gap-2 transition-colors font-medium"
        >
          <Plus className="w-5 h-5" />
          הוספת מטרה חדשה
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Savings Goals */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <PiggyBank className="w-6 h-6 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">יעדי חיסכון</h2>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            </div>
          ) : goals.length === 0 ? (
            <div className="text-center py-10">
              <PiggyBank className="w-12 h-12 mx-auto mb-3 text-slate-200" />
              <p className="text-slate-500">אין יעדים עדיין.</p>
              <p className="text-sm text-slate-400 mt-1">לחץ &ldquo;הוספת מטרה חדשה&rdquo; להתחיל.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {goals.map(goal => {
                const category = categoryOptions.find(c => c.id === goal.categoryId) ?? categoryOptions[0];
                const Icon = category.icon;
                const progress = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
                return (
                  <div key={goal.firestoreId} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${category.bg} ${category.color}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-800">{goal.name}</h3>
                          <p className="text-xs text-slate-500">יעד: {goal.date}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-left rtl:text-right">
                          <p className="font-bold text-slate-800">₪{goal.current.toLocaleString()} <span className="text-sm font-normal text-slate-400">מתוך ₪{goal.target.toLocaleString()}</span></p>
                        </div>
                        <button
                          onClick={() => handleDeleteGoal(goal.firestoreId)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="מחק יעד"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                      <div className={`${category.bar} h-2.5 rounded-full transition-all duration-1000`} style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 font-medium text-left rtl:text-right">
                      {progress}% הושלמו
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Emergency Fund */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="w-6 h-6 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-800">קרן חירום</h2>
            </div>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              קרן החירום נועדה לכסות 3-6 חודשי מחיה במקרה של אובדן הכנסה פתאומי או הוצאה רפואית חריגה.
            </p>
            <p className="text-xs text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-100">
              הוסף יעד &ldquo;קרן חירום&rdquo; ברשימת יעדי החיסכון כדי לעקוב אחר ההתקדמות.
            </p>
          </div>

          <button className="w-full mt-6 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl font-medium transition-colors text-sm">
            הפקד לקרן החירום
          </button>
        </div>

        {/* AI Future Projections */}
        <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 p-6 rounded-2xl border border-purple-100">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-6 h-6 text-purple-600" />
            <h2 className="text-lg font-bold text-purple-900">תחזיות AI לעתיד</h2>
          </div>
          <ul className="space-y-4">
            <li className="bg-white/60 p-3 rounded-xl text-sm text-slate-700 leading-relaxed border border-white">
              <strong className="text-purple-800 block mb-1">טיפ לתכנון:</strong>
              הוסף יעדי חיסכון עם סכום יעד ותאריך יעד. המערכת תחשב את ההפקדה החודשית הנדרשת כדי להגיע ליעד בזמן.
            </li>
            <li className="bg-white/60 p-3 rounded-xl text-sm text-slate-700 leading-relaxed border border-white">
              <strong className="text-purple-800 block mb-1">עדכון התקדמות:</strong>
              לאחר הוספת יעד, ניתן למחוק ולהוסיף מחדש עם הסכום המעודכן כדי לשקף את ההתקדמות בפועל.
            </li>
          </ul>
        </div>

      </div>

      {/* Add Goal Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                    <Target className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg">הוספת מטרה עתידית</h3>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddGoal} className="p-6 space-y-5">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">שם המטרה</label>
                    <input
                      type="text"
                      required
                      placeholder="לדוגמה: רכב חדש, חופשה בקיץ..."
                      value={goalName}
                      onChange={(e) => setGoalName(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">יעד לחיסכון (₪)</label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="0"
                        value={goalTarget}
                        onChange={(e) => setGoalTarget(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">סכום נוכחי (₪)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={goalCurrent}
                        onChange={(e) => setGoalCurrent(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">חודש יעד</label>
                      <select
                        value={goalMonth}
                        onChange={(e) => setGoalMonth(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3"
                      >
                        {monthsList.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">שנת יעד</label>
                      <select
                        value={goalYear}
                        onChange={(e) => setGoalYear(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3"
                      >
                        {yearsList.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">קטגוריה</label>
                    <div className="grid grid-cols-3 gap-2">
                      {categoryOptions.map(cat => {
                        const Icon = cat.icon;
                        const isSelected = goalCategory === cat.id;
                        return (
                          <div
                            key={cat.id}
                            onClick={() => setGoalCategory(cat.id)}
                            className={`cursor-pointer flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:border-slate-200 bg-white'}`}
                          >
                            <Icon className={`w-6 h-6 mb-1 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                            <span className={`text-xs font-medium ${isSelected ? 'text-blue-700' : 'text-slate-500'}`}>{cat.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Smart Calculator Summary */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-3">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-blue-500" />
                    תכנון חכם
                  </h4>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">התקדמות נוכחית:</span>
                    <span className="font-bold text-slate-800">{progressPct}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }}></div>
                  </div>

                  <div className="flex items-center justify-between text-sm mt-2 pt-3 border-t border-slate-200">
                    <span className="text-slate-600">חיסכון חודשי נדרש:</span>
                    <span className="font-bold text-blue-600 text-lg">₪{monthlyRequired.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    * מחושב לפי הסכום הנותר (₪{(targetAmount - currentAmount > 0 ? targetAmount - currentAmount : 0).toLocaleString()}) עד {goalMonth} {goalYear}.
                  </p>
                </div>

                {/* Submit */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!goalName || !goalTarget || isSaving}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    הוסף מטרה לתוכנית
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
