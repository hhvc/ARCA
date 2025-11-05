import Navbar from "./components/Navbar";
import AuthTester from "./components/AuthTester";
import PadronForm from "./components/PadronForm";

export default function App() {
  return (
    <div>
      <Navbar />
      <div className="container py-4">
        <h3 className="mb-4 text-center">Panel de pruebas ARCA</h3>
        <div className="row g-4">
          <div className="col-md-6">
            <AuthTester />
          </div>
          <div className="col-md-6">
            <PadronForm />
          </div>
        </div>
      </div>
    </div>
  );
}
