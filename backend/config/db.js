const { Pool } = require('pg');
require('dotenv').config();

// CORRECTION (décalage de date) : sans réglage explicite, PostgreSQL utilise
// le fuseau horaire du serveur (souvent UTC), ce qui fait que now()/now()::date
// peut désigner "hier" ou "demain" par rapport à l'heure locale tunisienne
// selon l'heure d'exécution — ex. le graphe "7 derniers jours" n'affichait
// pas la journée en cours. On force le fuseau de la session à la connexion,
// pour que tous les now()/CURRENT_DATE du code soient alignés sur l'heure
// locale (Africa/Tunis, UTC+1 toute l'année, pas de changement d'heure d'été).
//
// Passé en paramètre de démarrage de connexion (options `-c timezone=...`)
// plutôt qu'en requête `SET TIME ZONE` post-connexion via pool.on('connect') :
// cette dernière approche est asynchrone et pas garantie de se terminer avant
// la première requête applicative sur le même client, ce qui provoquait le
// warning pg "client.query() when the client is already executing a query".
// Le paramètre de démarrage est appliqué par Postgres avant que le client ne
// soit rendu disponible au pool — aucune requête supplémentaire, aucune race.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  options: '-c timezone=Africa/Tunis',
});

module.exports = pool;