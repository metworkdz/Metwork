'use client';

/**
 * Generic multi-select: selected values render as removable chips, and a
 * dropdown checkbox list (built on the existing DropdownMenu primitive)
 * offers the rest. Option-list agnostic — callers decide what belongs in
 * `options` (e.g. excluding already-retired choices from new selection
 * while still resolving their label for an existing chip).
 */
import { ChevronDown, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from './dropdown-menu';
import { Badge } from './badge';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  triggerId?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  disabled,
  triggerId,
}: MultiSelectProps) {
  function toggle(optionValue: string) {
    onChange(
      value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue],
    );
  }

  function remove(optionValue: string) {
    onChange(value.filter((v) => v !== optionValue));
  }

  const selected = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is MultiSelectOption => !!o);

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <Badge key={o.value} className="gap-1 pe-1">
              {o.label}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(o.value)}
                  aria-label={o.label}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            id={triggerId}
            type="button"
            disabled={disabled}
            className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-muted-foreground">{placeholder}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-64 w-[--radix-dropdown-menu-trigger-width] overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</div>
          ) : (
            options.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.value}
                checked={value.includes(o.value)}
                onSelect={(e) => {
                  e.preventDefault();
                  toggle(o.value);
                }}
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
