await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: data.text }),
});
