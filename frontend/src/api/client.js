import axios from 'axios';

const client = axios.create({
  baseURL: 'http://localhost:4000',
  withCredentials: true, // indispensable pour envoyer/recevoir le cookie httpOnly
});



export default client;