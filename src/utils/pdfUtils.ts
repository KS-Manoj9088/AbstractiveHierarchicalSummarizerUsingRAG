import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function processPdf(file: File): Promise<{ text: string, previewDataUrl: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  let previewDataUrl = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;

    // Generate preview for the first page
    if (i === 1) {
      const viewport = page.getViewport({ scale: 1.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext: any = {
          canvasContext: context,
          viewport: viewport,
        };
        await page.render(renderContext).promise;
        previewDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      }
    }
  }

  return {
    text: fullText,
    previewDataUrl
  };
}
