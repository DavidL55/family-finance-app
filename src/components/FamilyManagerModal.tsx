import React, { useState, useEffect } from 'react';
import { X, UserPlus, Trash2, Edit2, Check, User as UserIcon } from 'lucide-react';
import { validateIsraeliID } from '../utils/validation';
import { useNotification } from '../contexts/NotificationContext';

export interface FamilyMember {
  id: string;
  name: string;
  role: 'הורה' | 'ילד';
  idNumber: string;
}

interface FamilyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: FamilyMember[];
  onSave: (members: FamilyMember[]) => void;
}

export default function FamilyManagerModal({ isOpen, onClose, members, onSave }: FamilyManagerModalProps) {
  const { addNotification } = useNotification();
  const [localMembers, setLocalMembers] = useState<FamilyMember[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [role, setRole] = useState<'הורה' | 'ילד'>('הורה');
  const [idNumber, setIdNumber] = useState('');
  const [idError, setIdError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalMembers(members);
      resetForm();
    }
  }, [isOpen, members]);

  if (!isOpen) return null;

  const resetForm = () => {
    setName('');
    setRole('הורה');
    setIdNumber('');
    setIdError(false);
    setEditingId(null);
  };

  const handleEdit = (member: FamilyMember) => {
    setEditingId(member.id);
    setName(member.name);
    setRole(member.role);
    setIdNumber(member.idNumber);
    setIdError(false);
  };

  const handleDelete = (id: string) => {
    const updated = localMembers.filter(m => m.id !== id);
    setLocalMembers(updated);
    onSave(updated);
    addNotification('success', 'בן משפחה הוסר בהצלחה!');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !idNumber.trim()) {
      addNotification('error', 'נא למלא את כל השדות');
      return;
    }

    if (!validateIsraeliID(idNumber)) {
      setIdError(true);
      addNotification('error', 'מספר תעודת זהות לא תקין');
      return;
    }

    const newMember: FamilyMember = {
      id: editingId || Math.random().toString(36).substr(2, 9),
      name,
      role,
      idNumber
    };

    let updatedMembers;
    if (editingId) {
      updatedMembers = localMembers.map(m => m.id === editingId ? newMember : m);
      addNotification('success', 'הנתונים עודכנו בהצלחה!');
    } else {
      updatedMembers = [...localMembers, newMember];
      addNotification('success', 'בן משפחה נוסף בהצלחה!');
    }

    setLocalMembers(updatedMembers);
    onSave(updatedMembers);
    resetForm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
              <UserIcon className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-800 text-xl">ניהול בני משפחה</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {/* Add/Edit Form */}
          <form onSubmit={handleSubmit} className="bg-slate-50 p-5 rounded-xl border border-slate-200">
            <h4 className="font-semibold text-slate-700 mb-4">
              {editingId ? 'עריכת בן משפחה' : 'הוספת בן משפחה חדש'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">שם מלא</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                  placeholder="ישראל ישראלי"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">תפקיד</label>
                <select 
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'הורה' | 'ילד')}
                  className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                >
                  <option value="הורה">הורה</option>
                  <option value="ילד">ילד</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">תעודת זהות</label>
                <input 
                  type="text" 
                  value={idNumber}
                  onChange={(e) => {
                    setIdNumber(e.target.value);
                    setIdError(false);
                  }}
                  className={`w-full bg-white border text-slate-800 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 ${
                    idError ? 'border-red-500 bg-red-50 focus:ring-red-500 focus:border-red-500' : 'border-slate-200'
                  }`}
                  placeholder="123456789"
                  maxLength={9}
                />
                {idError && <p className="text-xs text-red-500 mt-1">מספר תעודת זהות אינו תקין</p>}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {editingId && (
                <button 
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg text-sm font-medium transition-colors"
                >
                  ביטול עריכה
                </button>
              )}
              <button 
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {editingId ? <Check className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                {editingId ? 'שמור שינויים' : 'הוסף למשפחה'}
              </button>
            </div>
          </form>

          {/* Members List */}
          <div>
            <h4 className="font-semibold text-slate-700 mb-3">בני משפחה קיימים</h4>
            {localMembers.length === 0 ? (
              <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                לא הוגדרו בני משפחה. הוסף את בן המשפחה הראשון למעלה.
              </div>
            ) : (
              <div className="space-y-3">
                {localMembers.map(member => (
                  <div key={member.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-indigo-200 transition-colors shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                        member.role === 'הורה' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {member.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{member.name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="bg-slate-100 px-2 py-0.5 rounded-md">{member.role}</span>
                          <span>ת"ז: {member.idNumber}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEdit(member)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="ערוך"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(member.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="מחק"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
