type CheckboxPickerOption = {
  label: string;
  value: string;
};

type CheckboxPickerProps = {
  disabled?: boolean;
  hint: string;
  legend: string;
  maxSelected?: number;
  options: CheckboxPickerOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

export function CheckboxPicker({
  disabled = false,
  hint,
  legend,
  maxSelected,
  options,
  selectedValues,
  onToggle
}: CheckboxPickerProps) {
  const selectedSet = new Set(selectedValues);

  return (
    <fieldset className="book-picker" disabled={disabled}>
      <legend>{legend}</legend>
      <p className="book-picker-hint">{hint}</p>
      <div className="book-options">
        {options.map((option) => {
          const isSelected = selectedSet.has(option.value);
          const isDisabled = Boolean(
            maxSelected
            && !isSelected
            && selectedValues.length >= maxSelected
          );

          return (
            <label className="book-option" key={option.value}>
              <input
                checked={isSelected}
                disabled={isDisabled}
                onChange={() => onToggle(option.value)}
                type="checkbox"
                value={option.value}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
