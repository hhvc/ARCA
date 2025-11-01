import { useState } from "react";
import { testAuth } from "../services/afipApi";

export default function AuthTester() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await testAuth();
      setResult(res.data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card shadow-sm p-4">
      <h5>Prueba de Autenticación (WSAA)</h5>
      <p className="text-muted small mb-3">
        Llama a la Cloud Function que genera el token y sign desde AFIP.
      </p>
      <button
        className="btn btn-primary"
        onClick={handleTest}
        disabled={loading}
      >
        {loading ? "Probando..." : "Probar conexión"}
      </button>
      {result && (
        <pre className="bg-light mt-3 p-2 small rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
