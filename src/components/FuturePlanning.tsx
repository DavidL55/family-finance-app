import React, { useState } from 'react';
import { Plane, TrendingUp, PiggyBank, ShieldAlert, Target, ArrowUpRight, Sparkles, Home, Briefcase, Plus, X, Car, GraduationCap, Heart, Calculator } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

const initialGoals = [
  { id: 1, name: 'חופשה משפחתית ביפן', target: 30000, current: 12000, date: 'אוקטובר 2026', icon: Plane, color: 'text-blue-600', bg: 'bg-blue-50', bar: 'bg-blue-500' },
  { id: 2, name: 'שיפוץ המטבח', target: 50000, current: 15000, date: 'מרץ 2027', icon: Home, color: 'text-amber-600', bg: 'bg-amber-50', bar: 'bg-amber-500' },
  { id: 3, name: 'בר מצווה ליונתן', target: 40000, current: 35000, date: 'אוגוסט 2026', icon: Target, color: 'text-purple-600', bg: 'bg-purple-50', bar: 'bg-purple-500' },
];

const investments = [
  { id: 1, name: 'תיק השקעות (S&P 500)', value: 145000, returnPct: 12.5, returnVal: 18125 },
  { id: 2, name: 'קרן השתלמות (דוד)', value: 85000, returnPct: 5.2, returnVal: 4420 },
  { id: 3, name: 'קופת גמל להשקעה', value: 32000, returnPct: 8.1, returnVal: 2592 },
];

export default function FuturePlanning() {
  const [goals, setGoals] = useState(initialGoals);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New Goal Form State
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCurrent, setGoalCurrent] = useState('');
  const [goalMonth, setGoalMonth] = useState('דצמבר');
  const [goalYear, setGoalYear] = useState('2026');
  const [goalCategory, setGoalCategory] = useState(categoryOptions[0].id);

  // Calculate required monthly savings
  const calculateMonthlyRequired = () => {
    const target = parseFloat(goalTarget) || 0;
    const current = parseFloat(goalCurrent) || 0;
    const remaining = Math.max(0, target - current);
    
    if (remaining === 0) return 0;

    const currentYear = 2026; // Base year for calculation
    const currentMonthIdx = 1; // February (0-indexed is 1)
    
    const targetYearNum = parseInt(goalYear);
    const targetMonthIdx = monthsList.indexOf(goalMonth);
    
    let monthsDiff = (targetYearNum - currentYear) * 12 + (targetMonthIdx - currentMonthIdx);
    if (monthsDiff <= 0) monthsDiff = 1; // Prevent division by zero or negative months

    return Math.ceil(remaining / monthsDiff);
  };

  const handleAddGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalName || !goalTarget) return;

    const category = categoryOptions.find(c => c.id === goalCategory) || categoryOptions[0];
    
    const newGoal = {
      id: Date.now(),
      name: goalName,
      target: parseFloat(goalTarget),
      current: parseFloat(goalCurrent) || 0,
      date: `${goalMonth} ${goalYear}`,
      icon: category.icon,
      color: category.color,
      bg: category.bg,
      bar: category.bar
    };

    setGoals([...goals, newGoal]);
    setIsModalOpen(false);
    
    // Reset form
    setGoalName('');
    setGoalTarget('');
    setGoalCurrent('');
    setGoalMonth('דצמבר');
    setGoalYear('2026');
    setGoalCategory(categoryOptions[0].id);
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
          <div className="space-y-6">
            {goals.map(goal => {
              const Icon = goal.icon;
              const progress = Math.round((goal.current / goal.target) * 100);
              return (
                <div key={goal.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${goal.bg} ${goal.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800">{goal.name}</h3>
                        <p className="text-xs text-slate-500">יעד: {goal.date}</p>
                      </div>
                    </div>
                    <div className="text-left rtl:text-right">
                      <p className="font-bold text-slate-800">₪{goal.current.toLocaleString()} <span className="text-sm font-normal text-slate-400">מתוך ₪{goal.target.toLocaleString()}</span></p>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div className={`${goal.bar} h-2.5 rounded-full transition-all duration-1000`} style={{ width: `${progress}%` }}></div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 font-medium text-left rtl:text-right">
                    {progress}% הושלמו
                  </div>
                </div>
              );
            })}
          </div>
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
            
            <div className="flex items-end justify-between mb-2">
              <span className="text-3xl font-bold text-slate-800">₪45,000</span>
              <span className="text-sm text-slate-500 mb-1">יעד: ₪60,000</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden mb-2">
              <div className="bg-emerald-500 h-4 rounded-full" style={{ width: '75%' }}></div>
            </div>
            <p className="text-xs text-emerald-600 font-medium text-center">מכסה כ-4.5 חודשי מחיה</p>
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
              <strong className="text-purple-800 block mb-1">הקדמת החופשה ליפן:</strong>
              אם תגדילו את ההפקדה החודשית ב-₪500 מהיתרה הפנויה, תוכלו להגיע ליעד כבר ביוני 2026 (הקדמה של 4 חודשים).
            </li>
            <li className="bg-white/60 p-3 rounded-xl text-sm text-slate-700 leading-relaxed border border-white">
              <strong className="text-purple-800 block mb-1">אופטימיזציית השקעות:</strong>
              זיהינו שקופת הגמל להשקעה נמצאת במסלול סולידי. מעבר למסלול מנייתי עשוי להגדיל את התשואה בטווח הארוך ב-3% בממוצע שנתי.
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
                
                {/* Goal Details */}
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
                    disabled={!goalName || !goalTarget}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
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
