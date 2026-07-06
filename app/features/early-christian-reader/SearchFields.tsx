import type { CanonMode } from "~/features/search/types";

export function EarlyChristianAuthorInputs({ authors }: { authors: string[] }) {
  return (
    <>
      {authors.map((author) => (
        <input key={author} type="hidden" name="authors" value={author} />
      ))}
    </>
  );
}

export function ChurchFathersScriptureFilterInputs({
  books,
  canon
}: {
  books: string[];
  canon: CanonMode;
}) {
  return (
    <>
      <input type="hidden" name="canon" value={canon} />
      {books.map((book) => (
        <input key={book} type="hidden" name="books" value={book} />
      ))}
    </>
  );
}
