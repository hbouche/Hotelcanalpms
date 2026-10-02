import { useState, useEffect, useCallback } from 'react';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  data: any;
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    data: null,
  });

  const handleContextMenu = useCallback((e: React.MouseEvent, data: any) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      data,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setContextMenu(prev => ({
      ...prev,
      visible: false,
    }));
  }, []);

  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleGlobalClick = () => {
      closeMenu();
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    // Delay adding the event listener to avoid immediate firing during the contextmenu click event
    const timeout = setTimeout(() => {
      window.addEventListener('click', handleGlobalClick);
      window.addEventListener('keydown', handleGlobalKeyDown);
    }, 10);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [contextMenu.visible, closeMenu]);

  return {
    contextMenu,
    handleContextMenu,
    closeMenu,
  };
}
