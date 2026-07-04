import { useId, useMemo, useState } from "react";

import { keywordMatches } from "./keyword-match";

type CheckboxPickerOption = {
  label: string;
  value: string;
};

type CheckboxPickerProps = {
  disabled?: boolean;
  hint: string;
  legend: string;
  maxVisibleOptions?: number;
  maxSelected?: number;
  options: CheckboxPickerOption[];
  searchable?: boolean;
  searchLabel?: string;
  searchPlaceholder?: string;
  selectedValues: string[];
  onToggle: (value: string) => void;
};

export function CheckboxPicker({
  disabled = false,
  hint,
  legend,
  maxVisibleOptions,
  maxSelected,
  options,
  searchable = false,
  searchLabel = "Filter",
  searchPlaceholder = "Search",
  selectedValues,
  onToggle
}: CheckboxPickerProps) {
  const searchInputId = useId();
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.value)),
    [options, selectedSet]
  );
  const matchingOptions = useMemo(() => {
    if (!searchable || query.trim().length === 0) {
      return options;
    }

    return options.filter((option) => (
      keywordMatches(query, `${option.label} ${option.value}`)
    ));
  }, [options, query, searchable]);
  const visibleOptions = useMemo(() => {
    const selectedOptionValues = new Set(selectedOptions.map((option) => option.value));
    const unselectedMatches = matchingOptions.filter(
      (option) => !selectedOptionValues.has(option.value)
    );
    const combinedOptions = searchable
      ? [...selectedOptions, ...unselectedMatches]
      : matchingOptions;

    if (!searchable || !maxVisibleOptions || combinedOptions.length <= maxVisibleOptions) {
      return combinedOptions;
    }

    return combinedOptions.slice(0, maxVisibleOptions);
  }, [matchingOptions, maxVisibleOptions, searchable, selectedOptions]);

  return (
    <fieldset className="book-picker" disabled={disabled}>
      <legend>{legend}</legend>
      <p className="book-picker-hint">{hint}</p>
      {searchable ? (
        <label className="book-picker-search" htmlFor={searchInputId}>
          <span>{searchLabel}</span>
          <input
            autoComplete="off"
            id={searchInputId}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={query}
          />
        </label>
      ) : null}
      {visibleOptions.length > 0 ? (
        <div className="book-options">
          {visibleOptions.map((option) => {
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
      ) : (
        <p className="book-picker-empty">No matches</p>
      )}
    </fieldset>
  );
}
