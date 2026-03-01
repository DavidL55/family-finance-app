import { Home, Zap, Car, ShoppingCart, Utensils, Shield, Pill, Coffee, Baby, Droplet, Flame, Building, CreditCard, Smartphone, Banknote } from 'lucide-react';

const owners = ['דוד', 'לילית', 'משותף'];
const paymentMethods = [
  'אשראי דוד (ויזה כאל)', 'אשראי דוד (מקס)', 'אשראי דוד (אמקס)',
  'אשראי לילית (מאסטרקרד)', 'אשראי לילית (ויזה)', 'אשראי לילית (פלייקארד)',
  'מזומן', 'הוראת קבע', 'ביט', 'PayPal'
];

const categories = [
  { name: 'חוגים', icon: Baby, type: 'fixed', min: 150, max: 400 },
  { name: 'קניות', icon: ShoppingCart, type: 'variable', min: 50, max: 500 },
  { name: 'בתי מרקחת', icon: Pill, type: 'variable', min: 20, max: 200 },
  { name: 'מסעדות', icon: Utensils, type: 'variable', min: 100, max: 400 },
  { name: 'בתי קפה', icon: Coffee, type: 'variable', min: 30, max: 100 },
  { name: 'מים', icon: Droplet, type: 'fixed', min: 100, max: 200 },
  { name: 'חשמל', icon: Zap, type: 'fixed', min: 300, max: 600 },
  { name: 'ארנונה', icon: Home, type: 'fixed', min: 400, max: 800 },
  { name: 'גז', icon: Flame, type: 'fixed', min: 50, max: 150 },
  { name: 'ועד בית', icon: Building, type: 'fixed', min: 200, max: 300 },
  { name: 'דלק', icon: Car, type: 'variable', min: 200, max: 400 },
  { name: 'טיפול רכב', icon: Car, type: 'variable', min: 500, max: 1500 },
  { name: 'ירקן', icon: ShoppingCart, type: 'variable', min: 50, max: 150 },
  { name: 'מכולת', icon: ShoppingCart, type: 'variable', min: 30, max: 100 },
  { name: 'סופר', icon: ShoppingCart, type: 'variable', min: 300, max: 800 },
  { name: 'ביטוח בית', icon: Shield, type: 'fixed', min: 100, max: 200 },
  { name: 'ביטוח רכב חובה', icon: Shield, type: 'fixed', min: 100, max: 150 },
  { name: 'ביטוח רכב מקיף', icon: Shield, type: 'fixed', min: 200, max: 400 },
];

export const generateExpenses = (month: string, year: string) => {
  const expenses = [];
  let id = 1;
  
  // Generate fixed expenses first
  const fixedCats = categories.filter(c => c.type === 'fixed');
  fixedCats.forEach(cat => {
    expenses.push({
      id: id++,
      name: cat.name,
      amount: Math.floor(Math.random() * (cat.max - cat.min) + cat.min),
      date: `0${Math.floor(Math.random() * 9) + 1}/${month}/${year}`,
      type: 'fixed',
      category: cat.name,
      icon: cat.icon,
      owner: owners[Math.floor(Math.random() * owners.length)],
      paymentMethod: cat.name.includes('ביטוח') || cat.name.includes('ארנונה') ? 'הוראת קבע' : paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
      sourceFile: `חשבונית_${cat.name.replace(' ', '_')}_${month}_${year}.pdf`,
      fileType: 'pdf'
    });
  });

  // Generate variable expenses to reach ~100+
  const variableCats = categories.filter(c => c.type === 'variable');
  for (let i = 0; i < 95; i++) {
    const cat = variableCats[Math.floor(Math.random() * variableCats.length)];
    const isCash = Math.random() > 0.9;
    const isBit = Math.random() > 0.85;
    const isPayPal = Math.random() > 0.95;
    
    let pm = paymentMethods[Math.floor(Math.random() * 6)]; // mostly credit cards
    if (isCash) pm = 'מזומן';
    else if (isBit) pm = 'ביט';
    else if (isPayPal) pm = 'PayPal';

    let fileType = 'image';
    let sourceFile = `קבלה_${cat.name.replace(' ', '_')}_${i}.jpg`;
    if (pm.includes('אשראי')) {
      fileType = 'csv';
      sourceFile = `פירוט_אשראי_${pm.split(' ')[1].replace('(', '').replace(')', '')}_${month}_${year}.csv`;
    }

    expenses.push({
      id: id++,
      name: `${cat.name} - ${Math.random() > 0.5 ? 'תל אביב' : 'מקומי'}`,
      amount: Math.floor(Math.random() * (cat.max - cat.min) + cat.min),
      date: `${Math.floor(Math.random() * 28) + 1 < 10 ? '0' : ''}${Math.floor(Math.random() * 28) + 1}/${month}/${year}`,
      type: 'variable',
      category: cat.name,
      icon: cat.icon,
      owner: pm.includes('דוד') ? 'דוד' : pm.includes('לילית') ? 'לילית' : owners[Math.floor(Math.random() * owners.length)],
      paymentMethod: pm,
      sourceFile,
      fileType
    });
  }

  return expenses.sort((a, b) => {
    const dayA = parseInt(a.date.split('/')[0]);
    const dayB = parseInt(b.date.split('/')[0]);
    return dayB - dayA; // sort desc
  });
};
