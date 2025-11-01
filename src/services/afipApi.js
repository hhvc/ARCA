import axios from "axios";

// 🔧 Ajustá esto con tu endpoint de Cloud Functions
const BASE_URL = "https://southamerica-south1-tu-proyecto.cloudfunctions.net";

export async function testAuth() {
  return axios.get(`${BASE_URL}/afipAuth`);
}

export async function getPadron(cuit) {
  return axios.get(`${BASE_URL}/afipPadron?cuit=${cuit}`);
}
