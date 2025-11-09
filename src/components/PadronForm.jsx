// src/components/PadronForm.js
import { useState, useEffect } from "react";
import {
  getPadron,
  setEnvironment,
  getCurrentEnvironment,
} from "../services/afipApi";
import ResultViewer from "./ResultViewer";

export default function PadronForm({ service = "a4" }) {
  const [cuit, setCuit] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [isProduction, setIsProduction] = useState(false);

  // Solo permitir cambio de entorno para A13
  const canChangeEnvironment = service === "A13";

  useEffect(() => {
    if (canChangeEnvironment) {
      // Inicializar con el entorno actual
      setIsProduction(getCurrentEnvironment() === "prod");
    }
  }, [canChangeEnvironment]);

  const handleEnvironmentChange = (isProd) => {
    setIsProduction(isProd);
    setEnvironment(isProd ? "prod" : "homo");
  };

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
        environment: getCurrentEnvironment(),
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
          description:
            "Consulta básica autorizada - " +
            (isProduction ? "PRODUCCIÓN" : "HOMOLOGACIÓN"),
          placeholder: "CUIT (11 dígitos sin guiones)",
        };
      case "a4":
      default:
        return {
          title: "Padrón a4",
          description: "Consulta completa - Solo homologación",
          placeholder: "CUIT (11 dígitos sin guiones)",
        };
    }
  };

  const serviceInfo = getServiceInfo();

  return (
    <div>
      {/* Selector de entorno solo para A13 */}
      {canChangeEnvironment && (
        <div className="mb-3">
          <label className="form-label small">Entorno:</label>
          <div className="form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="environmentSwitch"
              checked={isProduction}
              onChange={(e) => handleEnvironmentChange(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="environmentSwitch">
              {isProduction ? (
                <span className="text-success fw-bold">Producción</span>
              ) : (
                <span className="text-warning">Homologación</span>
              )}
            </label>
          </div>
          <small className="text-muted">
            {isProduction
              ? "Consultando datos reales de producción"
              : "Consultando datos de prueba (homologación)"}
          </small>
        </div>
      )}

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

      <ResultViewer
        result={result}
        service={service}
        environment={getCurrentEnvironment()}
      />
    </div>
  );
}
