import pdfParse from 'pdf-parse';

const buffer = fs.readFileSync(filePath);
const data = await pdfParse(buffer);
console.log(data.text); // Send this to OpenAI
