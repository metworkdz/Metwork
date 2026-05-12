'use client';

/**
 * Reusable dropdown for Algerian wilayas.
 * Used in space, program, and event creation/edit forms.
 * Renders with the existing Radix Select UI component.
 */
import { algerianCities } from '@/config/cities';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AlgerianCitySelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}

export function AlgerianCitySelect({
  id,
  value,
  onChange,
  placeholder = 'Select a city…',
}: AlgerianCitySelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {algerianCities.map((city) => (
          <SelectItem key={city.code} value={city.code}>
            {city.nameFr}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
