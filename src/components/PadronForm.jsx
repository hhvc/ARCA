import { useState } from "react";
import { getPadron } from "../services/afipApi";

export default function PadronForm() {
  const [cuit, setCuit] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleSearch = async () => {
    if (!cuit) return alert("Ingresá un CUIT");
    setLoading(true);
    setResult(null);
    try {
      const res = await getPadron(cuit);
      setResult(res.data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card shadow-sm p-4">
      <h5>Consulta de Padrón AFIP</h5>
      <div className="input-group my-3">
        <input
          type="text"
          className="form-control"
          placeholder="CUIT (sin guiones)"
          value={cuit}
          onChange={(e) => setCuit(e.target.value)}
        />
        <button
          className="btn btn-success"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "Buscando..." : "Consultar"}
        </button>
      </div>
      {result && (
        <pre className="bg-light mt-3 p-2 small rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
