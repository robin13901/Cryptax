interface YearSelectorProps {
  years: number[];
  selected: number;
  onChange: (year: number) => void;
}

export function YearSelector({ years, selected, onChange }: YearSelectorProps) {
  if (years.length === 0) {
    return (
      <select
        className="year-selector"
        disabled
        aria-label="Steuerjahr auswählen"
      >
        <option>Keine Daten</option>
      </select>
    );
  }

  return (
    <select
      className="year-selector"
      value={selected}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Steuerjahr auswählen"
    >
      {years.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  );
}
