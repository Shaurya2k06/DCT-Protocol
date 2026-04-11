/** Base URL for the DCT API (must match `cd server && npm start`). */
export const DCT_API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
