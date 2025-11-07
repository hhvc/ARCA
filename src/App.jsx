import Navbar from "./components/Navbar";
import AuthTester from "./components/AuthTester";
import ServicePanel from "./components/ServicePanel";

export default function App() {
  return (
    <div>
      <Navbar />
      <div className="container py-4">
        <h3 className="mb-4 text-center">Panel de Servicios ARCA</h3>
        <div className="row g-4">
          <div className="col-md-6">
            <AuthTester />
          </div>
          <div className="col-md-6">
            <ServicePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
