import { cn } from '../../lib/utils';
import { useId, useState, useEffect, useRef } from 'react';

interface CurrencyInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  required?: boolean;
  error?: string;
  showDivider?: boolean;
  currencySymbol?: string;
}

export function CurrencyInput({
  label,
  value,
  onChange,
  placeholder = '0',
  size = 'md',
  className,
  required,
  error,
  showDivider = true,
  currencySymbol = 'Rp',
}: CurrencyInputProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const [rawInput, setRawInput] = useState('');
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: 'text-xl sm:text-2xl',
    md: 'text-2xl sm:text-3xl md:text-4xl',
    lg: 'text-3xl sm:text-4xl md:text-5xl',
  };

  const parseNumberWithSuffix = (str: string): number | null => {
    const cleaned = str.replace(/[^\d.kKmMbB\+\-\*/]/g, '');
    
    const suffixMatch = cleaned.match(/^(\d*\.?\d+)([kmb])$/i);
    if (suffixMatch) {
      const num = parseFloat(suffixMatch[1]);
      const suffix = suffixMatch[2].toLowerCase();
      let multiplier = 1;
      if (suffix === 'k') multiplier = 1000;
      else if (suffix === 'm') multiplier = 1000000;
      else if (suffix === 'b') multiplier = 1000000000;
      return num * multiplier;
    }
    
    // Strip thousand separators (Indonesian dots) before parsing
    const numericStr = cleaned.replace(/\./g, '');
    const num = parseFloat(numericStr);
    return isNaN(num) ? null : num;
  };

  const evaluateExpression = (input: string): number | null => {
    const cleaned = input.replace(/\s+/g, '').replace(/[^\d.kKmMbB\+\-\*/]/g, '');
    if (!cleaned) return null;
    
    const hasOperator = /[+\-*/]/.test(cleaned);
    
    if (!hasOperator) {
      return parseNumberWithSuffix(cleaned);
    }
    
    const operators = cleaned.match(/[+\-*/]/g);
    if (!operators || operators.length === 0) {
      return parseNumberWithSuffix(cleaned);
    }
    
    const parts = cleaned.split(/[+\-*/]/);
    if (parts.length < 2) {
      return parseNumberWithSuffix(cleaned);
    }
    
    let result = parseNumberWithSuffix(parts[0]);
    if (result === null) return null;
    
    for (let i = 0; i < operators.length; i++) {
      const nextNum = parseNumberWithSuffix(parts[i + 1]);
      if (nextNum === null) break;
      
      const op = operators[i];
      if (op === '+') result += nextNum;
      else if (op === '-') result -= nextNum;
      else if (op === '*') result *= nextNum;
      else if (op === '/') {
        if (nextNum === 0) return 0;
        result = result / nextNum;
      }
    }
    
    return result;
  };

  useEffect(() => {
    setRawInput(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);

  const evaluateAndFormat = (input: string) => {
    const result = evaluateExpression(input);
    if (result !== null) {
      const formatted = new Intl.NumberFormat('id-ID').format(result);
      onChange(formatted);
      setRawInput(formatted);
    } else if (input === '') {
      onChange('');
      setRawInput('');
    }
  };

  const parseInstant = (input: string): string | null => {
    const hasOperator = /[+\-*/]/.test(input);
    if (hasOperator) return null;
    
    const cleaned = input.replace(/\s+/g, '').replace(/[^\d.kKmMbB]/g, '');
    if (!cleaned) return null;
    
    const suffixMatch = cleaned.match(/^(\d*\.?\d+)([kmb])$/i);
    if (suffixMatch) {
      const num = parseFloat(suffixMatch[1]);
      const suffix = suffixMatch[2].toLowerCase();
      let multiplier = 1;
      if (suffix === 'k') multiplier = 1000;
      else if (suffix === 'm') multiplier = 1000000;
      else if (suffix === 'b') multiplier = 1000000000;
      const result = Math.round(num * multiplier);
      return new Intl.NumberFormat('id-ID').format(result);
    }
    
    const numericStr = cleaned.replace(/\./g, '');
    const num = parseFloat(numericStr);
    if (isNaN(num)) return null;
    return new Intl.NumberFormat('id-ID').format(num);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    setRawInput(input);
    
    // Clear any pending debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    const result = parseInstant(input);
    if (result) {
      onChange(result);
      setRawInput(result);
    }
    
    // Debounce evaluation for expressions with operators
    const hasOperator = /[+\-*/]/.test(input);
    if (hasOperator) {
      const timer = setTimeout(() => {
        evaluateAndFormat(input);
      }, 1000);
      setDebounceTimer(timer);
    }
  };

  const hasOperator = (str: string) => /[+\-*/]/.test(str);

  const handleBlur = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (hasOperator(rawInput)) {
      evaluateAndFormat(rawInput);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (hasOperator(rawInput)) {
        evaluateAndFormat(rawInput);
      }
      inputRef.current?.blur();
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-bold uppercase tracking-widest text-[var(--color-muted)]"
        >
          {label}
          {required && <span className="text-[var(--color-danger)] ml-1">*</span>}
        </label>
      )}
      <div className="relative flex items-baseline gap-2 min-w-0">
        <span className="text-2xl sm:text-3xl font-headline font-bold text-[var(--color-accent)] shrink-0">
          {currencySymbol}
        </span>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={rawInput}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={errorId}
          className={cn(
            'font-headline font-extrabold w-full min-w-0 leading-none bg-transparent border-none focus:ring-0 p-0 placeholder:text-[var(--ref-surface-container-highest)] text-[var(--color-text-primary)]',
            sizeClasses[size]
          )}
        />
      </div>
      {showDivider && (
        <div className="h-px w-full bg-[var(--ref-surface-container-highest)]" />
      )}
      {error && (
        <p id={errorId} className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
