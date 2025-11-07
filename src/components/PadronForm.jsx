import { useState } from "react";
import { getPadron } from "../services/afipApi";
import ResultViewer from "./ResultViewer";

export default function PadronForm({ service = "A14" }) {
  const [cuit, setCuit] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleSearch = async () => {
    if (!cuit) return alert("Ingresá un CUIT");

    // Validar formato de CUIT
    if (!/^\d{11}$/.test(cuit)) {
      return alert("El CUIT debe tener 11 dígitos numéricos");
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await getPadron(cuit, service);
      setResult(res);
    } catch (err) {
      setResult({
        error: err.message,
        service: service,
      });
    } finally {
      setLoading(false);
    }
  };

  const getServiceInfo = () => {
    switch (service) {
      case "A13":
        return {
          title: "Padrón A13",
          description: "Consulta básica autorizada",
          placeholder: "CUIT (11 dígitos sin guiones)",
        };
      case "A14":
      default:
        return {
          title: "Padrón A14",
          description: "Consulta completa - Solo homologación",
          placeholder: "CUIT (11 dígitos sin guiones)",
        };
    }
  };

  const serviceInfo = getServiceInfo();

  return (
    <div>
      <div className="input-group mb-3">
        <input
          type="text"
          className="form-control"
          placeholder={serviceInfo.placeholder}
          value={cuit}
          onChange={(e) => setCuit(e.target.value.replace(/\D/g, ""))}
          maxLength="11"
        />
        <button
          className={`btn ${service === "A13" ? "btn-success" : "btn-warning"}`}
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Consultando...
            </>
          ) : (
            `Consultar ${service}`
          )}
        </button>
      </div>

      <div className="mb-3">
        <small className="text-muted">{serviceInfo.description}</small>
      </div>

      <ResultViewer result={result} service={service} />
    </div>
  );
}
