import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 'info' added (D12, Stage 5 Task 2) — a calm, non-error/non-success notice (e.g. "הפילטור לא חל
// כאן עדיין" on a drill-down destination not yet wired onto global filters). Distinct styling from
// 'error' (red) so a genuinely informational notice never reads as something having gone wrong.
type NotificationType = 'success' | 'error' | 'info';

interface Notification {
  id: string;
  type: NotificationType;
  message: string;
}

interface NotificationContextType {
  addNotification: (type: NotificationType, message: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback((type: NotificationType, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications(prev => [...prev, { id, type, message }]);

    setTimeout(() => {
      removeNotification(id);
    }, 10000);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ addNotification }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map(notif => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border ${
                notif.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : notif.type === 'info'
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
              dir="rtl"
            >
              {notif.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-emerald-500" />
              ) : notif.type === 'info' ? (
                <Info className="w-5 h-5 text-blue-500" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-500" />
              )}
              <span className="font-medium text-sm">{notif.message}</span>
              <button
                onClick={() => removeNotification(notif.id)}
                className={`p-1 rounded-md transition-colors ${
                  notif.type === 'success'
                    ? 'hover:bg-emerald-100 text-emerald-600'
                    : notif.type === 'info'
                    ? 'hover:bg-blue-100 text-blue-600'
                    : 'hover:bg-red-100 text-red-600'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
}

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used within NotificationProvider');
  return context;
};
