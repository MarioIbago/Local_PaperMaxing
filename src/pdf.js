import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function extractPdfText(file, maxChars = 180000) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];
  let chars = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      const chunk = `\n\n--- PAGE ${pageNumber} ---\n${text}`;
      pages.push(chunk);
      chars += chunk.length;
    }

    if (chars >= maxChars) break;
  }

  return {
    text: pages.join("").slice(0, maxChars),
    pagesRead: Math.min(pdf.numPages, pages.length),
    totalPages: pdf.numPages,
    truncated: chars >= maxChars,
  };
}
