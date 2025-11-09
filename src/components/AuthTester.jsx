// src/components/AuthTester.js
import { useState, useEffect } from "react";
import {
  testAutha4,
  testAuthA13,
  setEnvironment,
  getCurrentEnvironment,
} from "../services/afipApi";
import ResultViewer from "./ResultViewer";

export default function AuthTester() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedService, setSelectedService] = useState("a4");
  const [isProduction, setIsProduction] = useState(false);

  // Solo permitir cambio de entorno para A13
  const canChangeEnvironment = selectedService === "A13";

  useEffect(() => {
    if (canChangeEnvironment) {
      setIsProduction(getCurrentEnvironment() === "prod");
    }
  }, [canChangeEnvironment, selectedService]);

  const handleEnvironmentChange = (isProd) => {
    setIsProduction(isProd);
    setEnvironment(isProd ? "prod" : "homo");
  };

  const handleTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const testFunction =
        selectedService === "A13" ? testAuthA13 : testAutha4;
      const res = await testFunction();
      setResult(res);
    } catch (err) {
      setResult({
        error: err.message,
        service: selectedService,
        environment: getCurrentEnvironment(),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card shadow-sm p-4">
      <h5>Prueba de Autenticación (WSAA)</h5>
      <p className="text-muted small mb-3">
        Prueba la conexión con los servicios de AFIP
      </p>

      <div className="mb-3">
        <label className="form-label small">Seleccionar servicio:</label>
        <div className="btn-group w-100" role="group">
          <input
            type="radio"
            className="btn-check"
            name="serviceType"
            id="servicea4"
            checked={selectedService === "a4"}
            onChange={() => setSelectedService("a4")}
          />
          <label className="btn btn-outline-primary" htmlFor="servicea4">
            Padrón a4
          </label>

          <input
            type="radio"
            className="btn-check"
            name="serviceType"
            id="serviceA13"
            checked={selectedService === "A13"}
            onChange={() => setSelectedService("A13")}
          />
          <label className="btn btn-outline-success" htmlFor="serviceA13">
            Padrón A13
          </label>
        </div>
      </div>

      {/* Selector de entorno solo para A13 */}
      {canChangeEnvironment && (
        <div className="mb-3">
          <label className="form-label small">Entorno:</label>
          <div className="form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="environmentSwitchAuth"
              checked={isProduction}
              onChange={(e) => handleEnvironmentChange(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="environmentSwitchAuth">
              {isProduction ? (
                <span className="text-success fw-bold">Producción</span>
              ) : (
                <span className="text-warning">Homologación</span>
              )}
            </label>
          </div>
        </div>
      )}

      <button
        className="btn btn-primary w-100"
        onClick={handleTest}
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="spinner-border spinner-border-sm me-2" />
            Probando {selectedService}...
          </>
        ) : (
          `Probar Autenticación ${selectedService}`
        )}
      </button>

      <ResultViewer
        result={result}
        service={selectedService}
        environment={getCurrentEnvironment()}
      />
    </div>
  );
}
