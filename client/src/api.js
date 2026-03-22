import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export async function fetchHome(language) {
  const { data } = await api.get('/home', { params: { language } });
  return data;
}

export async function fetchMovie(movieId, language) {
  const { data } = await api.get(`/movie/${movieId}`, { params: { language } });
  return data.movie;
}

export async function searchMovies(query, language) {
  if (!query.trim()) {
    return [];
  }

  const { data } = await api.get('/search', {
    params: {
      query,
      language,
    },
  });

  return data.results || [];
}
