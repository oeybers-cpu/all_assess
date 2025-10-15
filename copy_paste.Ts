// Extracted text from PDF
const assignmentText = "This is the full assignment content...";

// Send to your API
await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: assignmentText }),
});

