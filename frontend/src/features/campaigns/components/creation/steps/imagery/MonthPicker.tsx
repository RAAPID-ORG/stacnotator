const MONTHS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => currentYear - 15 + i); // 15 years back, 15 forward

interface MonthPickerProps {
  /** Value in YYYY-MM format (e.g. "2024-06") */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export const MonthPicker = ({ value, onChange, disabled, className }: MonthPickerProps) => {
  const [year, month] = value ? value.split('-') : ['', ''];

  const handleMonth = (m: string) => {
    const y = year || String(currentYear);
    onChange(`${y}-${m}`);
  };

  const handleYear = (y: string) => {
    const m = month || '01';
    onChange(`${y}-${m}`);
  };

  const selectClass = `h-8 px-2 text-sm border border-neutral-300 rounded-md bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none cursor-pointer transition-colors ${
    disabled ? 'bg-neutral-50 text-neutral-400 cursor-not-allowed' : ''
  } ${className ?? ''}`;

  return (
    <div className="flex gap-1.5 items-end">
      <select
        value={month}
        onChange={(e) => handleMonth(e.target.value)}
        disabled={disabled}
        className={`${selectClass} w-[4.5rem]`}
      >
        <option value="" disabled>
          Mon
        </option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => handleYear(e.target.value)}
        disabled={disabled}
        className={`${selectClass} w-[5rem]`}
      >
        <option value="" disabled>
          Year
        </option>
        {YEARS.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
};
