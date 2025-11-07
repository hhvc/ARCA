import { useState } from "react";
import { testAuthA14, testAuthA13 } from "../services/afipApi";
import ResultViewer from "./ResultViewer";

export default function AuthTester() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedService, setSelectedService] = useState("A14");

  const handleTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const testFunction =
        selectedService === "A13" ? testAuthA13 : testAuthA14;
      const res = await testFunction();
      setResult(res);
    } catch (err) {
      setResult({
        error: err.message,
        service: selectedService,
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
            id="serviceA14"
            checked={selectedService === "A14"}
            onChange={() => setSelectedService("A14")}
          />
          <label className="btn btn-outline-primary" htmlFor="serviceA14">
            Padrón A14
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

      <ResultViewer result={result} service={selectedService} />
    </div>
  );
}
