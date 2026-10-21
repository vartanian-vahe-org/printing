import { useEffect, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL;

export function App() {
  const [health, setHealth] = useState('Loading...');

  useEffect(() => {
    if (!apiUrl) {
      setHealth('VITE_API_URL is not set');
      return;
    }
    fetch(`${apiUrl}/health`)
      .then((res) => res.json())
      .then((data) => setHealth(JSON.stringify(data, null, 2)))
      .catch((err: unknown) => setHealth(`API unreachable: ${String(err)}`));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Printing Admin</h1>
      <p>Admin placeholder. Login and catalog setup come in later steps.</p>
      <h2>API health</h2>
      <pre>{health}</pre>
    </main>
  );
}
