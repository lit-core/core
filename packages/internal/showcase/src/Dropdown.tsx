import { Check, ChevronDown } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  badge?: string;
  icon?: React.ComponentType<{ className?: string }>;
  group?: string;
}

export interface DropdownProps<T extends string = string> {
  /** Optional label prefix shown inside the trigger button, e.g. "Library", "Optimization" */
  label?: string;
  /** Optional Lucide icon displayed on the left of the trigger button */
  icon?: React.ComponentType<{ className?: string }>;
  /** Currently selected value */
  value: T;
  /** List of available options */
  options: Array<DropdownOption<T>>;
  /** Selection handler */
  onChange: (value: T) => void;
  /** Optional placeholder when no option is matched */
  placeholder?: string;
  /** Optional external class name for container */
  className?: string;
  /** Optional class name override for trigger button */
  buttonClassName?: string;
  /** Optional width/min-width for the dropdown menu popover */
  menuWidth?: string;
  /** Optional alignment: 'left' | 'right' */
  align?: 'left' | 'right';
  /** Optional aria-label */
  ariaLabel?: string;
}

export const Dropdown = <T extends string = string>({
  label,
  icon: Icon,
  value,
  options,
  onChange,
  placeholder = 'Select option',
  className = '',
  buttonClassName = '',
  menuWidth = 'min-w-[220px] max-w-[420px]',
  align = 'left',
  ariaLabel,
}: DropdownProps<T>): React.ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown' && !isOpen) {
      setIsOpen(true);
    }
  };

  const handleSelect = (optValue: T) => {
    onChange(optValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || label || 'Dropdown selector'}
        className={`inline-flex items-center gap-2.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-base rounded-xl transition-all cursor-pointer shadow-none border-none outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 select-none ${buttonClassName}`}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
      >
        {Icon && <Icon className="w-4 h-4 text-emerald-100 shrink-0 stroke-[1.75]" />}
        {label && <span className="text-base font-light text-emerald-100/90 shrink-0">{label}:</span>}
        <span className="text-base font-medium text-white truncate max-w-[240px] sm:max-w-[320px]">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown className={`w-4 h-4 text-emerald-100 shrink-0 stroke-[1.75] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={`absolute top-full mt-2 z-50 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 border-none p-1.5 max-h-80 overflow-y-auto ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuWidth}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const prevOption = index > 0 ? options[index - 1] : null;
            const showGroupHeader = option.group && (!prevOption || prevOption.group !== option.group);
            const OptionIcon = option.icon;

            return (
              <div key={option.value}>
                {showGroupHeader && (
                  <>
                    {index > 0 && <div className="my-1 border-t border-zinc-100" />}
                    <div className="px-3.5 pt-2 pb-1 text-base font-light text-zinc-400 select-none">{option.group}</div>
                  </>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`w-full text-left flex items-center justify-between gap-3 px-3.5 py-2 text-base rounded-xl transition-all cursor-pointer select-none ${
                    isSelected ? 'bg-emerald-50 text-emerald-900 font-medium' : 'text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 font-light hover:font-normal'
                  }`}
                  onClick={() => handleSelect(option.value)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {OptionIcon && <OptionIcon className={`w-4 h-4 shrink-0 stroke-[1.5] ${isSelected ? 'text-emerald-700' : 'text-zinc-400'}`} />}
                    <span className="truncate">{option.label}</span>
                    {option.description && <span className="text-base font-light text-zinc-500 truncate hidden sm:inline">({option.description})</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    {option.badge && <span className="text-base font-light px-2 py-0.5 rounded-lg bg-zinc-100 text-zinc-500">{option.badge}</span>}
                    {isSelected && <Check className="w-4 h-4 text-emerald-700 stroke-[2]" />}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
