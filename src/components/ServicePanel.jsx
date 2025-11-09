import { useState } from "react";
import PadronForm from "./PadronForm";

export default function ServicePanel() {
  const [activeService, setActiveService] = useState("padron13");

  const services = [
    {
      id: "padron13",
      name: "Padrón A13",
      description: "Consulta básica de datos del contribuyente",
      status: "active",
      color: "success",
    },
    {
      id: "padron14",
      name: "Padrón a4",
      description: "Consulta completa de datos del contribuyente",
      status: "homo-only",
      color: "warning",
    },
    {
      id: "constancia",
      name: "Constancia de Inscripción",
      description: "Constancia oficial de inscripción",
      status: "coming-soon",
      color: "secondary",
    },
    {
      id: "factura",
      name: "Factura Electrónica",
      description: "Emisión de comprobantes electrónicos",
      status: "coming-soon",
      color: "secondary",
    },
  ];

  const getStatusBadge = (status) => {
    switch (status) {
      case "active":
        return <span className="badge bg-success">Disponible</span>;
      case "homo-only":
        return <span className="badge bg-warning text-dark">Solo HOMO</span>;
      case "coming-soon":
        return <span className="badge bg-secondary">Próximamente</span>;
      default:
        return null;
    }
  };

  return (
    <div className="card shadow-sm">
      <div className="card-header bg-dark text-white">
        <h5 className="mb-0">Servicios ARCA</h5>
      </div>
      <div className="card-body p-0">
        {/* Navegación de servicios */}
        <div className="border-bottom">
          {services.map((service) => (
            <button
              key={service.id}
              className={`btn w-100 text-start rounded-0 border-0 ${
                activeService === service.id
                  ? `btn-${service.color} text-white`
                  : "btn-light"
              }`}
              onClick={() => setActiveService(service.id)}
              disabled={service.status === "coming-soon"}
            >
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <strong>{service.name}</strong>
                  <br />
                  <small className="opacity-75">{service.description}</small>
                </div>
                {getStatusBadge(service.status)}
              </div>
            </button>
          ))}
        </div>

        {/* Panel de contenido */}
        <div className="p-3">
          {activeService === "padron13" && (
            <div>
              <h6>Consulta Padrón A13</h6>
              <p className="text-muted small mb-3">
                Servicio autorizado - Consulta básica de datos del contribuyente
              </p>
              <PadronForm service="A13" />
            </div>
          )}

          {activeService === "padron14" && (
            <div>
              <h6>Consulta Padrón a4</h6>
              <p className="text-muted small mb-3">
                Solo disponible en entorno de homologación - Consulta completa
                de datos
              </p>
              <PadronForm service="a4" />
            </div>
          )}

          {activeService === "constancia" && (
            <div className="text-center py-4">
              <div className="text-muted">
                <i className="bi bi-tools fs-1"></i>
                <h5>En Desarrollo</h5>
                <p>
                  Servicio de Constancia de Inscripción - Próximamente
                  disponible
                </p>
              </div>
            </div>
          )}

          {activeService === "factura" && (
            <div className="text-center py-4">
              <div className="text-muted">
                <i className="bi bi-receipt fs-1"></i>
                <h5>En Desarrollo</h5>
                <p>Servicio de Factura Electrónica - Próximamente disponible</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
