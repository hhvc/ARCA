import { useState } from "react";
import { getPadron } from "../services/afipApi";
import ResultViewer from "./ResultViewer";

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
      setResult(res);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card shadow-sm p-4">
      <h5>Consulta de Padrón ARCA</h5>
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
      <ResultViewer result={result} />
    </div>
  );
}
