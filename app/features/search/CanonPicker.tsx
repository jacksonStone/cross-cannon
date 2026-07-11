import { parseCanonMode } from "./canons";
import type { CanonMode } from "./types";

type CanonPickerProps = {
  canon: CanonMode;
  disabled?: boolean;
  onChange: (canon: CanonMode) => void;
};

export function CanonPicker({
  canon,
  disabled = false,
  onChange
}: CanonPickerProps) {
  return (
    <fieldset className="canon-control" disabled={disabled}>
      <legend>Canon</legend>
      <select
        aria-label="Canon"
        onChange={(event) => onChange(parseCanonMode(event.currentTarget.value))}
        value={canon}
      >
        <option value="protestant">Protestant</option>
        <option value="catholic">Catholic</option>
        <option value="orthodox">Orthodox</option>
      </select>
    </fieldset>
  );
}
