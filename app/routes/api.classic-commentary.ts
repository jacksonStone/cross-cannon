import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { readWorkIndex } from "~/features/work-reader/route.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const book = url.searchParams.get("book") ?? "";
  const chapter = Number(url.searchParams.get("chapter"));
  if (
    !book ||
    book.length > 40 ||
    !Number.isInteger(chapter) ||
    chapter < 1 ||
    chapter > 151
  )
    return json(
      { error: "Choose a Bible chapter.", version: "", works: [] },
      { status: 400 }
    );
  const { bookIndex, manifest } = await readWorkIndex("classics");
  const works = bookIndex.books.flatMap((work) =>
    work.chapters
      .filter(
        (entry) =>
          entry.scriptureReference?.book === book &&
          entry.scriptureReference.chapter === chapter
      )
      .map((entry) => ({
        id: work.id,
        title: work.name,
        author: work.author,
        tradition: work.metadata.tradition ?? "",
        chapter: entry,
      }))
  );
  return json(
    {
      error: null,
      version: manifest.version ?? "christian-classics-v1",
      works,
    },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
