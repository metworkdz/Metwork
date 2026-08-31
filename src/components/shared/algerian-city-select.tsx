'use client';

/**
 * Reusable dropdown for Algerian wilayas.
 * Used in space, program, and event creation/edit forms, and the consultant
 * portal's profile settings.
 *
 * The VALUE is always the stable `city.code` ('algiers'); only the label is
 * localized — so switching UI language never rewrites stored data. Labels used
 * to be hardcoded French, which read badly in the Arabic portal.
 */
import { useLocale } from 'next-intl';
import { algerianCities, getCityName } from '@/config/cities';
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
  const locale = useLocale() as 'en' | 'fr' | 'ar';
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {algerianCities.map((city) => (
          <SelectItem key={city.code} value={city.code}>
            {getCityName(city.code, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
