import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface PopupState {
  id: string;
  title: string;
  content: string;
  isGenerating: boolean;
  wordCount?: number;
  filename?: string;
  isMinimized: boolean;
  onStop?: () => void;
}

interface PopupManagerContextType {
  popups: PopupState[];
  activePopupId: string | null;
  registerPopup: (popup: Omit<PopupState, "isMinimized">) => void;
  updatePopup: (id: string, updates: Partial<PopupState>) => void;
  closePopup: (id: string) => void;
  minimizePopup: (id: string) => void;
  expandPopup: (id: string) => void;
  setActivePopup: (id: string | null) => void;
}

const PopupManagerContext = createContext<PopupManagerContextType | null>(null);

export function PopupManagerProvider({ children }: { children: ReactNode }) {
  const [popups, setPopups] = useState<PopupState[]>([]);
  const [activePopupId, setActivePopupId] = useState<string | null>(null);

  const registerPopup = useCallback((popup: Omit<PopupState, "isMinimized">) => {
    setPopups((prev) => {
      const existing = prev.find((p) => p.id === popup.id);
      if (existing) {
        return prev.map((p) =>
          p.id === popup.id ? { ...p, ...popup } : p
        );
      }
      return [...prev, { ...popup, isMinimized: false }];
    });
    setActivePopupId(popup.id);
  }, []);

  const updatePopup = useCallback((id: string, updates: Partial<PopupState>) => {
    setPopups((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  }, []);

  const closePopup = useCallback((id: string) => {
    setPopups((prev) => prev.filter((p) => p.id !== id));
    setActivePopupId((prev) => (prev === id ? null : prev));
  }, []);

  const minimizePopup = useCallback((id: string) => {
    setPopups((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isMinimized: true } : p))
    );
  }, []);

  const expandPopup = useCallback((id: string) => {
    setPopups((prev) =>
      prev.map((p) => ({
        ...p,
        isMinimized: p.id === id ? false : true,
      }))
    );
    setActivePopupId(id);
  }, []);

  const setActivePopup = useCallback((id: string | null) => {
    setActivePopupId(id);
  }, []);

  return (
    <PopupManagerContext.Provider
      value={{
        popups,
        activePopupId,
        registerPopup,
        updatePopup,
        closePopup,
        minimizePopup,
        expandPopup,
        setActivePopup,
      }}
    >
      {children}
    </PopupManagerContext.Provider>
  );
}

export function usePopupManager() {
  const context = useContext(PopupManagerContext);
  if (!context) {
    throw new Error("usePopupManager must be used within a PopupManagerProvider");
  }
  return context;
}
