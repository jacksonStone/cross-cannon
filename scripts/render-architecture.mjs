import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PNG } from "pngjs";

const docsDir = path.join(process.cwd(), "docs");
const puppeteerConfig = path.join(docsDir, "mermaid-puppeteer-config.json");
const diagrams = [
  ["Runtime Architecture", "runtime-architecture"],
  ["Scripture Readiness", "scripture-readiness"],
  ["Search Flow", "search-flow"],
  ["Reader Flow", "reader-flow"],
  ["Build, Deploy, And Verification", "build-deploy-verify"]
];

mkdirSync(docsDir, { recursive: true });

for (const [, name] of diagrams) {
  renderMermaid(name);
}

function renderMermaid(name) {
  const input = path.join(docsDir, `${name}.mmd`);
  const output = path.join(docsDir, `${name}.png`);
  const result = spawnSync(
    "npx",
    [
      "mmdc",
      "-p",
      puppeteerConfig,
      "-i",
      input,
      "-o",
      output,
      "-b",
      "white",
      "-s",
      "2"
    ],
    {
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function combinePngs() {
  const padding = 48;
  const titleHeight = 72;
  const sectionGap = 36;
  const titleBarHeight = 70;
  const diagramsWithImages = diagrams.map(([title, name]) => ({
    image: PNG.sync.read(readFileSync(path.join(docsDir, `${name}.png`))),
    title
  }));
  const width = Math.max(...diagramsWithImages.map(({ image }) => image.width))
    + padding * 2;
  const height = titleHeight
    + padding
    + diagramsWithImages.reduce(
      (sum, { image }) => sum + titleBarHeight + image.height + sectionGap,
      0
    )
    + padding;
  const combined = new PNG({ width, height });

  fill(combined, 246, 244, 238, 255);
  drawTextBlock(combined, "Cross Cannon Architecture", padding, 30, 42);

  let y = titleHeight + padding;

  for (const { image, title } of diagramsWithImages) {
    fillRect(combined, padding / 2, y - 20, width - padding, titleBarHeight + image.height + 28, 255, 255, 255, 255);
    fillRect(combined, padding / 2, y - 20, width - padding, 1, 216, 213, 202, 255);
    fillRect(combined, padding / 2, y + titleBarHeight + image.height + 7, width - padding, 1, 216, 213, 202, 255);
    drawTextBlock(combined, title, padding, y, 26);
    paste(combined, image, padding, y + titleBarHeight);
    y += titleBarHeight + image.height + sectionGap;
  }

  writeFileSync(
    path.join(docsDir, "cross-cannon-architecture.png"),
    PNG.sync.write(combined)
  );
  console.info("Rendered docs/cross-cannon-architecture.png");
}

function paste(target, source, offsetX, offsetY) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceIndex = (source.width * y + x) << 2;
      const targetIndex = (target.width * (offsetY + y) + offsetX + x) << 2;
      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
}

function fill(image, red, green, blue, alpha) {
  fillRect(image, 0, 0, image.width, image.height, red, green, blue, alpha);
}

function fillRect(image, x, y, width, height, red, green, blue, alpha) {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(image.width, x + width);
  const endY = Math.min(image.height, y + height);

  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      const index = (image.width * row + column) << 2;
      image.data[index] = red;
      image.data[index + 1] = green;
      image.data[index + 2] = blue;
      image.data[index + 3] = alpha;
    }
  }
}

function drawTextBlock(image, text, x, y, size) {
  const scale = Math.max(2, Math.round(size / 12));
  const glyphWidth = 5 * scale;
  const glyphGap = scale * 2;
  let cursorX = x;

  for (const character of text.toUpperCase()) {
    if (character === " ") {
      cursorX += glyphWidth + glyphGap;
      continue;
    }

    drawGlyph(image, character, cursorX, y, scale);
    cursorX += glyphWidth + glyphGap;
  }
}

function drawGlyph(image, character, x, y, scale) {
  const glyph = GLYPHS[character] ?? GLYPHS["?"];

  for (let row = 0; row < glyph.length; row += 1) {
    for (let column = 0; column < glyph[row].length; column += 1) {
      if (glyph[row][column] === "1") {
        fillRect(
          image,
          x + column * scale,
          y + row * scale,
          scale,
          scale,
          23,
          32,
          42,
          255
        );
      }
    }
  }
}

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"]
};

combinePngs();
