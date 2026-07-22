import type { SelectHTMLAttributes } from 'react';
import { COLORMAPS, isColormapName, type ColormapName } from '../utils/customMapColormaps';

interface ColormapSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange'
> {
  value: ColormapName;
  onChange: (name: ColormapName) => void;
}

export function ColormapSelect({ value, onChange, ...rest }: ColormapSelectProps) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => {
        if (isColormapName(e.target.value)) onChange(e.target.value);
      }}
    >
      {COLORMAPS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
