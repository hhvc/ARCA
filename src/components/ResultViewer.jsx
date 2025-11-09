// src/components/ResultViewer.js
export default function ResultViewer({
  result,
  service,
  environment = "homo",
}) {
  if (!result) return null;

  if (result.error) {
    return (
      <div className="alert alert-danger mt-3">
        <strong>
          Error en {service || "servicio"} ({environment.toUpperCase()}):
        </strong>
        <div className="mt-2 small">{result.error}</div>
        {result.error.includes("no autorizado") && (
          <div className="mt-2 small text-muted">
            ⚠️ El servicio puede no estar autorizado en el entorno actual
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="alert alert-success">
        <strong>
          ✅ Consulta exitosa - {service || "Servicio"} (
          {environment.toUpperCase()})
        </strong>
      </div>
      <div className="bg-light p-3 rounded small">
        <pre className="mb-0 text-break">{JSON.stringify(result, null, 2)}</pre>
      </div>
    </div>
  );
}
