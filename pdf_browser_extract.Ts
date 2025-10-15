import * as pdfjsLib from 'pdfjs-dist';

const fileReader = new FileReader();
fileReader.onload = async () => {
  const typedArray = new Uint8Array(fileReader.result as ArrayBuffer);
  const pdf = await pdfjsLib.getDocument(typedArray).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ');
  }
};
fileReader.readAsArrayBuffer(file);
