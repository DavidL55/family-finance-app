// Public, programmatic screen navigation (D11) — replaces `App.tsx`'s private `activeTab`
// `useState` (Task 3) so Stage 8's insight deep-links and Stage 10's guided tours have a way to
// change screens from outside `App.tsx`. Follows the identical Provider/`useContext`-with-throw
// shape as `FilterContext`/`NotificationContext`, but in-memory only — no sessionStorage. Unlike
// a filter choice (D1), a killed/reloaded session landing back on whatever tab was last open is
// not desired; it always starts on `dashboard`.

import React, { createContext, useContext, useState, useCallback } from 'react';

interface NavigationContextType {
  activeTab: string;
  navigateTo: (tabId: string) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState('dashboard');

  const navigateTo = useCallback((tabId: string) => {
    setActiveTab(tabId);
  }, []);

  return (
    <NavigationContext.Provider value={{ activeTab, navigateTo }}>
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within NavigationProvider');
  return context;
};
