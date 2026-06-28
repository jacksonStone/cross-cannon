const AUDIO_BASE_URL = "https://audiotreasure.com/content/WEBD_AT";
const AUDIO_SOURCE = "AudioTreasure WEB";

type AudioBook = {
  book: string;
  chapters: number;
  stem: string;
  chapterDigits?: number;
  singleChapterNoSuffix?: boolean;
  fileNameForChapter?: (chapter: number) => string;
};

export type AudioChapterFile = {
  book: string;
  chapter: number;
  source: string;
  fileName: string;
  filePath: string;
  audioUrl: string;
};

const AUDIO_BOOKS: AudioBook[] = [
  { book: "Genesis", chapters: 50, stem: "01_Genesis" },
  { book: "Exodus", chapters: 40, stem: "02_Exodus" },
  { book: "Leviticus", chapters: 27, stem: "03_Leviticus" },
  { book: "Numbers", chapters: 36, stem: "04_Numbers" },
  { book: "Deuteronomy", chapters: 34, stem: "05_Deuteronomy" },
  { book: "Joshua", chapters: 24, stem: "06_Joshua" },
  { book: "Judges", chapters: 21, stem: "07_Judges" },
  { book: "Ruth", chapters: 4, stem: "08_Ruth" },
  { book: "1 Samuel", chapters: 31, stem: "09_1Samuel" },
  { book: "2 Samuel", chapters: 24, stem: "10_2Samuel" },
  { book: "1 Kings", chapters: 22, stem: "11_1Kings" },
  { book: "2 Kings", chapters: 25, stem: "12_2Kings" },
  { book: "1 Chronicles", chapters: 29, stem: "13_1Chronicles" },
  { book: "2 Chronicles", chapters: 36, stem: "14_2Chronicles" },
  { book: "Ezra", chapters: 10, stem: "15_Ezra" },
  { book: "Nehemiah", chapters: 13, stem: "16_Nehemiah" },
  { book: "Esther", chapters: 10, stem: "17_Esther" },
  { book: "Job", chapters: 42, stem: "18_Job" },
  { book: "Psalms", chapters: 150, stem: "19_Psalm", chapterDigits: 3 },
  { book: "Proverbs", chapters: 31, stem: "20_Prov" },
  { book: "Ecclesiastes", chapters: 12, stem: "21_Ecclesiastes" },
  { book: "Song of Songs", chapters: 8, stem: "22_Song_of_Solomon" },
  { book: "Isaiah", chapters: 66, stem: "23_Isaiah" },
  { book: "Jeremiah", chapters: 52, stem: "24_Jeremiah" },
  {
    book: "Lamentations",
    chapters: 5,
    stem: "25_Lam",
    fileNameForChapter: (chapter) => `25_Lam${chapter}.mp3`
  },
  { book: "Ezekiel", chapters: 48, stem: "26_Ezekiel" },
  { book: "Daniel", chapters: 12, stem: "27_Daniel" },
  { book: "Hosea", chapters: 14, stem: "28_Hosea" },
  { book: "Joel", chapters: 3, stem: "29_Joel" },
  { book: "Amos", chapters: 9, stem: "30_Amos" },
  { book: "Obadiah", chapters: 1, stem: "31_Obadiah", singleChapterNoSuffix: true },
  { book: "Jonah", chapters: 4, stem: "32_Jonah" },
  { book: "Micah", chapters: 7, stem: "33_Micah" },
  { book: "Nahum", chapters: 3, stem: "34_Nahum" },
  { book: "Habakkuk", chapters: 3, stem: "35_Habakkuk" },
  { book: "Zephaniah", chapters: 3, stem: "36_Zephaniah" },
  { book: "Haggai", chapters: 2, stem: "37_Haggai" },
  { book: "Zechariah", chapters: 14, stem: "38_Zechariah" },
  { book: "Malachi", chapters: 4, stem: "39_Malachi" },
  { book: "Matthew", chapters: 28, stem: "40_Matt" },
  { book: "Mark", chapters: 16, stem: "41_Mark" },
  { book: "Luke", chapters: 24, stem: "42_Luke" },
  { book: "John", chapters: 21, stem: "43_John" },
  { book: "Acts", chapters: 28, stem: "44_Acts" },
  { book: "Romans", chapters: 16, stem: "45_Romans" },
  { book: "1 Corinthians", chapters: 16, stem: "46_1Cor" },
  { book: "2 Corinthians", chapters: 13, stem: "47_2Cor" },
  { book: "Galatians", chapters: 6, stem: "48_Gal" },
  { book: "Ephesians", chapters: 6, stem: "49_Ephesians" },
  { book: "Philippians", chapters: 4, stem: "50_Philippians" },
  { book: "Colossians", chapters: 4, stem: "51_Colossians" },
  { book: "1 Thessalonians", chapters: 5, stem: "52_1Thessa" },
  { book: "2 Thessalonians", chapters: 3, stem: "53_2Thessa" },
  { book: "1 Timothy", chapters: 6, stem: "54_1Timothy" },
  { book: "2 Timothy", chapters: 4, stem: "55_2Timothy" },
  { book: "Titus", chapters: 3, stem: "56_Titus" },
  { book: "Philemon", chapters: 1, stem: "57_Philemon", singleChapterNoSuffix: true },
  { book: "Hebrews", chapters: 13, stem: "58_Hebrews" },
  { book: "James", chapters: 5, stem: "59_James" },
  { book: "1 Peter", chapters: 5, stem: "60_1Peter" },
  { book: "2 Peter", chapters: 3, stem: "61_2Peter" },
  { book: "1 John", chapters: 5, stem: "62_1John" },
  { book: "2 John", chapters: 1, stem: "63_2John", singleChapterNoSuffix: true },
  { book: "3 John", chapters: 1, stem: "64_3John", singleChapterNoSuffix: true },
  { book: "Jude", chapters: 1, stem: "65_Jude", singleChapterNoSuffix: true },
  { book: "Revelation", chapters: 22, stem: "66_Revelation" }
];

export function buildAudioChapterFiles() {
  const rows: AudioChapterFile[] = [];

  for (const audioBook of AUDIO_BOOKS) {
    for (let chapter = 1; chapter <= audioBook.chapters; chapter += 1) {
      const fileName = getFileName(audioBook, chapter);
      const filePath = `/content/WEBD_AT/${fileName}`;

      rows.push({
        book: audioBook.book,
        chapter,
        source: AUDIO_SOURCE,
        fileName,
        filePath,
        audioUrl: `${AUDIO_BASE_URL}/${fileName}`
      });
    }
  }

  return rows;
}

function getFileName(audioBook: AudioBook, chapter: number) {
  if (audioBook.fileNameForChapter) {
    return audioBook.fileNameForChapter(chapter);
  }

  if (audioBook.singleChapterNoSuffix) {
    return `${audioBook.stem}.mp3`;
  }

  const digits = audioBook.chapterDigits ?? 2;
  return `${audioBook.stem}_${String(chapter).padStart(digits, "0")}.mp3`;
}
