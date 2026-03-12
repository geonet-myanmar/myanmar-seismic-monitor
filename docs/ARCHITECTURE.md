# Architecture Notes

## Application Model

The dashboard is a browser-only React application served as static files. No backend service is required.

## Core Files

### `index.html`

- loads the application shell
- loads external CSS and CDN scripts
- mounts the React app into `#root`

### `app.js`

Contains:

- state management for boundary data, tectonic data, filters, sync state, and earthquakes
- USGS fetch logic
- Myanmar boundary bounding-box calculation
- point-in-polygon filtering
- Leaflet map creation and layer management
- dashboard rendering

### `styles.css`

Contains the entire UI styling for:

- layout
- map container
- filter controls
- cards
- charts
- tables
- responsive behavior

### `mm_national_boun.json`

- source of the Myanmar national boundary geometry
- used as the authoritative spatial filter for retaining earthquakes

## Data Flow

### 1. Boundary Load

The app fetches `mm_national_boun.json` and extracts:

- the first feature as the Myanmar national boundary
- the bounding box for coarse USGS query filtering

### 2. Historical Earthquake Load

The app requests USGS earthquake data in pages using:

- `starttime=1900-01-01`
- `endtime=<load start timestamp>`
- Myanmar bounding box
- `limit=20000`
- increasing `offset`

Each batch is then filtered by polygon membership.

### 3. Tectonic Overlay Load

The app fetches the Myanmar tectonic lineament GeoJSON and stores it separately from earthquake data. The layer is optional and user-toggleable.

### 4. Live Updates

After the historical load finishes, the app polls USGS every 5 minutes using `updatedafter=<last sync timestamp>`.

## Spatial Logic

The filter uses a client-side point-in-polygon implementation:

1. USGS results are limited by bounding box first.
2. Every earthquake point is tested against the Myanmar polygon or multipolygon geometry.
3. Only retained features are shown in the dashboard.

This two-stage approach reduces unnecessary polygon checks while keeping the final spatial filter precise.

## Rendering Layers

Leaflet renders:

1. OpenStreetMap base tiles
2. Myanmar national boundary polygon
3. Myanmar tectonic lineaments
4. Earthquake point markers

## UI Components

Key view sections:

- hero/status panel
- summary statistics
- filter panel
- interactive map
- yearly trend chart
- magnitude distribution chart
- depth distribution block
- recent events table

## Operational Dependencies

The running browser session depends on:

- GitHub Pages for static hosting
- `unpkg.com` for React, ReactDOM, Babel, and Leaflet
- USGS for earthquake data
- GitHub raw content for tectonic lineaments

## Extension Points

Likely future enhancements:

- earthquake clustering for large point volumes
- richer tooltip metadata
- caching boundary and tectonic layers
- user-selectable basemaps
- download/export for filtered events
- district or regional overlays inside Myanmar

