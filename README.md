# CineVerse MERN - Multi-Language Movie Trailer App

A full-stack MERN application to browse live movie details and watch trailers in multiple languages (English, Hindi, Tamil, Telugu, Malayalam).

Home listings, movie details, and trailer playback are fetched from TMDB with language-aware metadata.

## Free APIs you can use

1. TMDB API (home rows, details, videos)
- Free API key available with generous limits for hobby projects.
- Website: https://www.themoviedb.org/documentation/api

2. OMDb API (optional legacy source)
- Website: https://www.omdbapi.com/

## Project Structure

- client: React + Vite + Tailwind CSS frontend
- server: Node.js + Express API layer

## Setup

### 1) Backend setup

```bash
cd server
copy .env.example .env
```

Update `.env` and set your API keys:

```env
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=optional_legacy_key
YOUTUBE_API_KEY=optional_legacy_key
```

Install dependencies and run server:

```bash
npm install
npm run dev
```

Server runs on http://localhost:5000

### 2) Frontend setup

```bash
cd client
copy .env.example .env
npm install
npm run dev
```

Frontend runs on http://localhost:5173

## Features

- Multi-language movie browsing
- Hero spotlight from TMDB latest movies
- Latest, popular, and top-rated rows from TMDB
- Movie search
- Movie details page powered by TMDB metadata
- Trailer playback powered by TMDB video selection

## API Endpoints

- `GET /api/health`
- `GET /api/languages`
- `GET /api/home?language=telugu`
- `GET /api/search?query=rrr&language=hindi`
- `GET /api/movie/:id?language=tamil`
- `GET /api/movie/:id/trailer?language=english`
