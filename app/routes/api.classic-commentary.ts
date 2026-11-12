import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { readWorkIndex } from "~/features/work-reader/route.server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChapterAsset } from "~/features/early-christian-reader/types";
import { relatedCommentaryPassages } from "~/features/christian-classics/commentary-passages";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const book = url.searchParams.get("book") ?? "";
  const chapter = Number(url.searchParams.get("chapter"));
  const verseStart = Number(url.searchParams.get("verseStart") ?? 1);
  const verseEnd = Number(url.searchParams.get("verseEnd") ?? 1000);
  if (
    !book ||
    book.length > 40 ||
    !Number.isInteger(chapter) ||
    chapter < 1 ||
    chapter > 151 ||
    !Number.isInteger(verseStart) ||
    verseStart < 1 ||
    !Number.isInteger(verseEnd) ||
    verseEnd < verseStart ||
    verseEnd > 1000
  )
    return json(
      {
        error: "Choose a Bible chapter and verse range.",
        version: "",
        works: [],
      },
      { status: 400 }
    );
  const { bookIndex, manifest } = await readWorkIndex("classics");
  const candidates = bookIndex.books.flatMap((work) =>
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
  const works = (
    await Promise.all(
      candidates.map(async (work) => {
        const asset: ChapterAsset = JSON.parse(
          await readFile(
            path.join(process.cwd(), "public", work.chapter.assetPath),
            "utf8"
          )
        );
        return relatedCommentaryPassages(asset, verseStart, verseEnd).length
          ? work
          : null;
      })
    )
  ).filter((work): work is NonNullable<typeof work> => work !== null);
  return json(
    {
      error: null,
      version: manifest.version ?? "christian-classics-v1",
      works,
    },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
