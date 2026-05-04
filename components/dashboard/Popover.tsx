// components/dashboard/Popover.tsx
// Generic dropdown popover. Click-outside + Escape cierran.
// Posicionamiento absoluto debajo del trigger, alineado a la izquierda.

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PopoverProps {
  /** Contenido del botón que abre/cierra el popover. */
  trigger: ReactNode;
  /** Contenido dentro del panel cuando está abierto. */
  children: ReactNode;
  /** Clases extra para el botón trigger. */
  triggerClassName?: string;
  /** Ancho del panel. */
  panelClassName?: string;
  /** Callback cuando se cierra (útil para apply-on-close). */
  onClose?: () => void;
}

export function Popover({ trigger, children, triggerClassName, panelClassName, onClose }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn('outline-none', triggerClassName)}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg p-3',
            panelClassName ?? 'min-w-[260px]'
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
